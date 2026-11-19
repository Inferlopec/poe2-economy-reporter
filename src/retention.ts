import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.js";
import type { Receipt, State } from "./model.js";
import { atomic } from "./storage.js";

const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export function validReceipt(r: Receipt): boolean {
  try {
    const u = new URL(r.server);
    return ["http:", "https:"].includes(u.protocol) && u.origin === r.server &&
      typeof r.conversationId === "string" && !!r.conversationId &&
      typeof r.messageId === "string" && !!r.messageId &&
      Number.isFinite(r.sentAt) && r.sentAt >= 0;
  } catch { return false; }
}
const journal = (dir: string) => join(dir, "retention-messages");
const receiptPath = (dir: string, r: Receipt) =>
  join(journal(dir), digest(JSON.stringify([r.server, r.conversationId, r.messageId])) + ".json");
export async function remember(dir: string, receipt: Receipt): Promise<void> {
  if (!validReceipt(receipt)) throw Error("Invalid retention receipt");
  await mkdir(journal(dir), { recursive: true });
  const path = receiptPath(dir, receipt);
  try { await stat(path); return; }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  await atomic(path, { ...receipt, status: "pending" });
}
export async function rememberSafely(dir: string, receipt: Receipt | undefined): Promise<void> {
  if (!receipt) {
    console.warn("Retention receipt unavailable; published message will not be tracked for cleanup");
    return;
  }
  try { await remember(dir, receipt); }
  catch { console.warn("Retention journal write failed; publication will not be replayed"); }
}
export type Deleter = {
  ready: () => boolean;
  delete: (r: Receipt) => Promise<"deleted" | "absent">;
  stop: () => Promise<void>;
};
export function calendarDay(now: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
// Called by a single scheduler writer. Manual sends only create separate receipts.
export async function cleanup(dir: string, server: string, c: Config, now: number, bot: Deleter): Promise<void> {
  if (!c.retention.enabled || !bot.ready()) return;
  await mkdir(journal(dir), { recursive: true });
  const dayPath = join(dir, `retention-day-${digest(server)}.json`);
  const day = calendarDay(now, c.timezone);
  try {
    const previous = JSON.parse(await readFile(dayPath, "utf8"));
    if (typeof previous.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(previous.day))
      throw Error("Corrupt cleanup day preserved");
    if (previous.day >= day) return;
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  await atomic(dayPath, { day });
  let deleted = 0;
  let absent = 0;
  for (const file of (await readdir(journal(dir))).sort()) {
    if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
    const path = join(journal(dir), file);
    let r: Receipt & { status: string };
    try {
      r = JSON.parse(await readFile(path, "utf8"));
      if (!r || !validReceipt(r) || !["pending", "deleted", "absent"].includes(r.status) || receiptPath(dir, r) !== path)
        throw Error();
    } catch { console.warn("Corrupt retention receipt preserved; skipping entry"); continue; }
    if (r.server !== server || r.status !== "pending" || now - r.sentAt < c.retention.days * 86400000) continue;
    const status = await bot.delete(r);
    await atomic(path, { ...r, status });
    if (status === "deleted") deleted++; else absent++;
  }
  console.log(`Retention cleanup complete: ${deleted} deleted, ${absent} already absent`);
}

export async function recoverReceipts(dir: string, state: State): Promise<void> {
  for (const p of [...state.reports.flatMap(r => r.parts), ...state.alerts.map(a => a.part)]) {
    if (p.status !== "sent" || !p.receipt) continue;
    if (!validReceipt(p.receipt) || p.receipt.messageId !== p.messageId) {
      console.warn("Invalid retention metadata preserved; skipping delivery receipt");
      continue;
    }
    await remember(dir, p.receipt);
  }
}

export function startRetention(c: Config, url: string, dir: string, state: State): { stop: () => Promise<void> } {
  if (!c.retention.enabled) return { stop: async () => {} };
  let stopped = false;
  let client: Deleter | undefined;
  let running: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let retryAt = 0;
  const server = new URL(url).origin;
  async function tick() {
    if (stopped || Date.now() < retryAt) return;
    try {
      if (!client) {
        const { connectCleaner } = await import("./retention-bot.js");
        client = await connectCleaner(server, dir);
      }
      if (stopped) { await client.stop(); return; }
      await recoverReceipts(dir, state);
      await cleanup(dir, server, c, Date.now(), client);
    } catch {
      console.warn("Retention cleanup unavailable; check bot approval/permissions and retention files in DATA_DIR. Collection and webhook publication continue");
      await client?.stop().catch(() => {});
      client = undefined;
      retryAt = Date.now() + 60000;
    }
  }
  function schedule() {
    if (!running && !stopped) running = tick().finally(() => { running = undefined; });
  }
  timer = setInterval(schedule, 60000);
  schedule();
  return { stop: async () => {
    stopped = true;
    clearInterval(timer);
    await client?.stop().catch(() => {});
    await running;
  } };
}
