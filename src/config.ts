import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";
import { groups, sources, stash, positive } from "./model.js";
import type { Group } from "./model.js";
export interface Rule {
  source: string;
  id: string;
  group: Group | null;
}
export const defaults = {
  league: "auto",
  timezone: "Europe/Riga",
  refresh_minutes: 60,
  sources: { disabled: [] as string[] },
  classification: { overrides: [] as Rule[] },
  freshness: { max_unchanged_hours: 2 },
  daily_report: {
    time: "09:00",
    top_movers: 5,
    top_expensive: 10,
    categories: [...groups] as Group[],
  },
  currency: { top_by_volume: 10, excluded_ids: ["transmute", "aug"] },
  liquidity: {
    exchange_min_volume_divine: {
      Currency: 20,
      Runes: 10,
      SoulCores: 10,
      Idols: 10,
      LineageSupportGems: 10,
      Essences: 5,
      Ritual: 20,
      Breach: 5,
      Delirium: 5,
    } as Record<string, number>,
    boss_fragments_min_volume_divine: 10,
    uniques_min_listings: 30,
  },
  alerts: {
    enabled: true,
    categories: [...groups] as Group[],
    max_per_day: 3,
    max_items_per_message: 3,
    confirmation_checks: 2,
    cooldown_hours: 12,
    item: { window_hours: 6, min_change_percent: 25, min_change_divine: 0.5 },
    category: {
      window_hours: 24,
      min_change_percent: 15,
      min_affected_percent: 30,
      min_eligible_items: 10,
    },
  },
};
export type Config = typeof defaults;
function merge(base: unknown, input: unknown, path = ""): unknown {
  if (Array.isArray(base)) {
    if (!Array.isArray(input)) throw Error(`Expected list: ${path}`);
    return input;
  }
  if (base && typeof base === "object") {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw Error(`Expected mapping: ${path}`);
    const out = { ...base } as Record<string, unknown>;
    for (const [k, v] of Object.entries(input)) {
      if (
        !Object.hasOwn(out, k) &&
        path !== "liquidity.exchange_min_volume_divine"
      )
        throw Error(`Unknown setting: ${path}.${k}`);
      out[k] = Object.hasOwn(out, k)
        ? merge(out[k], v, path ? `${path}.${k}` : k)
        : v;
    }
    return out;
  }
  if (typeof base !== typeof input) throw Error(`Wrong type: ${path}`);
  if (typeof input === "number" && !positive(input))
    throw Error(`Expected positive number: ${path}`);
  return input;
}
function unique(a: unknown[], allowed: readonly string[], label: string) {
  if (
    a.some((x) => typeof x !== "string" || !allowed.includes(x)) ||
    new Set(a).size !== a.length
  )
    throw Error(`Invalid ${label}`);
}
export function configure(
  input: unknown = {},
  env: NodeJS.ProcessEnv = process.env,
): Config {
  const c = merge(defaults, input) as Config;
  if (!(input as Record<string, unknown>)?.["timezone"])
    c.timezone = env["TZ"]?.trim() || defaults.timezone;
  new Intl.DateTimeFormat("en", { timeZone: c.timezone }).format();
  if (
    !c.league.trim() ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(c.daily_report.time)
  )
    throw Error("Invalid league or report time");
  if (
    c.refresh_minutes < 60 ||
    c.freshness.max_unchanged_hours < c.refresh_minutes / 60
  )
    throw Error("Invalid refresh/freshness interval");
  unique(c.sources.disabled, sources, "disabled sources");
  if (c.sources.disabled.includes("Currency"))
    throw Error("Currency is mandatory");
  unique(c.daily_report.categories, groups, "categories");
  if (!c.daily_report.categories.length) throw Error("Empty categories");
  unique(c.alerts.categories, groups, "alert categories");
  unique(
    c.currency.excluded_ids,
    c.currency.excluded_ids.filter(
      (x) => typeof x === "string" && x.length > 0,
    ),
    "currency exclusions",
  );
  const counts = [
    c.daily_report.top_movers,
    c.daily_report.top_expensive,
    c.currency.top_by_volume,
    c.alerts.max_per_day,
    c.alerts.max_items_per_message,
    c.alerts.confirmation_checks,
    c.alerts.category.min_eligible_items,
  ];
  if (
    counts.some((n) => !Number.isInteger(n) || n < 1) ||
    c.alerts.confirmation_checks < 2 ||
    c.alerts.max_per_day > 3 ||
    c.alerts.max_items_per_message > 3 ||
    c.alerts.category.min_affected_percent > 100
  )
    throw Error("Invalid counts/percentages");
  for (const h of [
    24,
    c.alerts.item.window_hours,
    c.alerts.category.window_hours,
  ])
    if (h < c.refresh_minutes / 60 || h > 167)
      throw Error("Horizon does not fit sampling/retention");
  for (const [s, n] of Object.entries(c.liquidity.exchange_min_volume_divine))
    if (
      !sources.includes(s) ||
      stash.includes(s as (typeof stash)[number]) ||
      !positive(n)
    )
      throw Error(`Invalid activity threshold: ${s}`);
  const seen = new Set<string>();
  for (const r of c.classification.overrides) {
    if (
      !r ||
      Object.keys(r).sort().join(",") !== "group,id,source" ||
      typeof r.id !== "string" ||
      !r.id ||
      !sources.includes(r.source) ||
      r.source === "Currency" ||
      (r.group !== null && !groups.includes(r.group))
    )
      throw Error("Invalid classification rule");
    const isStash = stash.includes(r.source as (typeof stash)[number]);
    if (
      r.group !== null &&
      (isStash
        ? !r.source.startsWith("Unique") || r.group !== "uniques"
        : r.group === "uniques")
    )
      throw Error("Incompatible source/group");
    const k = `${r.source}:${r.id}`;
    if (seen.has(k)) throw Error("Duplicate classification rule");
    seen.add(k);
    if (
      r.group &&
      r.group !== "boss_fragments" &&
      !isStash &&
      !positive(c.liquidity.exchange_min_volume_divine[r.source])
    )
      throw Error(`Missing activity threshold: ${r.source}`);
  }
  return c;
}
export async function loadConfig(
  path = process.env["CONFIG_PATH"] || "config.yaml",
): Promise<Config> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return configure();
    throw e;
  }
  const doc = parseDocument(raw, { uniqueKeys: true });
  if (doc.errors.length) throw Error("Invalid YAML configuration");
  return configure(doc.toJS() ?? {});
}
export function webhook(env = process.env, key = "GRYT_WEBHOOK_URL"): string {
  const raw = env[key];
  try {
    const u = new URL(raw || "");
    if (
      !["http:", "https:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      !/^\/api\/webhooks\/[^/]+\/[^/]+$/.test(u.pathname)
    )
      throw Error();
    return u.href;
  } catch {
    throw Error(`${key} must be a complete Gryt incoming webhook URL`);
  }
}
