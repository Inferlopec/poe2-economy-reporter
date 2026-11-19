import { rememberSafely } from "./retention.js";
import { VERSION } from "./version.js";
import { loadConfig, webhook } from "./config.js";
import { discover, refresh } from "./api.js";
import { post } from "./delivery.js";
import { demo } from "./demo.js";
import { showcase, sendShowcase } from "./showcase.js";
import { report } from "./format.js";
import { activeSources, coverage, usable } from "./market.js";
import { emptyHistory, groups } from "./model.js";
import { run } from "./runtime.js";
import { loadHistory, loadState } from "./storage.js";
export async function main(
  args = process.argv.slice(2),
  output: (text: string) => void = console.log,
): Promise<void> {
  if (args.length === 1 && args[0] === "--version") {
    output(`poe2-economy-reporter ${VERSION}`);
    return;
  }
  const command = args[0] ?? "start";
  const usage =
    "Usage: --version | start | check | preview [--demo [--all] [--case <id>]] | send-test [--demo [--case <id>]] | report-currency";
  if (
    !["start", "check", "preview", "send-test", "report-currency"].includes(
      command,
    )
  )
    throw Error(usage);
  const flags = new Set<string>();
  let caseId: string | undefined;
  for (let i = 1; i < args.length; i++) {
    const flag = args[i]!;
    if (!["--demo", "--all", "--case"].includes(flag) || flags.has(flag))
      throw Error(usage);
    flags.add(flag);
    if (flag === "--case") {
      caseId = args[++i];
      if (!caseId || caseId.startsWith("--")) throw Error(usage);
    }
  }
  const isDemo = flags.has("--demo");
  if (
    (flags.size && !["preview", "send-test"].includes(command)) ||
    ((flags.has("--all") || caseId) && !isDemo) ||
    (flags.has("--all") && command !== "preview")
  )
    throw Error(usage);
  if (isDemo) {
    if (command === "preview") {
      if (flags.has("--all") || caseId)
        output(JSON.stringify(showcase(caseId), null, 2));
      else {
        const { c, h, now } = demo();
        output(JSON.stringify(report(h, c, now), null, 2));
      }
    } else if (
      !(await sendShowcase(
        webhook(process.env, "GRYT_TEST_WEBHOOK_URL"),
        showcase(caseId),
        output,
      ))
    )
      process.exitCode = 1;
    return;
  }
  const c = await loadConfig();
  const dir = process.env["DATA_DIR"] || "data";
  if (command === "start") {
    await run(c, webhook(), dir);
    return;
  }
  if (command === "send-test") {
    const result = await post(webhook(), {
      text: "[TEST] PoE2 Economy Reporter webhook test",
    });
    output(JSON.stringify(result));
    if (result.kind !== "sent") process.exitCode = 1;
    return;
  }
  const state = await loadState(dir);
  const league =
    command === "check"
      ? await discover(c, state.league)
      : c.league !== "auto"
        ? c.league
        : state.league;
  if (!league)
    throw Error("No stored league. Collect market data or use preview --demo.");
  let h;
  if (command === "check") {
    h = emptyHistory(league);
    const errors = await refresh(h, c);
    for (const e of errors) console.warn(e);
    output(
      JSON.stringify(
        {
          league,
          sources: activeSources(c),
          coverage: Object.fromEntries(
            groups.map((g) => [
              g,
              {
                sources: coverage(c, g),
                disabled: coverage(c, g).filter((x) =>
                  c.sources.disabled.includes(x),
                ),
              },
            ]),
          ),
        },
        null,
        2,
      ),
    );
    for (const rule of c.classification.overrides) {
      if (c.sources.disabled.includes(rule.source))
        console.warn(`Dormant rule: ${rule.source}/${rule.id}`);
      else if (
        !h.sources[rule.source]?.observations.some((o) => o.id === rule.id)
      )
        console.warn(`Unmatched rule: ${rule.source}/${rule.id}`);
    }
    if (errors.length) process.exitCode = 1;
    return;
  }
  h = await loadHistory(dir, league);
  if (command === "preview") {
    output(JSON.stringify(report(h, c, Date.now()), null, 2));
    return;
  }
  if (!usable(h.sources["Currency"], c, Date.now()))
    throw Error(
      "Stored Currency data is missing/stale; wait for a successful refresh",
    );
  const parts = report(h, c, Date.now(), true);
  for (const p of parts) {
    const result = await post(webhook(), p);
    if (result.kind === "sent") await rememberSafely(dir, result.receipt);
    output(JSON.stringify(result));
    if (result.kind !== "sent") {
      process.exitCode = 1;
      return;
    }
    if (parts.length > 1)
      await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
if (process.argv[1]?.endsWith("/cli.js"))
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : "Command failed");
    process.exitCode = 1;
  });
