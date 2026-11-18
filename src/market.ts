import { craftingIds } from "./catalog.js";
import { createHash } from "node:crypto";
import type { Config } from "./config.js";
import { HOUR, positive, record, stash } from "./model.js";
import type { Group, History, Observation, SourceState } from "./model.js";
export const bossIds: Record<string, string[]> = {
  Fragments: [
    "ancient-crisis-fragment",
    "faded-crisis-fragment",
    "weathered-crisis-fragment",
    "cowardly-fate",
    "deadly-fate",
    "victorious-fate",
    "simulacrum",
    "kulemaks-invitation",
    "breachlord-sac",
    "call-of-the-shadows",
    "ravens-reflection",
    "origin-cradle",
    "origin-spark",
    "origin-core",
  ],
  Ritual: ["an-audience-with-the-king"],
  Breach: ["breachstone"],
};
const mapping: Record<string, Group> = {
  Runes: "socketable",
  SoulCores: "socketable",
  Idols: "socketable",
  LineageSupportGems: "lineage_supports",
  Essences: "crafting",
  Ritual: "crafting",
  Breach: "crafting",
  Delirium: "crafting",
  ...Object.fromEntries(
    stash.filter((s) => s !== "PrecursorTablets").map((s) => [s, "uniques"]),
  ),
};
export const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function epoch(c: Config): string {
  return hash([mapping, bossIds, c.classification, c.sources]);
}
export function classify(
  source: string,
  id: string,
  c: Config,
): Observation["group"] {
  if (c.sources.disabled.includes(source)) return null;
  if (source === "Currency") return "currency";
  const override = c.classification.overrides.find(
    (r) => r.source === source && r.id === id,
  );
  if (override) return override.group;
  if (bossIds[source]?.includes(id)) return "boss_fragments";
  if (craftingIds[source] && !craftingIds[source]!.includes(id)) return null;
  return mapping[source] ?? null;
}
export function coverage(c: Config, g: Group): string[] {
  return [
    ...new Set([
      ...Object.entries(mapping)
        .filter(([, v]) => v === g)
        .map(([s]) => s),
      ...(g === "boss_fragments" ? Object.keys(bossIds) : []),
      ...c.classification.overrides
        .filter((r) => r.group === g)
        .map((r) => r.source),
    ]),
  ];
}
export function observationEpoch(
  c: Config,
  source: string,
  id: string,
): string {
  const group = classify(source, id, c);
  if (group === "currency") return "currency-v1";
  if (!group) return "excluded";
  const relevant = coverage(c, group);
  return hash([
    group,
    group === "boss_fragments" ? bossIds : null,
    c.sources.disabled.filter((s) => relevant.includes(s)).sort(),
    c.classification.overrides
      .filter((r) => relevant.includes(r.source))
      .sort(
        (a, b) => a.source.localeCompare(b.source) || a.id.localeCompare(b.id),
      ),
  ]);
}
export function activeSources(c: Config): string[] {
  return [
    ...new Set([
      "Currency",
      ...Object.keys(mapping),
      ...Object.keys(bossIds),
      ...c.classification.overrides.filter((r) => r.group).map((r) => r.source),
    ]),
  ].filter((s) => !c.sources.disabled.includes(s));
}
export function threshold(o: Observation, c: Config): number {
  return o.group === "boss_fragments"
    ? c.liquidity.boss_fragments_min_volume_divine
    : stash.includes(o.source as (typeof stash)[number])
      ? c.liquidity.uniques_min_listings
      : (c.liquidity.exchange_min_volume_divine[o.source] ?? Infinity);
}
export function eligible(o: Observation, c: Config): boolean {
  return (
    o.group !== null &&
    !c.sources.disabled.includes(o.source) &&
    positive(o.price) &&
    Number.isFinite(o.activity) &&
    o.activity >= threshold(o, c)
  );
}
export function usable(
  s: SourceState | undefined,
  c: Config,
  now: number,
): boolean {
  return (
    !!s &&
    !s.error &&
    now >= s.at &&
    now - s.at <= c.freshness.max_unchanged_hours * HOUR &&
    now - s.changed <= c.freshness.max_unchanged_hours * HOUR
  );
}
export function normalize(
  raw: unknown,
  source: string,
  league: string,
  at: number,
  c: Config,
): Observation[] {
  const d = record(raw),
    core = record(d["core"]),
    ratesRaw = record(core["rates"]);
  const primary = core["primary"];
  if (typeof primary !== "string" || !Array.isArray(d["lines"]))
    throw Error("Invalid market envelope");
  const rates: Record<string, number> = { [primary]: 1 };
  for (const [k, v] of Object.entries(ratesRaw).sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    if (positive(v)) rates[k] = v;
  const div = rates["divine"];
  if (!positive(div)) throw Error("Missing Divine conversion");
  const metadata = new Map<string, string>();
  for (const i of [
    ...(Array.isArray(core["items"]) ? core["items"] : []),
    ...(Array.isArray(d["items"]) ? d["items"] : []),
  ]) {
    const m = record(i);
    if (typeof m["id"] === "string" && typeof m["name"] === "string")
      metadata.set(m["id"], m["name"]);
  }
  const isStash = stash.includes(source as (typeof stash)[number]);
  const out: Observation[] = [];
  const keys = new Set<string>();
  for (const v of d["lines"]) {
    const line = record(v);
    const id = isStash ? line["itemId"] : line["id"];
    if (typeof id !== "string" || !id)
      throw Error("Missing stable item identity");
    if (!positive(line["primaryValue"])) continue;
    const activity = isStash
      ? line["listingCount"]
      : line["volumePrimaryValue"];
    if (
      typeof activity !== "number" ||
      !Number.isFinite(activity) ||
      activity < 0
    )
      continue;
    if (
      isStash &&
      (typeof line["corrupted"] !== "boolean" ||
        (line["variant"] !== undefined && typeof line["variant"] !== "string"))
    )
      throw Error("Invalid variant identity");
    const variant = typeof line["variant"] === "string" ? line["variant"] : "";
    const corrupted = line["corrupted"] === true;
    const key = JSON.stringify(
      isStash ? [source, id, variant, corrupted] : ["exchange", id],
    );
    if (keys.has(key)) throw Error("Duplicate source item identity");
    keys.add(key);
    const name = isStash ? line["name"] : metadata.get(id);
    if (typeof name !== "string" || !name) throw Error("Missing item name");
    const price = line["primaryValue"] * div,
      volume = isStash ? activity : activity * div;
    if (!positive(price) || !Number.isFinite(volume)) continue;
    const evidence = hash([id, variant, corrupted, price, volume, rates]);
    out.push({
      league,
      source,
      id,
      key,
      name,
      variant,
      corrupted,
      price,
      original: line["primaryValue"],
      primary,
      rates,
      activity: volume,
      at,
      evidence,
      group: classify(source, id, c),
      epoch: observationEpoch(c, source, id),
    });
  }
  return out;
}
export function ingest(
  h: History,
  source: string,
  raw: unknown,
  at: number,
  c: Config,
  etag = "",
  nextFetch = at,
): void {
  const observations = normalize(raw, source, h.league, at, c);
  const fingerprint = hash(
    observations
      .map((o) => [o.key, o.evidence])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
  const old = h.sources[source];
  h.sources[source] = {
    at,
    changed: old?.fingerprint === fingerprint ? old.changed : at,
    fingerprint,
    etag,
    nextFetch,
    observations,
  };
  if (usable(h.sources[source], c, at)) h.observations.push(...observations);
  h.observations = h.observations.filter((o) => at - o.at <= 7 * 24 * HOUR);
}
export function current(h: History, c: Config, now: number): Observation[] {
  const found = new Map<string, Observation>();
  for (const s of Object.keys(h.sources).sort((a, b) =>
    a === "Currency" ? -1 : b === "Currency" ? 1 : a.localeCompare(b),
  )) {
    if (c.sources.disabled.includes(s) || !usable(h.sources[s], c, now))
      continue;
    for (const raw of h.sources[s]!.observations) {
      const o = { ...raw, group: classify(raw.source, raw.id, c) };
      if (!found.has(o.key) && eligible(o, c)) found.set(o.key, o);
    }
  }
  return [...found.values()];
}
export function baseline(
  o: Observation,
  h: History,
  hours: number,
  c: Config,
): Observation | undefined {
  const target = o.at - hours * HOUR;
  return h.observations
    .filter(
      (b) =>
        b.key === o.key &&
        b.source === o.source &&
        b.league === o.league &&
        b.at < o.at &&
        Math.abs(b.at - target) <= HOUR &&
        b.group === o.group &&
        b.epoch === o.epoch &&
        eligible(b, c),
    )
    .sort(
      (a, b) =>
        Math.abs(a.at - target) - Math.abs(b.at - target) || a.at - b.at,
    )[0];
}
export const change = (a: number, b: number) => (a / b - 1) * 100;
