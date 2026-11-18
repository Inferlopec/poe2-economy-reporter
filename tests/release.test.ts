import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VERSION } from "../dist/version.js";
import { main } from "../dist/cli.js";
import { discover } from "../dist/api.js";
import { configure } from "../dist/config.js";

test("release guard accepts the coordinated release version", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/release-check.mjs", `v${VERSION}`],
    { encoding: "utf8" },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `version=${VERSION}\n`);
});
for (const tag of [
  "v0.0.0",
  "v0.1.1",
  "v0.1.0-rc.1",
  "0.1.0",
  "v0.1.0-invalid",
  "v00.1.0",
])
  test(`release guard rejects ${tag} before publishing`, () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/release-check.mjs", tag],
      { encoding: "utf8" },
    );
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Release tag must/);
  });

test("version output needs no configuration, webhook, network or production writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "poe-version-"));
  const original = globalThis.fetch;
  const env = { ...process.env };
  try {
    process.env.CONFIG_PATH = join(dir, "invalid-or-missing-config.yaml");
    process.env.DATA_DIR = dir;
    delete process.env.GRYT_WEBHOOK_URL;
    globalThis.fetch = async () => {
      throw Error("Network forbidden");
    };
    const lines = [];
    await main(["--version"], (line) => lines.push(line));
    assert.deepEqual(lines, [`poe2-economy-reporter ${VERSION}`]);
    assert.deepEqual(await readdir(dir), []);
  } finally {
    globalThis.fetch = original;
    process.env = env;
    await rm(dir, { recursive: true, force: true });
  }
});

test("public API User-Agent identifies the installed release", async () => {
  await discover(configure({}, {}), null, async (_url, options) => {
    assert.match(
      options!.headers["User-Agent"],
      new RegExp(`^PoE2EconomyReporter/${VERSION.replaceAll(".", "\\.")} `),
    );
    return Response.json([{ id: "Example League" }]);
  });
});
