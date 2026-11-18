import { record, groups, sources, positive } from "./model.js";
import { validate } from "./format.js";
import type { Observation, History, State, Part } from "./model.js";
function check(ok: unknown): asserts ok {
  if (!ok)
    throw Error(
      "Invalid persisted schema; preserve files and repair explicitly",
    );
}
function time(x: unknown): boolean {
  return typeof x === "number" && Number.isFinite(x) && x >= 0;
}
function observation(raw: unknown): Observation {
  const o = record(raw);
  check(
    typeof o["league"] === "string" &&
      sources.includes(String(o["source"])) &&
      typeof o["id"] === "string" &&
      typeof o["key"] === "string" &&
      typeof o["name"] === "string" &&
      typeof o["variant"] === "string" &&
      typeof o["corrupted"] === "boolean" &&
      positive(o["price"]) &&
      positive(o["original"]) &&
      typeof o["primary"] === "string" &&
      time(o["activity"]) &&
      time(o["at"]) &&
      typeof o["evidence"] === "string" &&
      typeof o["epoch"] === "string" &&
      (o["group"] === null ||
        o["group"] === "currency" ||
        groups.includes(o["group"] as never)),
  );
  const rates = record(o["rates"]);
  check(Object.values(rates).every(positive));
  return raw as Observation;
}
export function historySchema(raw: unknown, league: string): History {
  const h = record(raw);
  check(
    h["version"] === 1 &&
      h["league"] === league &&
      Array.isArray(h["observations"]),
  );
  for (const o of h["observations"]) check(observation(o).league === league);
  for (const [source, v] of Object.entries(record(h["sources"]))) {
    const s = record(v);
    check(
      sources.includes(source) &&
        time(s["at"]) &&
        time(s["changed"]) &&
        time(s["nextFetch"]) &&
        typeof s["etag"] === "string" &&
        typeof s["fingerprint"] === "string" &&
        (s["error"] === undefined || typeof s["error"] === "string") &&
        Array.isArray(s["observations"]),
    );
    for (const o of s["observations"]) {
      const row = observation(o);
      check(row.source === source && row.league === league);
    }
  }
  return raw as History;
}
function part(raw: unknown): Part {
  const p = record(raw);
  check(
    ["pending", "sending", "sent", "unknown", "canceled", "rejected"].includes(
      String(p["status"]),
    ),
  );
  validate(record(p["payload"]) as never);
  if (p["status"] === "sent")
    check(typeof p["messageId"] === "string" && p["messageId"]);
  if (p["retryAt"] !== undefined) check(time(p["retryAt"]));
  return raw as Part;
}
export function stateSchema(raw: unknown): State {
  const s = record(raw);
  check(
    s["version"] === 1 &&
      (s["league"] === null || typeof s["league"] === "string") &&
      typeof s["epoch"] === "string" &&
      Array.isArray(s["reports"]) &&
      Array.isArray(s["alerts"]),
  );
  for (const v of s["reports"]) {
    const r = record(v);
    check(
      typeof r["day"] === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(r["day"]) &&
        typeof r["league"] === "string" &&
        typeof r["epoch"] === "string" &&
        time(r["expires"]) &&
        Array.isArray(r["parts"]) &&
        r["parts"].length,
    );
    r["parts"].forEach(part);
  }
  for (const v of s["alerts"]) {
    const a = record(v);
    check(
      typeof a["day"] === "string" &&
        time(a["expires"]) &&
        Array.isArray(a["signals"]),
    );
    part(a["part"]);
    for (const rawSignal of a["signals"]) {
      const signal = record(rawSignal);
      check(
        typeof signal["key"] === "string" &&
          groups.includes(signal["group"] as never) &&
          [1, -1].includes(signal["direction"] as number),
      );
    }
  }
  for (const v of Object.values(record(s["memory"]))) {
    const m = record(v);
    if (m["lastAt"] !== undefined) check(time(m["lastAt"]));
    if (m["lastPrice"] !== undefined) check(positive(m["lastPrice"]));
    if (m["armed"] !== undefined) check(typeof m["armed"] === "boolean");
    if (m["pending"] !== undefined) {
      const p = record(m["pending"]);
      check(
        Number.isInteger(p["count"]) &&
          (p["count"] as number) > 0 &&
          [1, -1].includes(p["direction"] as number) &&
          typeof p["evidence"] === "string" &&
          time(p["at"]),
      );
    }
  }
  return raw as State;
}
