import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configure, webhook } from "../dist/config.js";
import {
  activeSources,
  bossIds,
  baseline,
  classify,
  coverage,
  current,
  epoch,
  ingest,
  normalize,
  usable,
} from "../dist/market.js";
import { discover, refresh } from "../dist/api.js";
import { percentile, reserveSignals, signals } from "../dist/analysis.js";
import {
  alertPayload,
  complete,
  currencyCard,
  report,
  split,
  validate,
} from "../dist/format.js";
import { deliver, post } from "../dist/delivery.js";
import { demo } from "../dist/demo.js";
import { emptyHistory, emptyState, HOUR, sources } from "../dist/model.js";
import { localTime, reconcile, recover, scheduled } from "../dist/runtime.js";
import {
  atomic,
  historyPath,
  loadHistory,
  loadState,
  lock,
  saveHistory,
  saveState,
} from "../dist/storage.js";
import { main } from "../dist/cli.js";
const c = configure({}, {});
const now = Date.UTC(2026, 0, 15, 9);
const fixture = async (s: string) =>
  JSON.parse(
    await readFile(new URL(`./fixtures/${s}.json`, import.meta.url), "utf8"),
  );
const raw = (value = 1, volume = 100, id = "rune") => ({
  core: {
    primary: "divine",
    rates: { exalted: 500, chaos: 10 },
    items: [{ id, name: id }],
  },
  lines: [{ id, primaryValue: value, volumePrimaryValue: volume }],
});
const fetcher = (fn: Function) =>
  (async (...args: unknown[]) => fn(...args)) as typeof fetch;
for (const source of sources)
  test(`representative adapter: ${source}`, async () => {
    const observations = normalize(
      await fixture(source),
      source,
      "Forbidden Rites",
      now,
      c,
    );
    assert.ok(observations.length);
    assert.ok(
      observations.every((o) => Number.isFinite(o.price) && o.price > 0),
    );
  });
test("configuration defaults, merge, lists and timezone", () => {
  const x = configure(
    {
      currency: { excluded_ids: ["foo"] },
      liquidity: { exchange_min_volume_divine: { Runes: 50 } },
    },
    { TZ: "UTC" },
  );
  assert.equal(x.timezone, "UTC");
  assert.equal(x.liquidity.exchange_min_volume_divine["Currency"], 20);
  assert.equal(x.liquidity.exchange_min_volume_divine["Runes"], 50);
  assert.deepEqual(x.currency.excluded_ids, ["foo"]);
  assert.equal(
    configure({ timezone: "Europe/Riga" }, { TZ: "UTC" }).timezone,
    "Europe/Riga",
  );
});
for (const invalid of [
  { bad: true },
  { alerts: { enabled: "yes" } },
  { sources: { disabled: ["Currency"] } },
  { sources: { disabled: ["NoSuch"] } },
  { sources: { disabled: ["Idols", "Idols"] } },
  { freshness: { max_unchanged_hours: 0.5 } },
  { daily_report: { time: "24:00" } },
  { daily_report: { categories: [] } },
  { alerts: { max_per_day: 4 } },
  { alerts: { confirmation_checks: 1 } },
  { alerts: { category: { min_affected_percent: 101 } } },
  { alerts: { item: { window_hours: 168 } } },
  {
    classification: {
      overrides: [{ source: "Currency", id: "divine", group: null }],
    },
  },
  {
    classification: {
      overrides: [{ source: "Runes", id: "a", group: "uniques" }],
    },
  },
  {
    classification: {
      overrides: [{ source: "Abyss", id: "a", group: "crafting" }],
    },
  },
])
  test(`reject config ${JSON.stringify(invalid)}`, () =>
    assert.throws(() => configure(invalid, {})));
test("webhook validation does not disclose secret", () => {
  assert.throws(
    () => webhook({ GRYT_WEBHOOK_URL: "secret" }),
    (e) => !String(e).includes("secret"),
  );
  assert.equal(
    webhook({ GRYT_WEBHOOK_URL: "https://example.com/api/webhooks/a/b" }),
    "https://example.com/api/webhooks/a/b",
  );
});
test("source-specific conversion direction and activity", () => {
  const d = raw(100, 200);
  d.core.primary = "exalted";
  d.core.rates = { divine: 0.002, chaos: 0.02 } as never;
  const [o] = normalize(d, "Runes", "L", now, c);
  assert.equal(o!.price, 0.2);
  assert.equal(o!.activity, 0.4);
});
test("real differing source cores are retained", async () => {
  const a = normalize(await fixture("Currency"), "Currency", "L", now, c)[0]!;
  const b = normalize(
    await fixture("UniqueWeapons"),
    "UniqueWeapons",
    "L",
    now,
    c,
  )[0]!;
  assert.notEqual(a.rates.exalted, b.rates.exalted);
});
test("mixed IDs, exclusions, boss rules, dormant and activation", () => {
  assert.equal(
    classify("Ritual", "an-audience-with-the-king", c),
    "boss_fragments",
  );
  assert.equal(classify("Breach", "breach-splinter", c), null);
  assert.equal(classify("Fragments", "twilight-reliquary-key", c), null);
  assert.equal(classify("Abyss", "ancient-rib", c), null);
  const x = configure(
    {
      classification: {
        overrides: [
          { source: "Abyss", id: "ancient-rib", group: "boss_fragments" },
        ],
      },
    },
    {},
  );
  assert.ok(activeSources(x).includes("Abyss"));
  assert.equal(classify("Abyss", "ancient-rib", x), "boss_fragments");
  const y = configure(
    { sources: { disabled: ["Abyss"] }, classification: x.classification },
    {},
  );
  assert.equal(classify("Abyss", "ancient-rib", y), null);
  assert.ok(coverage(y, "boss_fragments").includes("Abyss"));
});
test("stash variants/corruption stay separate; overrides apply to all", () => {
  const x = configure(
    {
      classification: {
        overrides: [{ source: "UniqueWeapons", id: "id", group: null }],
      },
    },
    {},
  );
  const d = {
    core: raw().core,
    lines: [
      {
        itemId: "id",
        name: "Name",
        primaryValue: 2,
        listingCount: 50,
        variant: "A",
        corrupted: false,
      },
      {
        itemId: "id",
        name: "Name",
        primaryValue: 3,
        listingCount: 50,
        variant: "B",
        corrupted: true,
      },
    ],
  };
  const o = normalize(d, "UniqueWeapons", "L", now, x);
  assert.notEqual(o[0]!.key, o[1]!.key);
  assert.ok(o.every((x) => x.group === null));
});
test("baseline closest, tie earlier, endpoint activity, no zero or cross-league", () => {
  const h = emptyHistory("L");
  ingest(h, "Runes", raw(1), now - 7 * HOUR, c);
  ingest(h, "Runes", raw(2), now - 5 * HOUR, c);
  ingest(h, "Runes", raw(3), now, c);
  const o = h.sources.Runes!.observations[0]!;
  assert.equal(baseline(o, h, 6, c)!.price, 1);
  h.observations[0]!.activity = 0;
  assert.equal(baseline(o, h, 6, c)!.price, 2);
  h.observations[1]!.league = "Other";
  assert.equal(baseline(o, h, 6, c), undefined);
});
test("freshness ignores order, metadata and ETag changes", () => {
  const h = emptyHistory("L");
  ingest(h, "Runes", raw(), now, c, "a");
  ingest(h, "Runes", { ...raw(), irrelevant: "changed" }, now + HOUR, c, "b");
  assert.equal(h.sources.Runes!.changed, now);
  assert.ok(usable(h.sources.Runes, c, now + 2 * HOUR));
  assert.ok(!usable(h.sources.Runes, c, now + 2 * HOUR + 1));
});
test("304 advances retrieval, not content evidence or content freshness", async () => {
  const x = configure(
    { sources: { disabled: activeSources(c).filter((s) => s !== "Currency") } },
    {},
  );
  const h = emptyHistory("L");
  ingest(h, "Currency", raw(1, 100, "divine"), now, x, "e");
  await refresh(
    h,
    x,
    now + HOUR,
    fetcher(() => new Response(null, { status: 304 })),
  );
  assert.equal(h.sources.Currency!.changed, now);
  assert.equal(h.sources.Currency!.at, now + HOUR);
  assert.equal(h.sources.Currency!.observations[0]!.at, now + HOUR);
});
test("failures do not extend freshness, disabled sources never fetched", async () => {
  const x = configure(
    { sources: { disabled: activeSources(c).filter((s) => s !== "Currency") } },
    {},
  );
  const h = emptyHistory("L");
  ingest(h, "Currency", raw(1, 100, "divine"), now, x);
  let calls = 0;
  const e = await refresh(
    h,
    x,
    now + HOUR,
    fetcher(() => {
      calls++;
      return new Response("", { status: 503 });
    }),
  );
  assert.equal(calls, 1);
  assert.equal(e.length, 1);
  assert.equal(h.sources.Currency!.at, now);
  assert.ok(!usable(h.sources.Currency, x, now));
});
test("league discovery fallback and first failure", async () => {
  assert.equal(
    await discover(
      c,
      "Last",
      fetcher(() => {
        throw Error();
      }),
    ),
    "Last",
  );
  await assert.rejects(
    discover(
      c,
      null,
      fetcher(() => {
        throw Error();
      }),
    ),
  );
  assert.equal(
    await discover(
      c,
      null,
      fetcher(() => Response.json([{ id: "New" }])),
    ),
    "New",
  );
});
test("all rankings and split preserve rows; currency stays separate", () => {
  const { c, h, now } = demo();
  const p = report(h, c, now);
  p.forEach(validate);
  assert.ok(p.length > 1);
  const text = JSON.stringify(p);
  assert.ok(text.includes("Boss Fragments"));
  assert.ok(text.includes("Most expensive"));
  assert.ok(!text.includes("transmute:"));
  const cards = p.flatMap((p) => p.cards!);
  assert.equal(
    cards.filter((x) => x.title?.includes("Market movements")).length,
    4,
  );
  assert.equal(
    cards.filter((x) => x.title?.includes("Most expensive")).length,
    5,
  );
});
test("payload boundaries, unicode bytes and long name continuation", () => {
  assert.throws(() => validate({ cards: [{ description: "x".repeat(4001) }] }));
  assert.throws(() =>
    validate({ cards: Array(11).fill({ description: "a" }) }),
  );
  assert.throws(() =>
    validate({
      cards: [
        { description: "a".repeat(3500) },
        { description: "b".repeat(3500) },
      ],
    }),
  );
  const name = "𐐀".repeat(5000);
  const p = split([{ title: "Long name", description: name }]);
  assert.equal(
    p
      .flatMap((x) => x.cards!)
      .map((c) => c.description)
      .join(""),
    name,
  );
  p.forEach(validate);
});
test("reduced coverage disclosed and failed source blocks report", () => {
  const { h, now } = demo();
  const x = configure({ sources: { disabled: ["Idols"] } }, {});
  assert.ok(JSON.stringify(report(h, x, now)).includes("Reduced coverage"));
  h.sources.Runes!.error = "failed";
  assert.equal(complete(h, x, now), false);
  assert.ok(JSON.stringify(report(h, x, now)).includes("INCOMPLETE"));
});
test("percentile ties and singleton", () => {
  assert.equal(percentile([1], 1), 0.5);
  assert.equal(percentile([1, 1, 3], 1), 0.25);
});
test("individual confirmation, duplicate, cooldown, repeat-price and restart", () => {
  const { h, c, now } = demo();
  const s = emptyState();
  let out = signals(h, c, s, now);
  assert.equal(out.length, 0);
  assert.equal(signals(h, c, s, now + 1000).length, 0);
  for (const source of Object.values(h.sources))
    for (const o of source.observations) {
      o.evidence += "new";
      o.at += HOUR;
    }
  out = signals(h, c, s, now + HOUR);
  assert.ok(out.some((x) => x.source !== "group"));
  reserveSignals(s, out, now + HOUR);
  assert.equal(signals(h, c, s, now + HOUR).length, 0);
  recover(s);
  assert.ok(Object.values(s.memory).every((m) => !m.pending));
});
test("group denominator rounds upward and rearming persists", () => {
  const { h, c, now } = demo();
  const s = emptyState();
  signals(h, c, s, now);
  for (const source of Object.values(h.sources))
    for (const o of source.observations) {
      o.evidence += "new";
      o.at += HOUR;
    }
  const out = signals(h, c, s, now + HOUR);
  assert.ok(out.some((x) => x.source === "group" && x.denominator! >= 10));
  const group = out.find((x) => x.source === "group")!;
  reserveSignals(s, [group], now + HOUR);
  assert.equal(s.memory[group.key]!.armed, false);
});
for (const [status, body, expected] of [
  [200, { message_id: "m" }, "sent"],
  [200, {}, "unknown"],
  [500, {}, "unknown"],
  [400, {}, "rejected"],
  [404, {}, "rejected"],
  [413, {}, "rejected"],
  [429, { retry_after_ms: 60000 }, "retry"],
] as const)
  test(`delivery ${status}/${expected}`, async () => {
    const result = await post(
      "https://example.invalid",
      { text: "test" },
      fetcher(() => Response.json(body, { status })),
    );
    assert.equal(result.kind, expected);
  });
test("timeout and interrupted POST become unknown; sending persisted first", async () => {
  const part = { payload: { text: "t" }, status: "pending" as const };
  const states: string[] = [];
  await deliver(
    part,
    "x",
    async () => {
      states.push(part.status);
    },
    now,
    fetcher(() => {
      throw Error("secret URL");
    }),
  );
  assert.deepEqual(states, ["sending", "unknown"]);
  const s = emptyState();
  s.reports = [
    {
      day: "d",
      league: "L",
      epoch: "e",
      expires: now,
      parts: [{ payload: { text: "t" }, status: "sending" }],
    },
  ];
  recover(s);
  assert.equal(s.reports[0]!.parts[0]!.status, "unknown");
});
test("DST local dates, repeated times and nonexistent local time", () => {
  assert.deepEqual(localTime(Date.parse("2026-03-29T01:00Z"), "Europe/Riga"), {
    day: "2026-03-29",
    time: "04:00",
  });
  assert.equal(
    localTime(Date.parse("2026-10-25T00:30Z"), "Europe/Riga").time,
    "03:30",
  );
  assert.equal(
    localTime(Date.parse("2026-10-25T01:30Z"), "Europe/Riga").time,
    "03:30",
  );
});
test("scheduled report dedup survives league switch; cap reservations persist", async () => {
  const { h, c, now } = demo();
  const s = emptyState();
  await scheduled(h, c, s, now, async () => {});
  assert.equal(s.reports.length, 1);
  h.league = "New";
  await scheduled(h, c, s, now, async () => {});
  assert.equal(s.reports.length, 1);
  assert.equal(s.reports[0]!.league, "Demo League");
});
test("coverage changes cancel unsent parts but preserve delivery and cooldowns", async () => {
  const { h, c, now } = demo();
  const s = emptyState();
  await scheduled(h, c, s, now, async () => {});
  s.reports[0]!.parts[0]!.status = "sent";
  s.memory.x = {
    lastAt: 123,
    lastPrice: 4,
    pending: { count: 1, direction: 1, evidence: "e", at: now },
  };
  reconcile(s, configure({ sources: { disabled: ["Idols"] } }, {}));
  assert.equal(s.reports[0]!.parts[0]!.status, "sent");
  assert.ok(s.reports[0]!.parts.slice(1).every((p) => p.status === "canceled"));
  assert.equal(s.memory.x.lastAt, 123);
  assert.equal(s.memory.x.lastPrice, 4);
  assert.equal(s.memory.x.pending, undefined);
});
test("atomic storage, lock contention, corruption retained", async () => {
  const dir = await mkdtemp(join(tmpdir(), "poe-test-"));
  try {
    const release = await lock(dir);
    await assert.rejects(lock(dir));
    await release();
    const h = emptyHistory("L");
    await saveHistory(dir, h);
    assert.deepEqual(await loadHistory(dir, "L"), h);
    await saveState(dir, emptyState());
    assert.equal((await loadState(dir)).version, 1);
    await writeFile(join(dir, "state.json"), "{broken");
    await assert.rejects(loadState(dir));
    assert.equal(await readFile(join(dir, "state.json"), "utf8"), "{broken");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("offline demo command cannot fetch or modify production state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "poe-demo-"));
  try {
    const script =
      "globalThis.fetch=()=>{throw Error('Network forbidden')};console.log=()=>{};const {main}=await import('./dist/cli.js');await main(['preview','--demo']);";
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { env: { ...process.env, DATA_DIR: dir }, encoding: "utf8" },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(stat(join(dir, "state.json")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("daily allowance persists after reservations and restart", async () => {
  const { h, c, now } = demo();
  const s = emptyState();
  s.epoch = epoch(c);
  s.alerts = Array.from({ length: 3 }, () => ({
    day: localTime(now, c.timezone).day,
    expires: now + HOUR,
    signals: [],
    part: { payload: { text: "prior" }, status: "unknown" as const },
  }));
  signals(h, c, s, now);
  for (const source of Object.values(h.sources))
    for (const o of source.observations) {
      o.evidence += "new";
      o.at += HOUR;
    }
  await scheduled(h, c, s, now + HOUR, async () => {});
  assert.equal(s.alerts.length, 3);
  recover(s);
  assert.equal(s.alerts.length, 3);
});
test("unrelated updates cannot confirm a group; stale cycles reset pending", () => {
  const { h, c, now } = demo();
  const s = emptyState();
  signals(h, c, s, now);
  h.sources.Currency!.fingerprint = "unrelated";
  assert.equal(signals(h, c, s, now + 1000).length, 0);
  signals(h, c, s, now + 4 * HOUR);
  assert.ok(Object.values(s.memory).every((m) => !m.pending));
});
test("source disabled data ignored, and Currency baseline survives unrelated mapping edit", () => {
  const { h, c, now } = demo();
  const o = h.sources.Currency!.observations.find((o) => o.id === "divine")!;
  const x = configure({ sources: { disabled: ["Idols"] } }, {});
  assert.ok(!current(h, x, now).some((o) => o.source === "Idols"));
  assert.ok(baseline(o, h, 24, x));
});
test("explicit 429 retries reuse the same persisted part", async () => {
  const part = { payload: { text: "t" }, status: "pending" as const };
  let calls = 0;
  const net = fetcher(() => {
    calls++;
    return calls === 1
      ? Response.json({ retry_after_ms: 3000 }, { status: 429 })
      : Response.json({ message_id: "m" });
  });
  await deliver(part, "x", async () => {}, now, net);
  assert.equal(part.status, "pending");
  await deliver(part, "x", async () => {}, now + 1000, net);
  assert.equal(calls, 1);
  await deliver(part, "x", async () => {}, now + 3000, net);
  assert.equal(part.status, "sent");
  assert.equal(calls, 2);
});
test("valid JSON with invalid nested delivery state blocks sends", async () => {
  const dir = await mkdtemp(join(tmpdir(), "poe-corrupt-"));
  try {
    await atomic(join(dir, "state.json"), {
      ...emptyState(),
      memory: { x: { lastPrice: -4 } },
    });
    await assert.rejects(loadState(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("check and stored preview are read-only and never contact Gryt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "poe-readonly-"));
  const env = { ...process.env };
  const original = globalThis.fetch;
  try {
    const { h, now } = demo();
    process.env.DATA_DIR = dir;
    process.env.CONFIG_PATH = join(dir, "missing.yaml");
    const s = emptyState();
    s.league = h.league;
    await saveHistory(dir, h);
    await saveState(dir, s);
    const before = await readFile(join(dir, "state.json"), "utf8");
    const historyBefore = await readFile(historyPath(dir, h.league), "utf8");
    globalThis.fetch = fetcher(async (url: string, options: RequestInit) => {
      assert.notEqual(options.method, "POST");
      if (url.endsWith("/leagues")) return Response.json([{ id: h.league }]);
      const source = new URL(url).searchParams.get("type")!;
      return Response.json(await fixture(source));
    });
    await main(["check"], () => {});
    await main(["preview"], () => {});
    assert.equal(await readFile(join(dir, "state.json"), "utf8"), before);
    assert.equal(
      await readFile(historyPath(dir, h.league), "utf8"),
      historyBefore,
    );
  } finally {
    globalThis.fetch = original;
    process.env = env;
    await rm(dir, { recursive: true, force: true });
  }
});
test("currency anchor ratios use the pair, independent of Div-price change", () => {
  const { h, c, now } = demo();
  const text = currencyCard(h, c, now).description!;
  assert.match(text, /Divine \/ Exalted\*\* — 500 Ex per Div/);
  assert.match(text, /Chaos \/ Exalted\*\* — 50 Ex per Chaos/);
  assert.match(text, /Mirror \/ Divine\*\* — 800 Div per Mirror/);
});
test("report timer can publish between refreshes without advancing alert evidence", async () => {
  const { h, c, now } = demo();
  const s = emptyState();
  s.epoch = epoch(c);
  await scheduled(h, c, s, now, async () => {}, false);
  assert.equal(s.reports.length, 1);
  assert.equal(Object.keys(s.memory).length, 0);
  const parts = JSON.stringify(s.reports[0]!.parts);
  await scheduled(h, c, s, now + 1000, async () => {}, false);
  assert.equal(JSON.stringify(s.reports[0]!.parts), parts);
});
test("manual currency delivery leaves scheduled state and history unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "poe-manual-"));
  const env = { ...process.env };
  const original = globalThis.fetch;
  try {
    const { h, now } = demo();
    const delta = Date.now() - now;
    for (const source of Object.values(h.sources)) {
      source.at += delta;
      source.changed += delta;
      for (const o of source.observations) o.at += delta;
    }
    for (const o of h.observations) o.at += delta;
    const s = emptyState();
    s.league = h.league;
    await saveState(dir, s);
    await saveHistory(dir, h);
    process.env.DATA_DIR = dir;
    process.env.CONFIG_PATH = join(dir, "missing.yaml");
    process.env.GRYT_WEBHOOK_URL =
      "https://example.invalid/api/webhooks/test/secret";
    const before = await readFile(join(dir, "state.json"), "utf8");
    let posts = 0;
    globalThis.fetch = fetcher((url: string, options: RequestInit) => {
      assert.equal(options.method, "POST");
      posts++;
      return Response.json({ message_id: "manual" });
    });
    await main(["report-currency"], () => {});
    assert.equal(posts, 1);
    assert.equal(await readFile(join(dir, "state.json"), "utf8"), before);
  } finally {
    globalThis.fetch = original;
    process.env = env;
    await rm(dir, { recursive: true, force: true });
  }
});
test("first-fetch 429 honors an HTTP-date Retry-After without corrupting state", async () => {
  const x = configure(
    { sources: { disabled: activeSources(c).filter((s) => s !== "Currency") } },
    {},
  );
  const h = emptyHistory("L");
  let calls = 0;
  const net = fetcher(() => {
    calls++;
    return new Response("", {
      status: 429,
      headers: { "retry-after": new Date(now + 3 * HOUR).toUTCString() },
    });
  });
  await refresh(h, x, now, net);
  assert.equal(h.sources.Currency!.nextFetch, now + 3 * HOUR);
  await refresh(h, x, now + HOUR, net);
  assert.equal(calls, 1);
  assert.ok(JSON.stringify(h).includes("Rate limited"));
});
test("unknown inherited config keys are rejected", () =>
  assert.throws(() => configure(JSON.parse('{"__proto__":{}}'), {})));
test("restart never backfills a queued alert and preserves its reservation", () => {
  const s = emptyState();
  s.alerts = [
    {
      day: "2026-01-15",
      expires: now + HOUR,
      signals: [],
      part: { payload: { text: "queued" }, status: "pending" },
    },
  ];
  recover(s);
  assert.equal(s.alerts.length, 1);
  assert.equal(s.alerts[0]!.part.status, "canceled");
});

const selectedFragments = [
  ["simulacrum", "Simulacrum"],
  ["cowardly-fate", "Cowardly Fate"],
  ["faded-crisis-fragment", "Faded Crisis Fragment"],
  ["kulemaks-invitation", "Kulemak's Invitation"],
  ["victorious-fate", "Victorious Fate"],
  ["breachlord-sac", "Breachlord Sac"],
  ["deadly-fate", "Deadly Fate"],
  ["weathered-crisis-fragment", "Weathered Crisis Fragment"],
  ["call-of-the-shadows", "Call of the Shadows"],
  ["ancient-crisis-fragment", "Ancient Crisis Fragment"],
  ["ravens-reflection", "Raven's Reflection"],
  ["origin-cradle", "Origin Cradle"],
  ["origin-spark", "Origin Spark"],
  ["origin-core", "Origin Core"],
] as const;

test("Fragments membership exactly matches the screenshot's 14 names and API IDs", async () => {
  const data = await fixture("Fragments");
  const observations = normalize(data, "Fragments", "L", now, c);
  const selected = new Set(selectedFragments.map(([id]) => id));
  assert.deepEqual(new Set(bossIds.Fragments), selected);
  for (const [id, name] of selectedFragments) {
    assert.equal(
      data.items.find((item: { id: string }) => item.id === id)?.name,
      name,
    );
    const row = observations.find((o) => o.id === id)!;
    assert.equal(row.name, name);
    assert.equal(row.group, "boss_fragments");
    assert.ok(row.activity >= c.liquidity.boss_fragments_min_volume_divine);
  }
  assert.ok(
    observations
      .filter((o) => !selected.has(o.id as never))
      .every((o) => o.group === null),
  );
  assert.equal(
    classify("Ritual", "an-audience-with-the-king", c),
    "boss_fragments",
  );
  assert.equal(classify("Breach", "breachstone", c), "boss_fragments");
  assert.equal(classify("Fragments", "unreviewed-future-entry", c), null);
});

test("selected Fragments support top-ten ranking and a confirmed group alert without lowering filters", async () => {
  const config = configure(
    {
      sources: { disabled: ["Ritual", "Breach"] },
      daily_report: { categories: ["boss_fragments"] },
    },
    {},
  );
  const h = emptyHistory("L");
  const state = emptyState();
  const fragments = await fixture("Fragments");
  const currency = await fixture("Currency");
  const stage = (at: number, factor: number) => {
    const data = structuredClone(fragments);
    for (const row of data.lines) row.primaryValue *= factor;
    const money = structuredClone(currency);
    for (const row of money.lines) row.volumePrimaryValue += factor;
    ingest(h, "Currency", money, at, config);
    ingest(h, "Fragments", data, at, config);
  };
  stage(now - 24 * HOUR, 1);
  stage(now - 6 * HOUR, 1);
  stage(now - HOUR, 1.3);
  assert.equal(signals(h, config, state, now - HOUR).length, 0);
  stage(now, 1.4);
  const selected = current(h, config, now).filter(
    (o) => o.group === "boss_fragments",
  );
  assert.equal(selected.length, 14);
  const group = signals(h, config, state, now).find(
    (s) =>
      s.source === "group" && s.group === "boss_fragments" && s.direction === 1,
  );
  assert.ok(group);
  assert.equal(group.denominator, 14);
  assert.equal(group.count, 14);
  const cards = report(h, config, now).flatMap((p) => p.cards!);
  const ranking = cards.find(
    (card) => card.title === "🗝️ Boss Fragments — Most expensive",
  )!;
  const expected = selected
    .sort((a, b) => b.price - a.price || a.key.localeCompare(b.key))
    .slice(0, 10);
  const rows = ranking
    .description!.split("\n")
    .filter((line) => /^\*\*\d+\.\*\*/.test(line));
  assert.equal(rows.length, 10);
  expected.forEach((o, i) =>
    assert.ok(rows[i]!.startsWith(`**${i + 1}.** ${o.name} —`)),
  );
});

test("built-in membership updates invalidate old report plans and excluded history", async () => {
  const added = "origin-core";
  const ids = bossIds.Fragments!;
  const index = ids.indexOf(added);
  const h = emptyHistory("L");
  const data = await fixture("Fragments");
  let previousEpoch: string;
  ids.splice(index, 1);
  try {
    previousEpoch = epoch(c);
    ingest(h, "Fragments", data, now - 24 * HOUR, c);
    assert.equal(h.observations.find((o) => o.id === added)!.group, null);
  } finally {
    ids.splice(index, 0, added);
  }
  assert.notEqual(epoch(c), previousEpoch!);
  ingest(h, "Fragments", data, now, c);
  assert.equal(
    baseline(
      h.sources.Fragments!.observations.find((o) => o.id === added)!,
      h,
      24,
      c,
    ),
    undefined,
  );
  const state = emptyState();
  state.epoch = previousEpoch!;
  state.reports = [
    {
      day: "2026-01-15",
      league: "L",
      epoch: previousEpoch!,
      expires: now + HOUR,
      parts: [
        { payload: { text: "sent" }, status: "sent", messageId: "m" },
        { payload: { text: "unknown" }, status: "unknown" },
        { payload: { text: "pending" }, status: "pending" },
      ],
    },
  ];
  state.memory.item = {
    lastAt: now - 1000,
    lastPrice: 5,
    pending: { direction: 1, count: 1, evidence: "old", at: now },
  };
  reconcile(state, c);
  assert.deepEqual(
    state.reports[0]!.parts.map((p) => p.status),
    ["sent", "unknown", "canceled"],
  );
  assert.equal(state.memory.item.lastAt, now - 1000);
  assert.equal(state.memory.item.lastPrice, 5);
  assert.equal(state.memory.item.pending, undefined);
});
