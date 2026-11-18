import type { Config } from "./config.js";
import { baseline, change, current, coverage, usable } from "./market.js";
import { groups, positive } from "./model.js";
import type { Card, History, Observation, Payload, Signal } from "./model.js";
export const percent = (p: number | undefined) =>
  p === undefined ? "—" : `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
export function price(p: number, ex: number | undefined): string {
  return p >= 1
    ? `${p.toFixed(2)} Div`
    : positive(ex)
      ? `${(p * ex).toFixed(2)} Ex`
      : "unavailable";
}
export function validate(p: Payload): void {
  if (p.text !== undefined && p.text.length > 4000)
    throw Error("Message text limit");
  if ((p.cards?.length ?? 0) > 10) throw Error("Card count limit");
  let total = 0;
  for (const c of p.cards ?? []) {
    const fields = c.fields ?? [];
    if (fields.length > 25) throw Error("Field count limit");
    for (const [v, n] of [
      [c.title, 256],
      [c.description, 4000],
      [c.footer?.text, 2048],
    ] as const) {
      if (v) {
        if (v.length > n) throw Error("Card text limit");
        total += v.length;
      }
    }
    for (const f of fields) {
      if (!f.name || !f.value || f.name.length > 256 || f.value.length > 1024)
        throw Error("Field text limit");
      total += f.name.length + f.value.length;
    }
  }
  if (total > 6000 || Buffer.byteLength(JSON.stringify(p)) > 256 * 1024)
    throw Error("Payload limit");
  if (!p.text && !p.cards?.length) throw Error("Empty payload");
}
export function split(cards: Card[]): Payload[] {
  // Descriptions are split on row boundaries; an exceptionally long name is continued verbatim.
  const pieces: Card[] = [];
  for (const c of cards) {
    const text = c.description ?? "Unavailable";
    let rest = text;
    let part = 0;
    while (rest.length) {
      let end = Math.min(3500, rest.length);
      if (end < rest.length) {
        const nl = rest.lastIndexOf("\n", end);
        if (nl > 0) end = nl + 1;
      }
      if (
        end < rest.length &&
        /[\uD800-\uDBFF]/.test(rest[end - 1]!) &&
        /[\uDC00-\uDFFF]/.test(rest[end]!)
      )
        end--;
      pieces.push({
        title: (c.title ?? "Report") + (part++ ? " (continued)" : ""),
        description: rest.slice(0, end),
      });
      rest = rest.slice(end);
    }
  }
  const packets: Payload[] = [];
  let packet: Payload = { cards: [] };
  for (const card of pieces) {
    try {
      validate({
        ...packet,
        cards: [...packet.cards!, card],
        text: "Part 999999/999999",
      });
      packet.cards!.push(card);
    } catch {
      if (!packet.cards!.length) throw Error("Unsplittable card");
      packets.push(packet);
      packet = { cards: [card] };
    }
  }
  if (packet.cards!.length) packets.push(packet);
  return packets.map((p, i) => {
    p.text = `Part ${i + 1}/${packets.length}`;
    validate(p);
    return p;
  });
}
export function omissions(c: Config, g?: (typeof groups)[number]): string {
  const omitted = g
    ? coverage(c, g).filter((s) => c.sources.disabled.includes(s))
    : c.sources.disabled;
  return omitted.length
    ? `Reduced coverage; excluded sources: ${omitted.join(", ")}.`
    : "";
}
export function complete(h: History, c: Config, now: number): boolean {
  return [
    "Currency",
    ...c.daily_report.categories.flatMap((g) => coverage(c, g)),
  ]
    .filter((s) => !c.sources.disabled.includes(s))
    .every((s) => usable(h.sources[s], c, now));
}
export function currencyCard(h: History, c: Config, now: number): Card {
  const items = current(h, c, now).filter((o) => o.source === "Currency");
  const lookup = (id: string) => items.find((o) => o.id === id);
  const ex = lookup("exalted");
  const rows: string[] = [];
  const pairs: [string, string, (a: number, b: number) => number][] = [
    ["divine", "exalted", (a, b) => a / b],
    ["chaos", "exalted", (a, b) => a / b],
    ["mirror", "divine", (a, b) => a / b],
  ];
  for (const [a, b, ratio] of pairs) {
    const x = lookup(a),
      y = lookup(b);
    const xb = x && baseline(x, h, 24, c),
      yb = y && baseline(y, h, 24, c);
    rows.push(
      `${a}/${b}: ${x && y ? ratio(x.price, y.price).toFixed(2) : "unavailable"} (${x && y && xb && yb ? percent(change(ratio(x.price, y.price), ratio(xb.price, yb.price))) : "—"})`,
    );
  }
  for (const o of items
    .filter(
      (o) =>
        !["divine", "chaos", "mirror", ...c.currency.excluded_ids].includes(
          o.id,
        ),
    )
    .sort((a, b) => b.activity - a.activity || a.id.localeCompare(b.id))
    .slice(0, c.currency.top_by_volume)) {
    const b = baseline(o, h, 24, c);
    rows.push(
      `${o.name}: ${price(o.price, ex ? 1 / ex.price : undefined)} (${percent(b ? change(o.price, b.price) : undefined)})`,
    );
  }
  return {
    title: "Currency rates — 24h comparison",
    description: rows.join("\n"),
  };
}
export function report(
  h: History,
  c: Config,
  now: number,
  currencyOnly = false,
): Payload[] {
  const obs = current(h, c, now);
  const times = Object.values(h.sources)
    .filter((s) => usable(s, c, now))
    .map((s) => s.at);
  const time = times.length
    ? `${new Date(Math.min(...times)).toISOString()} – ${new Date(Math.max(...times)).toISOString()}`
    : "unavailable";
  const cards: Card[] = [
    {
      title: `PoE2 Economy — ${h.league}`,
      description: `Observed at: ${time}\nRequested comparison: 24h\nhttps://poe.ninja/poe2/economy\n${omissions(c)}${complete(h, c, now) ? "" : "\nSTALE / INCOMPLETE — preview only"}`,
    },
    currencyCard(h, c, now),
  ];
  if (!currencyOnly) {
    const ex = obs.find((o) => o.source === "Currency" && o.id === "exalted");
    const row = (o: Observation) => {
      const b = baseline(o, h, 24, c);
      return `${o.name}${o.variant ? ` (${o.variant})` : ""}${o.corrupted ? " (corrupted)" : ""}: ${price(o.price, ex ? 1 / ex.price : undefined)} (${percent(b ? change(o.price, b.price) : undefined)})`;
    };
    for (const g of c.daily_report.categories.filter(
      (g) => g !== "boss_fragments",
    )) {
      const a = obs
        .filter((o) => o.group === g)
        .flatMap((o) => {
          const b = baseline(o, h, 24, c);
          return b ? [{ o, p: change(o.price, b.price) }] : [];
        });
      for (const direction of [1, -1]) {
        const selected = a
          .filter((x) => x.p * direction > 0)
          .sort(
            (x, y) => (y.p - x.p) * direction || x.o.key.localeCompare(y.o.key),
          )
          .slice(0, c.daily_report.top_movers);
        cards.push({
          title: `${g} — ${direction > 0 ? "Gainers" : "Losers"}`,
          description: `${omissions(c, g)}\n${selected.map((x) => row(x.o)).join("\n") || "Unavailable / no eligible movements"}`,
        });
      }
    }
    for (const g of c.daily_report.categories) {
      const a = obs
        .filter((o) => o.group === g)
        .sort((a, b) => b.price - a.price || a.key.localeCompare(b.key))
        .slice(0, c.daily_report.top_expensive);
      cards.push({
        title: `${g} — Most expensive`,
        description: `${omissions(c, g)}\n${a.map(row).join("\n") || "Disabled / unavailable / no eligible items"}`,
      });
    }
  }
  return split(cards);
}
export function alertPayload(selected: Signal[], c: Config): Payload {
  const p: Payload = {
    cards: [
      {
        title: "PoE2 significant market movement",
        description: selected
          .map(
            (s) =>
              `${s.group} / ${s.source}: ${s.name}\n${s.count !== undefined ? `${s.count}/${s.denominator} eligible items moved ${s.direction > 0 ? "up" : "down"} by at least ${Math.abs(s.percent)}%` : `${s.baseline!.toFixed(3)} → ${s.price!.toFixed(3)} Div (${percent(s.percent)})`} over ${s.interval.toFixed(2)}h\n${omissions(c, s.group)}`,
          )
          .join("\n\n"),
      },
    ],
  };
  validate(p);
  return p;
}
