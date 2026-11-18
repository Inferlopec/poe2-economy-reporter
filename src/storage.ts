import { historySchema, stateSchema } from "./validation.js";
import lockfile from "proper-lockfile";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { emptyHistory, emptyState, record } from "./model.js";
import type { History, State } from "./model.js";
export async function atomic(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  const f = await open(temp, "w", 0o600);
  try {
    await f.writeFile(JSON.stringify(value));
    await f.sync();
  } finally {
    await f.close();
  }
  await rename(temp, path);
  const parent = await open(dirname(path), "r");
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}
async function read(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw Error(`Corrupted or unreadable state preserved: ${path}`);
  }
}
export const historyPath = (dir: string, league: string) =>
  join(dir, `history-${Buffer.from(league).toString("hex")}.json`);
export async function loadHistory(
  dir: string,
  league: string,
): Promise<History> {
  const raw = await read(historyPath(dir, league));
  if (raw === undefined) return emptyHistory(league);
  return historySchema(raw, league);
}
export async function loadState(dir: string): Promise<State> {
  const raw = await read(join(dir, "state.json"));
  if (raw === undefined) return emptyState();
  return stateSchema(raw);
}
export async function lock(dir: string): Promise<() => Promise<void>> {
  await mkdir(dir, { recursive: true });
  try {
    return await lockfile.lock(join(dir, "writer"), {
      realpath: false,
      stale: 30000,
      update: 10000,
    });
  } catch {
    throw Error(
      "Another scheduled writer holds the data directory lock; after a crash allow 30 seconds for recovery.",
    );
  }
}
export const saveHistory = (dir: string, h: History) =>
  atomic(historyPath(dir, h.league), h);
export const saveState = (dir: string, s: State) =>
  atomic(join(dir, "state.json"), s);
