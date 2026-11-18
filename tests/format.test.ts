import { test } from "node:test";
import assert from "node:assert/strict";
import { configure } from "../dist/config.js";
import { demo } from "../dist/demo.js";
import { showcase } from "../dist/showcase.js";
import {
  alertPayload,
  categoryStyles,
  currencyCard,
  percent,
  price,
  report,
  split,
  validate,
} from "../dist/format.js";
import { current, ingest } from "../dist/market.js";
import { emptyHistory, HOUR } from "../dist/model.js";

function example() {
  const c = configure(
    {
      daily_report: { categories: ["socketable"] },
      sources: { disabled: ["SoulCores", "Idols"] },
    },
    {},
  );
  const h = emptyHistory("Example League");
  const now = Date.UTC(2026, 0, 15, 9);
  const data = (rows) => ({
    core: {
      primary: "divine",
      rates: { exalted: 500, chaos: 10 },
      items: rows.map((r) => ({ id: r.id, name: r.name })),
    },
    lines: rows.map((r) => ({ ...r, volumePrimaryValue: 100 })),
  });
  const old = [
    { id: "body-rune", name: "Body Rune", primaryValue: 2.1875 },
    { id: "mind-rune", name: "Mind Rune", primaryValue: 1.4 / 0.81 },
    { id: "stable", name: "Ancient Rune of the Titan", primaryValue: 8 },
  ];
  ingest(h, "Runes", data(old), now - 24 * HOUR, c);
  ingest(
    h,
    "Runes",
    data(
      old.map((r) => ({
        ...r,
        primaryValue:
          r.id === "body-rune"
            ? 2.8
            : r.id === "mind-rune"
              ? 1.4
              : r.primaryValue,
      })),
    ),
    now,
    c,
  );
  ingest(
    h,
    "Currency",
    data([
      { id: "divine", name: "Divine Orb", primaryValue: 1 },
      { id: "exalted", name: "Exalted Orb", primaryValue: 0.002 },
      { id: "chaos", name: "Chaos Orb", primaryValue: 0.1 },
      { id: "mirror", name: "Mirror of Kalandra", primaryValue: 800 },
    ]),
    now,
    c,
  );
  return { c, h, now };
}
function signal(group = "socketable", extra = {}) {
  return {
    key: "item",
    group,
    direction: 1,
    price: 2.8,
    baseline: 2.1875,
    percent: 28,
    activity: 100,
    source: "Runes",
    name: "Body Rune",
    evidence: "fresh",
    interval: 6,
    score: 1,
    ...extra,
  };
}

test("one movement card per category contains both directions in the requested Markdown layout", () => {
  const { c, h, now } = example();
  const cards = report(h, c, now).flatMap((p) => p.cards);
  const movement = cards.filter((c) => c.title.includes("Market movements"));
  assert.equal(movement.length, 1);
  assert.equal(
    movement[0].title,
    "🔮 Socketable Currency — Market movements · 24h",
  );
  assert.match(
    movement[0].description,
    /\*\*Gainers\*\*\n\n🟩 \*\*\+28%\*\* · Body Rune — 2\.8 Div/,
  );
  assert.match(
    movement[0].description,
    /\*\*Losers\*\*\n\n🟥 \*\*−19%\*\* · Mind Rune — 1\.4 Div/,
  );
  assert.ok(!movement[0].description.includes("Ancient Rune of the Titan"));
  assert.ok(cards.every((c) => c.fields === undefined));
});

test("category icons, human names and accent colors are distinct and consistent across report and alert cards", () => {
  const { c, h, now } = demo();
  const cards = report(h, c, now).flatMap((p) => p.cards);
  assert.equal(
    new Set(Object.values(categoryStyles).map((s) => s.icon)).size,
    5,
  );
  assert.equal(
    new Set(Object.values(categoryStyles).map((s) => s.color)).size,
    5,
  );
  for (const [group, style] of Object.entries(categoryStyles)) {
    const category = cards.filter((c) =>
      c.title.startsWith(`${style.icon} ${style.name} —`),
    );
    assert.equal(category.length, group === "boss_fragments" ? 1 : 2);
    for (const card of category) assert.equal(card.color, style.color);
    const alert = alertPayload([signal(group)], c).cards[0];
    assert.equal(alert.color, style.color);
    assert.equal(alert.title, `${style.icon} ${style.name} — Market alert`);
    assert.ok(!alert.title.includes("_"));
  }
});

for (const [n, ex, expected] of [
  [2.8, 500, "2.8 Div"],
  [1, 500, "1 Div"],
  [12.34, 500, "12.34 Div"],
  [0.002, 500, "1 Ex"],
  [0.0000004, 500, "0.0002 Ex"],
  [0.5, undefined, "unavailable"],
  [0, 500, "unavailable"],
])
  test(`compact price ${n}: ${expected}`, () =>
    assert.equal(price(n, ex), expected));
for (const [n, expected] of [
  [28, "+28%"],
  [-19, "−19%"],
  [28.25, "+28.3%"],
  [0, "0%"],
  [undefined, "—"],
  [NaN, "—"],
  [-0.0001, "−0.0001%"],
])
  test(`compact signed percentage ${n}: ${expected}`, () =>
    assert.equal(percent(n), expected));

test("currency cards use clear pair units, compact rates and the same ranked-row style", () => {
  const { c, h, now } = demo();
  const card = currencyCard(h, c, now);
  assert.equal(card.title, "💰 Currency rates — 24h");
  assert.equal(card.color, "#EAB308");
  assert.match(card.description, /\*\*Divine \/ Exalted\*\* — 500 Ex per Div/);
  assert.match(card.description, /\*\*Chaos \/ Exalted\*\* — 50 Ex per Chaos/);
  assert.match(
    card.description,
    /\*\*Mirror \/ Divine\*\* — 800 Div per Mirror/,
  );
  assert.match(
    card.description,
    /\*\*1\.\*\* .* — \d+(?:\.\d+)? (?:Ex|Div) · ⚪ \*\*0%\*\*/,
  );
  assert.doesNotMatch(card.description, /\d+\.0+(?: Div| Ex|%)/);
});

test("expensive rankings preserve price order, numbering and unavailable changes", () => {
  const { c, h, now } = example();
  h.observations = [];
  const rank = report(h, c, now)
    .flatMap((p) => p.cards)
    .find((c) => c.title.endsWith("Most expensive"));
  assert.equal(
    rank.description.split("\n\n").at(-1).split("\n")[0].trimEnd(),
    "**1.** Ancient Rune of the Titan — 8 Div · ⚪ **—**",
  );
  const lines = rank.description
    .split("\n")
    .filter((line) => /^\*\*\d+/.test(line));
  assert.equal(lines.length, 3);
  assert.ok(lines[1].startsWith("**2.** Body Rune — 2.8 Div"));
  assert.ok(lines[2].startsWith("**3.** Mind Rune — 1.4 Div"));
});

test("alerts retain actual baseline, interval, source and selected order with category styling", () => {
  const { c } = demo();
  const selected = [
    signal(),
    signal("uniques", {
      name: "Headhunter",
      source: "UniqueAccessories",
      percent: -19,
      price: 1.4,
      direction: -1,
    }),
    signal("socketable", { name: "Mind Rune", interval: 6.25 }),
  ];
  const before = JSON.stringify(selected);
  const payload = alertPayload(selected, c);
  assert.equal(payload.cards.length, 3);
  assert.match(
    payload.cards[0].description,
    /🟩 \*\*\+28%\*\* · Body Rune — 2\.8 Div/,
  );
  assert.match(
    payload.cards[0].description,
    /Baseline: 2\.188 Div → 2\.8 Div · Window: \*\*6h\*\* · Source: Runes/,
  );
  assert.match(
    payload.cards[1].description,
    /🟥 \*\*−19%\*\* · Headhunter — 1\.4 Div/,
  );
  assert.match(payload.cards[1].description, /Unique Accessories/);
  assert.match(payload.cards[2].description, /\*\*6\.25h\*\*/);
  assert.equal(JSON.stringify(selected), before);
  validate(payload);
});

test("group alerts distinguish an affected share from a price change and preserve reduced coverage", () => {
  const c = configure({ sources: { disabled: ["Idols"] } }, {});
  const group = signal("socketable", {
    source: "group",
    count: 6,
    denominator: 14,
    interval: 24,
    percent: -15,
    direction: -1,
  });
  const card = alertPayload([group], c).cards[0];
  assert.match(
    card.description,
    /🟥 \*\*6\/14 items\*\* moved down by at least \*\*15%\*\* over \*\*24h\*\*/,
  );
  assert.match(card.description, /Reduced coverage; excluded sources: Idols/);
  assert.doesNotMatch(card.description, /Baseline|−15%/);
});

test("external item names and variants are escaped as Markdown text", () => {
  const { c, h, now } = example();
  const row = h.sources.Runes.observations.find((o) => o.id === "body-rune");
  row.name = "Rune *[example]* `code` \\ path";
  row.variant = "[10%]";
  const text = report(h, c, now)
    .flatMap((p) => p.cards)
    .map((c) => c.description)
    .join("\n");
  assert.ok(
    text.includes("Rune \\*\\[example\\]\\* \\`code\\` \\\\ path (\\[10%\\])"),
  );
  assert.ok(!text.includes("Rune *[example]*"));
});

test("split preserves styling, numbering and every Unicode character at payload limits", () => {
  const description = (
    "🟩 **+28%** · " +
    "𐐀".repeat(2200) +
    " — 2.8 Div\n"
  ).repeat(3);
  const parts = split([
    {
      title: "🔮 Socketable Currency — Market movements · 24h",
      color: "#8B5CF6",
      description,
    },
  ]);
  const cards = parts.flatMap((p) => p.cards);
  assert.equal(cards.map((c) => c.description).join(""), description);
  assert.ok(cards.every((c) => c.color === "#8B5CF6"));
  assert.ok(cards.some((c) => c.title.endsWith("(continued)")));
  for (const [i, p] of parts.entries()) {
    validate(p);
    assert.equal(p.text, `Part ${i + 1}/${parts.length}`);
  }
});

test("accent colors validate against Gryt string and integer forms", () => {
  for (const color of ["#8B5CF6", 0, 0xffffff])
    validate({ cards: [{ description: "text", color }] });
  for (const color of ["red", "#123", -1, 0x1000000, 1.5])
    assert.throws(() => validate({ cards: [{ description: "text", color }] }));
});

test("demo labels are realistic while technical identities remain synthetic", () => {
  const { c, h, now } = demo();
  const text = JSON.stringify(report(h, c, now));
  assert.match(text, /Carved Majesty|Aldur's Legacy/);
  assert.match(text, /Headhunter|Choir of the Storm/);
  assert.doesNotMatch(
    text,
    /Uniqueaccessories \d|Runes \d|Lineagesupportgems \d|Essences \d/,
  );
  assert.ok(current(h, c, now).some((o) => o.id === "lineagesupportgems-0"));
});

test("complete showcase retains all cases, demo labels, style and valid payloads", () => {
  const suite = showcase();
  assert.equal(suite.cases.length, 13);
  assert.deepEqual(showcase(), suite);
  for (const scenario of suite.cases)
    for (const message of scenario.messages) {
      validate(message);
      assert.ok(message.text.startsWith("[DEMO]"));
      for (const card of message.cards) {
        assert.ok(card.title.startsWith("[DEMO]"));
        assert.match(card.color, /^#[\da-fA-F]{6}$/);
        assert.equal(card.fields, undefined);
      }
    }
});
