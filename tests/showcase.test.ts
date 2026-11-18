import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { showcase, sendShowcase } from "../dist/showcase.js";
import { categoryStyles, validate } from "../dist/format.js";
import { bossIds } from "../dist/market.js";
import { demo } from "../dist/demo.js";
import { main } from "../dist/cli.js";

const url = "https://test.example/api/webhooks/test/fake-secret";
const caseIds = [
  "daily",
  "currency",
  "fragments",
  "item-up",
  "item-down",
  "group-up",
  "group-down",
  "combined",
  "no-history",
  "empty",
  "reduced",
  "stale",
  "long-names",
];

test("complete suite is deterministic, labeled, validated and covers every case", () => {
  const suite = showcase();
  assert.deepEqual(showcase(), suite);
  assert.deepEqual(new Set(suite.cases.map((c) => c.id)), new Set(caseIds));
  assert.equal(
    suite.totalMessages,
    suite.cases.reduce((n, c) => n + c.messages.length, 0),
  );
  for (const scenario of suite.cases)
    for (const [i, payload] of scenario.messages.entries()) {
      validate(payload);
      assert.ok(payload.text.startsWith(`[DEMO] ${scenario.id}`));
      assert.ok(
        payload.text.endsWith(`Part ${i + 1}/${scenario.messages.length}`),
      );
      assert.ok(payload.cards.every((c) => c.title.startsWith("[DEMO]")));
    }
});

test("alert cases render both directions for all groups and preserve three combined examples", () => {
  for (const id of [
    "item-up",
    "item-down",
    "group-up",
    "group-down",
    "combined",
  ]) {
    const scenario = showcase(id).cases[0];
    assert.equal(scenario.messages.length, 5);
    for (const group of [
      "socketable",
      "lineage_supports",
      "crafting",
      "uniques",
      "boss_fragments",
    ])
      assert.ok(
        scenario.messages.some((p) =>
          p.cards[0].title.includes(categoryStyles[group].name),
        ),
      );
    const text = JSON.stringify(scenario.messages);
    if (id.startsWith("item-"))
      assert.ok(text.includes(id.endsWith("up") ? "+50%" : "−50%"));
    if (id.startsWith("group-"))
      assert.ok(text.includes(id.endsWith("up") ? "moved up" : "moved down"));
    if (id === "combined")
      assert.equal((text.match(/2 Div → 3 Div/g) || []).length, 15);
  }
});

test("full daily report fills all rankings and Fragments case shows the complete selected list", () => {
  const daily = showcase("daily").cases[0];
  const cards = daily.messages.flatMap((p) => p.cards);
  const rankings = cards.filter((c) =>
    /Market movements|Most expensive/.test(c.title),
  );
  const rows = rankings.flatMap((c) =>
    c.description
      .split("\n")
      .filter((line) => /^[🟩🟥]|^\*\*\d+\.\*\*/u.test(line)),
  );
  assert.equal(rows.length, 90);
  assert.ok(JSON.stringify(daily).includes("High roll"));
  assert.ok(JSON.stringify(daily).includes("corrupted"));
  const { h } = demo();
  const fragmentNames = h.sources.Fragments.observations.map((o) => o.name);
  assert.equal(fragmentNames.length, 14);
  assert.equal(bossIds.Fragments.length, 14);
  const fragmentText = JSON.stringify(showcase("fragments"));
  for (const name of fragmentNames) assert.ok(fragmentText.includes(name));
});

test("edge cases render unavailable comparisons, empty rankings, coverage and continuations", () => {
  assert.ok(JSON.stringify(showcase("no-history")).includes("—"));
  assert.ok(JSON.stringify(showcase("empty")).includes("no eligible items"));
  assert.ok(JSON.stringify(showcase("reduced")).includes("Reduced coverage"));
  assert.ok(JSON.stringify(showcase("reduced")).includes("Idols"));
  assert.ok(JSON.stringify(showcase("stale")).includes("STALE / INCOMPLETE"));
  const long = showcase("long-names").cases[0];
  assert.ok(long.messages.length > showcase("daily").totalMessages);
  assert.ok(JSON.stringify(long).includes("continued"));
  assert.ok(JSON.stringify(long).includes("Unicode Ω and 𐐀"));
});

test("unknown case is rejected before sending", () =>
  assert.throws(() => showcase("not-a-case"), /Available:/));

test("mocked batch posts the exact preview payloads with two-second pacing", async () => {
  const suite = showcase("combined");
  const posted = [];
  const delays = [];
  const logs = [];
  const ok = await sendShowcase(
    url,
    suite,
    (line) => logs.push(line),
    async (target, options) => {
      assert.equal(target, url);
      assert.equal(options.method, "POST");
      posted.push(JSON.parse(options.body));
      return Response.json({
        message_id: `demo-${posted.length}`,
        warnings: [],
      });
    },
    async (ms) => {
      delays.push(ms);
    },
  );
  assert.equal(ok, true);
  assert.deepEqual(posted, suite.cases[0].messages);
  assert.deepEqual(delays, [2000, 2000, 2000, 2000]);
  assert.ok(logs.join("\n").includes("demo-5"));
  assert.ok(!logs.join("\n").includes("fake-secret"));
});

for (const kind of ["unknown", "rejected", "rate-limited", "timeout"])
  test(`batch stops without retry after ${kind}`, async () => {
    let calls = 0;
    const delays = [];
    const logs = [];
    const ok = await sendShowcase(
      url,
      showcase("item-up"),
      (line) => logs.push(line),
      async () => {
        calls++;
        if (calls === 1) return Response.json({ message_id: "first" });
        if (kind === "timeout") throw Error("fake-secret");
        return kind === "unknown"
          ? Response.json({}, { status: 503 })
          : kind === "rejected"
            ? Response.json({}, { status: 400 })
            : Response.json({ retry_after_ms: 60000 }, { status: 429 });
      },
      async (ms) => {
        delays.push(ms);
      },
    );
    assert.equal(ok, false);
    assert.equal(calls, 2);
    assert.deepEqual(delays, [2000]);
    assert.ok(logs.at(-1).includes("without automatic retry"));
    assert.ok(!logs.join("\n").includes("fake-secret"));
  });

test("all payloads validated before the first POST", async () => {
  const suite = showcase("item-up");
  suite.cases[0].messages[1].text = "x".repeat(4001);
  let calls = 0;
  await assert.rejects(
    sendShowcase(
      url,
      suite,
      () => {},
      async () => {
        calls++;
        return Response.json({ message_id: "never" });
      },
    ),
  );
  assert.equal(calls, 0);
});

test("demo preview ignores invalid production files; demo send uses only dedicated test URL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "poe-showcase-"));
  const env = { ...process.env };
  const original = globalThis.fetch;
  try {
    await writeFile(join(dir, "config.yaml"), "invalid: [");
    await writeFile(join(dir, "state.json"), "corrupted production state");
    process.env.CONFIG_PATH = join(dir, "config.yaml");
    process.env.DATA_DIR = dir;
    process.env.GRYT_WEBHOOK_URL =
      "https://production.example/api/webhooks/prod/prod-secret";
    delete process.env.GRYT_TEST_WEBHOOK_URL;
    let calls = 0;
    globalThis.fetch = async (target, options) => {
      calls++;
      assert.equal(target, url);
      assert.equal(options.method, "POST");
      return Response.json({ message_id: "test-only" });
    };
    let preview = "";
    await main(["preview", "--demo", "--all"], (line) => {
      preview = line;
    });
    assert.equal(JSON.parse(preview).cases.length, 13);
    assert.equal(calls, 0);
    await assert.rejects(
      main(["send-test", "--demo", "--case", "currency"], () => {}),
      /GRYT_TEST_WEBHOOK_URL/,
    );
    assert.equal(calls, 0);
    process.env.GRYT_TEST_WEBHOOK_URL = url;
    await main(["send-test", "--demo", "--case", "currency"], () => {});
    assert.equal(calls, 1);
    assert.deepEqual((await readdir(dir)).sort(), [
      "config.yaml",
      "state.json",
    ]);
    assert.equal(
      await readFile(join(dir, "config.yaml"), "utf8"),
      "invalid: [",
    );
    assert.equal(
      await readFile(join(dir, "state.json"), "utf8"),
      "corrupted production state",
    );
  } finally {
    globalThis.fetch = original;
    process.env = env;
    await rm(dir, { recursive: true, force: true });
  }
});

test("invalid combinations of demo flags do not cause delivery", async () => {
  for (const args of [
    ["send-test", "--all"],
    ["preview", "--all"],
    ["check", "--demo"],
    ["preview", "--demo", "--case"],
    ["send-test", "--demo", "--demo"],
    ["preview", "--case", "daily"],
  ])
    await assert.rejects(
      main(args, () => {}),
      /Usage:/,
    );
});

test("CLI demo failure reports nonzero exit status without retry or production fallback", async () => {
  const env = { ...process.env };
  const original = globalThis.fetch;
  const previousExit = process.exitCode;
  try {
    process.env.GRYT_TEST_WEBHOOK_URL = url;
    process.env.GRYT_WEBHOOK_URL =
      "https://production.example/api/webhooks/prod/prod-secret";
    let calls = 0;
    const logs = [];
    globalThis.fetch = async (target) => {
      calls++;
      assert.equal(target, url);
      return Response.json({}, { status: 503 });
    };
    await main(["send-test", "--demo", "--case", "currency"], (line) =>
      logs.push(line),
    );
    assert.equal(calls, 1);
    assert.equal(process.exitCode, 1);
    assert.ok(logs.join("\n").includes('"kind":"unknown"'));
    assert.ok(!logs.join("\n").includes("prod-secret"));
  } finally {
    globalThis.fetch = original;
    process.env = env;
    process.exitCode = previousExit;
  }
});
