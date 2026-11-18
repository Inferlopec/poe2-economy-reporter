import type { Config } from "./config.js";
import { baseline, change, current, coverage, usable } from "./market.js";
import { groups, HOUR } from "./model.js";
import type { AlertMemory, History, Signal, State } from "./model.js";
export function percentile(values: number[], v: number): number {
  if (values.length === 1) return 0.5;
  const less = values.filter((x) => x < v).length,
    equal = values.filter((x) => x === v).length;
  return (less + (equal - 1) / 2) / (values.length - 1);
}
function confirm(
  m: AlertMemory,
  direction: number,
  evidence: string,
  now: number,
  c: Config,
): boolean {
  if (
    !m.pending ||
    m.pending.direction !== direction ||
    now - m.pending.at > c.refresh_minutes * 60000 + 60000
  )
    m.pending = { direction, count: 1, evidence, at: now };
  else if (m.pending.evidence !== evidence) {
    m.pending = { direction, count: m.pending.count + 1, evidence, at: now };
  }
  return m.pending.count >= c.alerts.confirmation_checks;
}
export function signals(
  h: History,
  c: Config,
  s: State,
  now: number,
): Signal[] {
  const items = current(h, c, now).filter((o) => o.group !== "currency");
  const out: Signal[] = [];
  const touched = new Set<string>();
  if (!c.alerts.enabled || !usable(h.sources["Currency"], c, now)) {
    for (const m of Object.values(s.memory)) delete m.pending;
    return [];
  }
  for (const o of items) {
    if (!o.group || o.group === "currency") continue;
    const key = `${h.league}:item:${o.key}`;
    touched.add(key);
    const m = (s.memory[key] ??= {});
    const b = baseline(o, h, c.alerts.item.window_hours, c);
    const p = b ? change(o.price, b.price) : 0;
    const direction = Math.sign(p);
    const a = c.alerts.item;
    if (
      !b ||
      Math.abs(p) < a.min_change_percent ||
      Math.abs(o.price - b.price) < a.min_change_divine
    ) {
      delete m.pending;
      continue;
    }
    const confirmed = confirm(m, direction, o.evidence, now, c);
    if (
      !confirmed ||
      now - (m.lastAt ?? -Infinity) < c.alerts.cooldown_hours * HOUR
    )
      continue;
    if (
      m.lastPrice !== undefined &&
      (Math.sign(o.price - m.lastPrice) !== direction ||
        Math.abs(change(o.price, m.lastPrice)) < a.min_change_percent ||
        Math.abs(o.price - m.lastPrice) < a.min_change_divine)
    )
      continue;
    out.push({
      key,
      group: o.group,
      direction,
      price: o.price,
      baseline: b.price,
      percent: p,
      activity: o.activity,
      source: o.source,
      name:
        o.name +
        (o.variant ? ` (${o.variant})` : "") +
        (o.corrupted ? " (corrupted)" : ""),
      evidence: o.evidence,
      interval: (o.at - b.at) / HOUR,
      score: 0,
    });
  }
  for (const g of groups) {
    const complete = coverage(c, g)
      .filter((x) => !c.sources.disabled.includes(x))
      .every((x) => usable(h.sources[x], c, now));
    const comparable = items
      .filter((o) => o.group === g)
      .flatMap((o) => {
        const b = baseline(o, h, c.alerts.category.window_hours, c);
        return b ? [{ o, b, p: change(o.price, b.price) }] : [];
      });
    for (const direction of [1, -1]) {
      const key = `${h.league}:group:${g}:${direction}`;
      touched.add(key);
      const m = (s.memory[key] ??= { armed: true });
      const moved = comparable.filter(
        (x) => x.p * direction >= c.alerts.category.min_change_percent,
      );
      const qualifies =
        complete &&
        comparable.length >= c.alerts.category.min_eligible_items &&
        (moved.length / comparable.length) * 100 >=
          c.alerts.category.min_affected_percent;
      if (!qualifies) {
        delete m.pending;
        if (complete) m.armed = true;
        continue;
      }
      const evidence = moved
        .map((x) => `${x.o.key}:${x.o.evidence}`)
        .sort()
        .join("|");
      // Every counted item's relevant content must have changed for a second group confirmation.
      const previous = m.pending?.evidence.split("|") ?? [];
      const updated =
        previous.length === 0 ||
        moved.every((x) => !previous.includes(`${x.o.key}:${x.o.evidence}`));
      const confirmed = updated
        ? confirm(m, direction, evidence, now, c)
        : (m.pending?.count ?? 0) >= c.alerts.confirmation_checks;
      if (
        m.armed !== false &&
        confirmed &&
        now - (m.lastAt ?? -Infinity) >= c.alerts.cooldown_hours * HOUR
      )
        out.push({
          key,
          group: g,
          direction,
          percent: direction * c.alerts.category.min_change_percent,
          activity: 0,
          source: "group",
          name: g,
          evidence,
          count: moved.length,
          denominator: comparable.length,
          interval: c.alerts.category.window_hours,
          score: 1,
        });
    }
  }
  for (const [key, m] of Object.entries(s.memory))
    if (!touched.has(key)) delete m.pending;
  for (const signal of out.filter((x) => x.source !== "group")) {
    const peers = out.filter((x) => x.source === signal.source);
    signal.score =
      (percentile(
        peers.map((x) => Math.abs(x.percent)),
        Math.abs(signal.percent),
      ) +
        percentile(
          peers.map((x) => Math.abs(x.price! - x.baseline!)),
          Math.abs(signal.price! - signal.baseline!),
        ) +
        percentile(
          peers.map((x) => x.activity),
          signal.activity,
        )) /
      3;
  }
  return out.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}
export function reserveSignals(
  s: State,
  selected: Signal[],
  now: number,
): void {
  for (const signal of selected) {
    const m = (s.memory[signal.key] ??= {});
    m.lastAt = now;
    if (signal.price !== undefined) m.lastPrice = signal.price;
    if (signal.source === "group") m.armed = false;
    delete m.pending;
  }
}
