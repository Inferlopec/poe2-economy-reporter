import { demoItemNames } from "./demo-names.js";
import { configure } from "./config.js";
import { activeSources, bossIds, ingest } from "./market.js";
import { emptyHistory, HOUR, stash } from "./model.js";
export function demo(overrides: unknown = {}) {
  const c = configure(overrides, {});
  const h = emptyHistory("Demo League");
  const now = Date.UTC(2026, 0, 15, 9);
  for (const offset of [24, 6, 1, 0])
    for (const source of activeSources(c)) {
      const ids =
        source === "Currency"
          ? [
              "divine",
              "exalted",
              "chaos",
              "mirror",
              "alch",
              "annul",
              "architects-orb",
              "artificers",
              "bauble",
              "chance",
              "fracturing-orb",
              "regal",
              "vaal",
              "wisdom",
              "transmute",
              "aug",
            ]
          : source === "Fragments"
            ? bossIds.Fragments!
            : source === "Ritual"
              ? ["an-audience-with-the-king", "omen-of-chance"]
              : source === "Breach"
                ? ["breachstone", "adaptive-catalyst"]
                : source === "Delirium"
                  ? ["liquid-envy"]
                  : Array.from(
                      { length: 12 },
                      (_, i) => `${source.toLowerCase()}-${i}`,
                    );
      const isStash = stash.includes(source as (typeof stash)[number]);
      const lines = ids.map((id, i) => ({
        id,
        itemId: id,
        name: demoName(id, source),
        ...(isStash
          ? { variant: i === 0 ? "High roll" : "Standard", corrupted: i === 10 }
          : { corrupted: false }),
        primaryValue:
          source === "Currency"
            ? ((
                {
                  divine: 1,
                  exalted: 1 / 500,
                  chaos: 0.1,
                  mirror: 800,
                } as Record<string, number>
              )[id] ?? 0.02)
            : (i + 1) * (offset >= 6 ? 1 : 1 + (i % 2 === 0 ? 0.4 : -0.3)),
        volumePrimaryValue: 100 + i + (24 - offset) / 100,
        listingCount: 100,
      }));
      ingest(
        h,
        source,
        {
          core: {
            primary: "divine",
            rates: { exalted: 500, chaos: 10 },
            items: ids.map((id) => ({ id, name: demoName(id, source) })),
          },
          lines,
        },
        now - offset * HOUR,
        c,
      );
    }
  return { c, h, now };
}

function demoName(id: string, source: string): string {
  const names: Record<string, string> = {
    divine: "Divine Orb",
    exalted: "Exalted Orb",
    chaos: "Chaos Orb",
    mirror: "Mirror of Kalandra",
    alch: "Orb of Alchemy",
    annul: "Orb of Annulment",
    "architects-orb": "Architect's Orb",
    artificers: "Artificer's Orb",
    bauble: "Glassblower's Bauble",
    chance: "Orb of Chance",
    "fracturing-orb": "Fracturing Orb",
    regal: "Regal Orb",
    vaal: "Vaal Orb",
    wisdom: "Scroll of Wisdom",
    transmute: "Orb of Transmutation",
    aug: "Orb of Augmentation",
    "an-audience-with-the-king": "An Audience with the King",
    "kulemaks-invitation": "Kulemak's Invitation",
    "ravens-reflection": "Raven's Reflection",
  };
  const examples = demoItemNames[source];
  if (examples && id.startsWith(source.toLowerCase() + "-")) {
    const index = Number(id.slice(source.length + 1));
    if (Number.isInteger(index) && index >= 0)
      return examples[index % examples.length]!;
  }
  return (
    names[id] ??
    id
      .split("-")
      .map((word) => word[0]!.toUpperCase() + word.slice(1))
      .join(" ")
  );
}
