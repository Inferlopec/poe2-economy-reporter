import { VERSION } from "./version.js";
import {
  activeSources,
  classify,
  ingest,
  observationEpoch,
} from "./market.js";
import type { Config } from "./config.js";
import { record, stash } from "./model.js";
import type { History } from "./model.js";
export type Fetch = typeof fetch;
const base = "https://poe.ninja/poe2/api/economy/";
const ua = `PoE2EconomyReporter/${VERSION} (+https://github.com/Inferlopec/poe2-economy-reporter)`;
export async function discover(
  c: Config,
  last: string | null,
  net: Fetch = fetch,
): Promise<string> {
  if (c.league !== "auto") return c.league;
  try {
    const r = await net(base + "leagues", {
      headers: { "User-Agent": ua },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw Error();
    const leagues: unknown = await r.json();
    if (
      !Array.isArray(leagues) ||
      typeof record(leagues[0])["id"] !== "string" ||
      !(record(leagues[0])["id"] as string).trim()
    )
      throw Error();
    return record(leagues[0])["id"] as string;
  } catch {
    if (last) return last;
    throw Error("League discovery unavailable; waiting for first valid league");
  }
}
export async function refresh(
  h: History,
  c: Config,
  fixedNow?: number,
  net: Fetch = fetch,
  onSource?: () => Promise<void>,
  signal?: AbortSignal,
): Promise<string[]> {
  const errors: string[] = [];
  // Sequential requests deliberately keep upstream concurrency at one.
  for (const source of activeSources(c)) {
    if (signal?.aborted) break;
    const now = fixedNow ?? Date.now();
    const old = h.sources[source];
    if (old && now < old.nextFetch) continue;
    try {
      const path = stash.includes(source as (typeof stash)[number])
        ? "stash/current/item"
        : "exchange/current";
      const headers: Record<string, string> = { "User-Agent": ua };
      if (old?.etag) headers["If-None-Match"] = old.etag;
      const r = await net(
        `${base}${path}/overview?${new URLSearchParams({ league: h.league, type: source })}`,
        {
          headers,
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
            : AbortSignal.timeout(20000),
        },
      );
      const cache =
        Math.max(
          0,
          Number(
            r.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1] ?? 0,
          ),
        ) * 1000;
      const nextFetch = now + cache;
      if (r.status === 304) {
        if (!old?.fingerprint) throw Error("304 without cached content");
        old.at = now;
        old.nextFetch = nextFetch;
        delete old.error;
        old.observations = old.observations.map((o) => ({
          ...o,
          at: now,
          group: classify(source, o.id, c),
          epoch: observationEpoch(c, source, o.id),
        }));
        h.observations.push(...old.observations);
      } else if (r.ok)
        ingest(
          h,
          source,
          await r.json(),
          now,
          c,
          r.headers.get("etag") ?? "",
          nextFetch,
        );
      else {
        if (r.status === 429) {
          const header = r.headers.get("retry-after") ?? "";
          const seconds = Number(header);
          const delay =
            header && Number.isFinite(seconds)
              ? seconds * 1000
              : Date.parse(header) - now;
          const next =
            now + Math.max(60000, Number.isFinite(delay) ? delay : 60000);
          if (old) old.nextFetch = next;
          else
            h.sources[source] = {
              at: 0,
              changed: 0,
              fingerprint: "",
              etag: "",
              nextFetch: next,
              observations: [],
              error: "Rate limited",
            };
        }
        throw Error(`HTTP ${r.status}`);
      }
    } catch {
      errors.push(`${source}: fetch or validation failed`);
      if (old) old.error = "Fetch or validation failed";
    }
    if (onSource) await onSource();
  }
  h.observations = h.observations.filter(
    (o) => (fixedNow ?? Date.now()) - o.at <= 7 * 86400000,
  );
  return errors;
}
