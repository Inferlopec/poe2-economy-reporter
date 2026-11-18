import type { Config } from "./config.js";
import { baseline, change, current, coverage, usable } from "./market.js";
import { groups, positive } from "./model.js";
import type {
  Card,
  Group,
  History,
  Observation,
  Payload,
  Signal,
} from "./model.js";
export const categoryStyles: Record<
  Group,
  { name: string; icon: string; color: string }
> = {
  socketable: { name: "Socketable Currency", icon: "🔮", color: "#8B5CF6" },
  lineage_supports: { name: "Lineage Supports", icon: "📜", color: "#3B82F6" },
  crafting: { name: "Crafting Currency", icon: "⚒️", color: "#F59E0B" },
  uniques: { name: "Uniques", icon: "⭐", color: "#EF4444" },
  boss_fragments: { name: "Boss Fragments", icon: "🗝️", color: "#14B8A6" },
};
const currencyStyle = { name: "Currency", icon: "💰", color: "#EAB308" };
function compact(n: number, places = 2): string {
  const rounded = Number(n.toFixed(places));
  return String(rounded === 0 && n !== 0 ? Number(n.toPrecision(2)) : rounded);
}
export function percent(p: number | undefined): string {
  if (p === undefined || !Number.isFinite(p)) return "—";
  return `${p < 0 ? "−" : p > 0 ? "+" : ""}${compact(Math.abs(p), 1)}%`;
}
export function price(p: number, ex: number | undefined): string {
  if (!positive(p)) return "unavailable";
  return p >= 1
    ? `${compact(p)} Div`
    : positive(ex)
      ? `${compact(p * ex)} Ex`
      : "unavailable";
}
function markdown(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/([*_[\]`~<>])/g, "\\$1")
    .replace(/[\r\n]+/g, " ");
}
function movement(p: number | undefined): string {
  return `${p === undefined || !Number.isFinite(p) || p === 0 ? "⚪" : p > 0 ? "🟩" : "🟥"} **${percent(p)}**`;
}
function categoryCard(group: Group, suffix: string, description: string): Card {
  const style = categoryStyles[group];
  return {
    title: `${style.icon} ${style.name} — ${suffix}`,
    color: style.color,
    description,
  };
}
function itemName(o: Observation): string {
  return markdown(
    o.name +
      (o.variant ? ` (${o.variant})` : "") +
      (o.corrupted ? " (corrupted)" : ""),
  );
}
function withCoverage(body: string, c: Config, g?: Group): string {
  const omitted = omissions(c, g);
  return omitted ? `⚠️ ${omitted}\n\n${body}` : body;
}
export function validate(p: Payload): void {
  if (p.text !== undefined && p.text.length > 4000)
    throw Error("Message text limit");
  if ((p.cards?.length ?? 0) > 10) throw Error("Card count limit");
  let total = 0;
  for (const c of p.cards ?? []) {
    if (
      c.color !== undefined &&
      !(typeof c.color === "string"
        ? /^#[0-9a-fA-F]{6}$/.test(c.color)
        : Number.isInteger(c.color) && c.color >= 0 && c.color <= 0xffffff)
    )
      throw Error("Invalid accent color");
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
        ...c,
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
  const pairs: [string, string, string, string][] = [
    ["divine", "exalted", "Divine / Exalted", "Ex per Div"],
    ["chaos", "exalted", "Chaos / Exalted", "Ex per Chaos"],
    ["mirror", "divine", "Mirror / Divine", "Div per Mirror"],
  ];
  for (const [a, b, label, unit] of pairs) {
    const x = lookup(a),
      y = lookup(b);
    const xb = x && baseline(x, h, 24, c),
      yb = y && baseline(y, h, 24, c);
    const p =
      x && y && xb && yb
        ? change(x.price / y.price, xb.price / yb.price)
        : undefined;
    rows.push(
      `**${label}** — ${x && y ? `${compact(x.price / y.price)} ${unit}` : "unavailable"} · ${movement(p)}`,
    );
  }
  const ranked = items
    .filter(
      (o) =>
        !["divine", "chaos", "mirror", ...c.currency.excluded_ids].includes(
          o.id,
        ),
    )
    .sort((a, b) => b.activity - a.activity || a.id.localeCompare(b.id))
    .slice(0, c.currency.top_by_volume);
  const extra = ranked.map((o, i) => {
    const b = baseline(o, h, 24, c);
    return `**${i + 1}.** ${itemName(o)} — ${price(o.price, ex ? 1 / ex.price : undefined)} · ${movement(b ? change(o.price, b.price) : undefined)}`;
  });
  return {
    title: `${currencyStyle.icon} Currency rates — 24h`,
    color: currencyStyle.color,
    description: `**Exchange rates**\n\n${rows.join("  \n")}\n\n**Most traded**\n\n${extra.join("  \n") || "No eligible currencies"}`,
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
      title: `📊 PoE2 Economy — ${h.league}`,
      color: "#64748B",
      description: `**24h market report**  \nObserved at: ${time}  \n[Source: poe.ninja](https://poe.ninja/poe2/economy)${omissions(c) ? `\n⚠️ ${omissions(c)}` : ""}${complete(h, c, now) ? "" : "\n⚠️ STALE / INCOMPLETE — preview only"}`,
    },
    currencyCard(h, c, now),
  ];
  if (!currencyOnly) {
    const ex = obs.find((o) => o.source === "Currency" && o.id === "exalted");
    for (const g of c.daily_report.categories.filter(
      (g) => g !== "boss_fragments",
    )) {
      const a = obs
        .filter((o) => o.group === g)
        .flatMap((o) => {
          const b = baseline(o, h, 24, c);
          return b ? [{ o, p: change(o.price, b.price) }] : [];
        });
      const sections = [1, -1].map((direction) => {
        const selected = a
          .filter((x) => x.p * direction > 0)
          .sort(
            (x, y) => (y.p - x.p) * direction || x.o.key.localeCompare(y.o.key),
          )
          .slice(0, c.daily_report.top_movers);
        return `**${direction > 0 ? "Gainers" : "Losers"}**\n\n${selected.map(({ o, p }) => `${movement(p)} · ${itemName(o)} — ${price(o.price, ex ? 1 / ex.price : undefined)}`).join("  \n") || "Unavailable / no eligible movements"}`;
      });
      cards.push(
        categoryCard(
          g,
          "Market movements · 24h",
          withCoverage(sections.join("\n\n"), c, g),
        ),
      );
    }
    for (const g of c.daily_report.categories) {
      const a = obs
        .filter((o) => o.group === g)
        .sort((a, b) => b.price - a.price || a.key.localeCompare(b.key))
        .slice(0, c.daily_report.top_expensive);
      const rows = a.map((o, i) => {
        const b = baseline(o, h, 24, c);
        return `**${i + 1}.** ${itemName(o)} — ${price(o.price, ex ? 1 / ex.price : undefined)} · ${movement(b ? change(o.price, b.price) : undefined)}`;
      });
      cards.push(
        categoryCard(
          g,
          "Most expensive",
          withCoverage(
            rows.join("  \n") || "Disabled / unavailable / no eligible items",
            c,
            g,
          ),
        ),
      );
    }
  }
  return split(cards);
}
export function alertPayload(selected: Signal[], c: Config): Payload {
  const cards: Card[] = [];
  let lastGroup: Group | undefined;
  for (const s of selected) {
    const window = `${compact(s.interval)}h`;
    const source = markdown(s.source.replace(/([a-z])([A-Z])/g, "$1 $2"));
    const body =
      s.count !== undefined
        ? `${s.direction > 0 ? "🟩" : "🟥"} **${s.count}/${s.denominator} items** moved ${s.direction > 0 ? "up" : "down"} by at least **${compact(Math.abs(s.percent), 1)}%** over **${window}**`
        : `${movement(s.percent)} · ${markdown(s.name)} — ${compact(s.price!, 3)} Div  \nBaseline: ${compact(s.baseline!, 3)} Div → ${compact(s.price!, 3)} Div · Window: **${window}** · Source: ${source}`;
    if (lastGroup === s.group)
      cards[cards.length - 1]!.description += `\n\n${body}`;
    else {
      cards.push(
        categoryCard(s.group, "Market alert", withCoverage(body, c, s.group)),
      );
      lastGroup = s.group;
    }
  }
  const p: Payload = { cards };
  validate(p);
  return p;
}
