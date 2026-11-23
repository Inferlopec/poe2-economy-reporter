import { startRetention } from "./retention.js";
import type { Config } from "./config.js";
import { discover, refresh } from "./api.js";
import { reserveSignals, signals } from "./analysis.js";
import { deliver } from "./delivery.js";
import { alertPayload, complete, report } from "./format.js";
import {
  activeSources,
  coverage,
  current,
  epoch,
  reportSources,
  usableForAlerts,
} from "./market.js";
import { HOUR } from "./model.js";
import type { History, State } from "./model.js";
import {
  loadHistory,
  loadState,
  lock,
  saveHistory,
  saveState,
} from "./storage.js";
export function localTime(
  now: number,
  zone: string,
): { day: string; time: string } {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}
export function recover(s: State): void {
  for (const r of s.reports)
    for (const p of r.parts) if (p.status === "sending") p.status = "unknown";
  for (const a of s.alerts)
    if (a.part.status === "sending") a.part.status = "unknown";
    else if (a.part.status === "pending") {
      a.part.status = "canceled";
      console.warn(
        "Canceled queued alert after restart; fresh confirmations required",
      );
    }
  for (const m of Object.values(s.memory)) delete m.pending;
}
export function reconcile(s: State, c: Config): void {
  const e = epoch(c);
  if (s.epoch !== e) {
    for (const m of Object.values(s.memory)) {
      delete m.pending;
      if (m.armed !== undefined) m.armed = true;
    }
    for (const r of s.reports)
      if (r.epoch !== e)
        for (const p of r.parts)
          if (p.status === "pending") {
            p.status = "canceled";
            console.warn(
              "Canceled unsent report part after coverage/classification change",
            );
          }
    for (const a of s.alerts)
      if (a.part.status === "pending") a.part.status = "canceled";
    s.epoch = e;
  }
}
export async function scheduled(
  h: History,
  c: Config,
  s: State,
  now: number,
  save: () => Promise<void>,
  evaluateAlerts = true,
): Promise<void> {
  const local = localTime(now, c.timezone);
  reconcile(s, c);
  for (const r of s.reports)
    if (r.day !== local.day || r.expires < now)
      for (const p of r.parts)
        if (p.status === "pending") {
          p.status = "canceled";
          console.warn(
            "Report incomplete: its day or freshness interval ended",
          );
        }
  for (const a of s.alerts)
    if (a.day !== local.day || a.expires < now)
      if (a.part.status === "pending") a.part.status = "canceled";
  if (
    local.time >= c.daily_report.time &&
    !s.reports.some((r) => r.day === local.day) &&
    complete(h, c, now)
  )
    s.reports.push({
      day: local.day,
      league: h.league,
      epoch: epoch(c),
      expires: Math.min(
        ...reportSources(c).map(
          (x) => h.sources[x]!.at + c.freshness.max_unchanged_hours * HOUR,
        ),
      ),
      parts: report(h, c, now).map((payload) => ({
        payload,
        status: "pending",
      })),
    });
  const candidates = evaluateAlerts ? signals(h, c, s, now) : [];
  const allowance = s.alerts.filter((a) => a.day === local.day).length;
  if (
    c.alerts.enabled &&
    allowance < c.alerts.max_per_day &&
    candidates.length
  ) {
    let selected = candidates
      .filter((x) => x.price !== undefined)
      .slice(0, c.alerts.max_items_per_message);
    const group = candidates.find((x) => x.source === "group");
    if (group)
      selected = [
        group,
        ...selected.filter((x) => x.group === group.group),
      ].slice(0, c.alerts.max_items_per_message + 1);
    if (!selected.length) selected = candidates.slice(0, 1);
    let payload;
    const exalted = current(h, c, now, usableForAlerts).find(
      (o) => o.source === "Currency" && o.id === "exalted",
    );
    while (selected.length) {
      try {
        payload = alertPayload(
          selected,
          c,
          exalted ? 1 / exalted.price : undefined,
        );
        break;
      } catch {
        selected.pop();
      }
    }
    if (payload) {
      reserveSignals(s, selected, now);
      s.alerts.push({
        day: local.day,
        part: { payload, status: "pending" },
        signals: selected,
        expires: Math.min(
          ...selected
            .flatMap((x) =>
              x.source === "group"
                ? [
                    "Currency",
                    ...coverage(c, x.group).filter(
                      (source) => !c.sources.disabled.includes(source),
                    ),
                  ]
                : ["Currency", x.source],
            )
            .map((x) =>
              h.sources[x]
                ? Math.min(h.sources[x]!.at, h.sources[x]!.changed) +
                  c.freshness.max_unchanged_hours * HOUR
                : now,
            ),
        ),
      });
    }
  }
  await save();
}
export async function run(c: Config, url: string, dir: string): Promise<void> {
  const release = await lock(dir);
  let stopping = false;
  const controller = new AbortController();
  const stop = () => {
    stopping = true;
    controller.abort();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  let retention: ReturnType<typeof startRetention> | undefined;
  try {
    const s = await loadState(dir);
    recover(s);
    reconcile(s, c);
    await saveState(dir, s);
    retention = startRetention(c, url, dir, s);
    let h: History | undefined;
    let next = 0;
    let lastPost = 0;
    let diagnostics = true;
    console.log(
      `Enabled sources: ${activeSources(c).join(", ")}; excluded: ${c.sources.disabled.join(", ") || "none"}`,
    );
    while (!stopping) {
      const now = Date.now();
      if (now >= next) {
        try {
          const league = await discover(c, s.league);
          if (h?.league !== league) {
            if (h) await saveHistory(dir, h);
            h = await loadHistory(dir, league);
            s.league = league;
            for (const m of Object.values(s.memory)) delete m.pending;
          }
          const errors = await refresh(
            h,
            c,
            undefined,
            fetch,
            () => saveHistory(dir, h!),
            controller.signal,
          );
          if (diagnostics) {
            for (const r of c.classification.overrides) {
              if (c.sources.disabled.includes(r.source))
                console.warn(`Dormant rule: ${r.source}/${r.id}`);
              else if (
                !h.sources[r.source]?.observations.some((o) => o.id === r.id)
              )
                console.warn(`Unmatched rule: ${r.source}/${r.id}`);
            }
            diagnostics = false;
          }
          for (const e of errors) console.warn(e);
          await saveHistory(dir, h);
          if (!stopping)
            await scheduled(h, c, s, Date.now(), () => saveState(dir, s));
        } catch (e) {
          console.error(e instanceof Error ? e.message : "Market cycle failed");
        }
        next = now + c.refresh_minutes * 60000;
      }
      if (h && !stopping) {
        const local = localTime(Date.now(), c.timezone);
        const tick = Date.now();
        const needsReport =
          local.time >= c.daily_report.time &&
          !s.reports.some((r) => r.day === local.day) &&
          complete(h, c, tick);
        const needsCancellation =
          s.reports.some(
            (r) =>
              (r.day !== local.day || r.expires < tick) &&
              r.parts.some((p) => p.status === "pending"),
          ) ||
          s.alerts.some(
            (a) =>
              (a.day !== local.day || a.expires < tick) &&
              a.part.status === "pending",
          );
        if (needsReport || needsCancellation)
          await scheduled(h, c, s, tick, () => saveState(dir, s), false);
        const reportToday = s.reports.find((r) => r.day === local.day);
        const pending = reportToday?.parts.find(
          (p) => p.status !== "sent" && p.status !== "canceled",
        );
        const alert = s.alerts.find(
          (a) =>
            a.day === local.day &&
            a.part.status === "pending" &&
            a.expires >= Date.now(),
        );
        const part =
          reportToday &&
          reportToday.expires >= Date.now() &&
          pending?.status === "pending"
            ? pending
            : alert?.part;
        if (part && Date.now() - lastPost >= 2000) {
          await deliver(part, url, () => saveState(dir, s), Date.now());
          lastPost = Date.now();
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    await retention?.stop();
    await release();
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}
