import { GrytBot, createIdentity, loadIdentity } from "@gryt/bot";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { atomic } from "./storage.js";
import type { Receipt } from "./model.js";
import type { Deleter } from "./retention.js";

export async function connectCleaner(server: string, dir: string): Promise<Deleter> {
  const path = join(dir, "gryt-retention-identity.json");
  // Existing malformed identities must never silently turn into a different bot.
  try { await stat(path); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    const { privateJwk } = await createIdentity();
    await atomic(path, { v: 1, privateJwk });
  }
  const identity = await loadIdentity(path);
  const bot = new GrytBot({ host: server, identity, nickname: "Reporter Retention", wants: ["read_messages", "manage_messages"], description: "Deletes expired Reporter webhook messages only", prefix: "", helpCommand: false });
  return cleanerClient(bot);
}

export function cleanerClient(bot: GrytBot, timeoutMs = 10000): Deleter {
  let ready = false;
  let stopped = false;
  let rejectPending: ((e: Error) => void) | undefined;
  let lastDelete = 0;
  bot.on("ready", () => {
    ready = true;
    if (bot.permissions.includes("manage_messages") && bot.permissions.includes("read_messages"))
      console.log("Retention bot ready");
    else console.warn("Retention bot needs read_messages and manage_messages; approve permissions in Gryt Server settings → Bots");
  });
  bot.on("waiting", () => { ready = false; console.warn("Retention bot awaiting approval in Gryt Server settings → Bots; Reporter continues normally"); });
  bot.on("disconnected", () => { ready = false; rejectPending?.(Error("Retention disconnected")); });
  bot.on("error", () => {
    // Raw chat errors are handled by the single active deletion below.
    if (!rejectPending) {
      ready = false;
      console.warn("Retention bot connection unavailable; webhook publication continues");
    }
  });
  // Approval can take indefinitely: never await start on Reporter's startup path.
  void bot.start().catch(() => { ready = false; });
  const stop = async () => {
    stopped = true;
    ready = false;
    rejectPending?.(Error("Retention stopped"));
    await bot.stop();
  };
  return {
    ready: () => ready && !stopped && bot.permissions.includes("manage_messages") && bot.permissions.includes("read_messages"),
    stop,
    delete: async (r: Receipt) => {
      if (stopped || !ready || !bot.socket || rejectPending) throw Error("Retention unavailable");
      // Stay below the verified 30/minute delete limit and spam-score decay.
      const delay = Math.max(0, lastDelete + 3100 - Date.now());
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (stopped || !ready) throw Error("Retention unavailable");
      lastDelete = Date.now();
      const socket = bot.socket!;
      try {
        return await new Promise<"deleted" | "absent">((resolve, reject) => {
          let settled = false;
          const finish = (error?: Error, result?: "deleted" | "absent") => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            socket.off("chat:deleted", deleted);
            socket.off("chat:error", failed);
            rejectPending = undefined;
            if (error) reject(error); else resolve(result!);
          };
          const deleted = (data: { conversation_id?: string; message_id?: string }) => {
            if (data?.conversation_id === r.conversationId && data?.message_id === r.messageId) finish(undefined, "deleted");
          };
          const failed = (error: unknown) => {
            if (error === "Message not found") finish(undefined, "absent");
            else finish(Error("Retention delete refused"));
          };
          const timeout = setTimeout(() => finish(Error("Retention delete timeout")), timeoutMs);
          rejectPending = error => finish(error);
          socket.on("chat:deleted", deleted);
          socket.on("chat:error", failed);
          void bot.delete(r.conversationId, r.messageId).catch(error => finish(error));
        });
      } catch (e) {
        // No late uncorrelated error from this session may affect the next ID.
        await stop();
        throw e;
      }
    },
  };
}
