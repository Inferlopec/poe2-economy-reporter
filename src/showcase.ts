import type { Fetch } from "./api.js";
import { demo } from "./demo.js";
import { post } from "./delivery.js";
import { alertPayload, report, split, validate } from "./format.js";
import { current } from "./market.js";
import { groups, HOUR } from "./model.js";
import type { Group, Payload, Signal } from "./model.js";

export interface DemoCase {
  id: string;
  title: string;
  messages: Payload[];
}
export interface Showcase {
  note: string;
  totalMessages: number;
  cases: DemoCase[];
}

// Exercise the production formatters; only the inputs and visible DEMO labels differ.
export function showcase(caseId?: string): Showcase {
  const { c, h, now } = demo();
  const cases: DemoCase[] = [];
  function add(
    id: string,
    title: string,
    payloads: Payload[],
    isReport = false,
  ) {
    const marked = payloads.map((payload) => ({
      ...payload,
      cards: payload.cards!.map((card) => ({
        ...card,
        title: `[DEMO] ${card.title}`,
      })),
    }));
    const messages = isReport ? split(marked.flatMap((p) => p.cards)) : marked;
    for (const [i, payload] of messages.entries()) {
      payload.text = `[DEMO] ${id} — ${title} — Part ${i + 1}/${messages.length}`;
      validate(payload);
    }
    cases.push({ id, title, messages });
  }
  add("daily", "Complete daily report", report(h, c, now), true);
  add("currency", "Manual currency report", report(h, c, now, true), true);
  const fragments = demo({
    sources: { disabled: ["Ritual", "Breach"] },
    daily_report: { categories: ["boss_fragments"], top_expensive: 14 },
  });
  add(
    "fragments",
    "All 14 selected Fragments",
    report(fragments.h, fragments.c, fragments.now),
    true,
  );
  const observations = current(h, c, now);
  function item(group: Group, direction: number, index = 0): Signal {
    const samples = observations.filter((o) => o.group === group);
    const o = samples[index % samples.length]!;
    return {
      key: `demo:${group}:${index}`,
      group,
      direction,
      price: direction > 0 ? 3 : 1,
      baseline: 2,
      percent: direction * 50,
      activity: o.activity,
      source: o.source,
      name:
        o.name +
        (o.variant ? ` (${o.variant})` : "") +
        (o.corrupted ? " (corrupted)" : ""),
      evidence: `demo:${group}:${direction}:${index}`,
      interval: 6,
      score: 1,
    };
  }
  function groupSignal(group: Group, direction: number): Signal {
    return {
      key: `demo:group:${group}:${direction}`,
      group,
      direction,
      percent: direction * 15,
      activity: 0,
      source: "group",
      name: group,
      evidence: `demo:${group}:${direction}`,
      interval: 24,
      score: 1,
      count: 6,
      denominator: 14,
    };
  }
  for (const direction of [1, -1]) {
    const suffix = direction > 0 ? "up" : "down";
    add(
      `item-${suffix}`,
      `Individual alerts: ${suffix}, all five groups`,
      groups.map((g) => alertPayload([item(g, direction)], c)),
    );
    add(
      `group-${suffix}`,
      `Group alerts: ${suffix}, all five groups`,
      groups.map((g) => alertPayload([groupSignal(g, direction)], c)),
    );
  }
  add(
    "combined",
    "Group alert with three notable items, all five groups",
    groups.map((g) =>
      alertPayload(
        [
          groupSignal(g, 1),
          ...Array.from({ length: 3 }, (_, i) => item(g, 1, i)),
        ],
        c,
      ),
    ),
  );

  const noHistory = structuredClone(h);
  noHistory.observations = [];
  add(
    "no-history",
    "Current prices without historical comparisons",
    report(noHistory, c, now),
    true,
  );
  const empty = structuredClone(h);
  for (const source of Object.values(empty.sources))
    for (const o of source.observations)
      if (o.group !== "currency") o.activity = 0;
  add(
    "empty",
    "Usable sources with no eligible item rankings",
    report(empty, c, now),
    true,
  );
  const reduced = demo({ sources: { disabled: ["Idols", "UniqueWeapons"] } });
  add(
    "reduced",
    "Deliberately reduced coverage",
    report(reduced.h, reduced.c, reduced.now),
    true,
  );
  const stale = structuredClone(h);
  stale.sources.Runes!.at = now - 3 * HOUR;
  stale.sources.Runes!.error = "Synthetic outage";
  add(
    "stale",
    "Stale/incomplete data — rendering sample only",
    report(stale, c, now),
    true,
  );
  const long = structuredClone(h);
  for (const source of Object.values(long.sources))
    for (const o of source.observations) {
      if (o.group === "currency") continue;
      o.name = `${o.name} — ${"Long descriptive item name with Unicode Ω and 𐐀 ".repeat(10)}`;
    }
  add(
    "long-names",
    "Long names, variants and numbered continuations",
    report(long, c, now),
    true,
  );
  const selected = caseId ? cases.filter((c) => c.id === caseId) : cases;
  if (!selected.length)
    throw Error(
      `Unknown demo case. Available: ${cases.map((c) => c.id).join(", ")}`,
    );
  return {
    note: "Synthetic visual-test messages only; no live prices or production state. Inspect each case in the test channel.",
    totalMessages: selected.reduce((n, c) => n + c.messages.length, 0),
    cases: selected,
  };
}

export async function sendShowcase(
  url: string,
  suite: Showcase,
  output: (text: string) => void = console.log,
  net: Fetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<boolean> {
  // Validate the entire selected batch before its first side effect.
  for (const scenario of suite.cases)
    for (const payload of scenario.messages) validate(payload);
  output(
    JSON.stringify({
      demo: true,
      totalMessages: suite.totalMessages,
      cases: suite.cases.map((c) => c.id),
    }),
  );
  let sent = 0;
  for (const scenario of suite.cases)
    for (const [i, payload] of scenario.messages.entries()) {
      if (sent) await wait(2000);
      output(
        JSON.stringify({
          case: scenario.id,
          part: i + 1,
          parts: scenario.messages.length,
          status: "sending",
        }),
      );
      const result = await post(url, payload, net);
      output(JSON.stringify({ case: scenario.id, part: i + 1, result }));
      if (result.kind !== "sent") {
        output(
          "Demo stopped without automatic retry. Inspect the test channel before deliberately repeating this case with --case; the entire selected case will be sent again.",
        );
        return false;
      }
      sent++;
    }
  return true;
}
