import type { Fetch } from "./api.js";
import { validate } from "./format.js";
import { record } from "./model.js";
import type { Part, Payload } from "./model.js";
export type Outcome =
  | { kind: "sent"; id: string; warnings: unknown[] }
  | { kind: "retry"; after: number }
  | { kind: "rejected" }
  | { kind: "unknown" };
export async function post(
  url: string,
  payload: Payload,
  net: Fetch = fetch,
): Promise<Outcome> {
  validate(payload);
  try {
    const r = await net(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
    if (r.status === 429) {
      const body = record(await r.json());
      const delay = body["retry_after_ms"];
      return typeof delay === "number" && Number.isFinite(delay) && delay > 0
        ? { kind: "retry", after: delay }
        : { kind: "rejected" };
    }
    if ([400, 401, 403, 404, 413, 422].includes(r.status))
      return { kind: "rejected" };
    if (!r.ok) return { kind: "unknown" };
    const body = record(await r.json());
    if (typeof body["message_id"] !== "string" || !body["message_id"])
      return { kind: "unknown" };
    return {
      kind: "sent",
      id: body["message_id"],
      warnings: Array.isArray(body["warnings"]) ? body["warnings"] : [],
    };
  } catch {
    return { kind: "unknown" };
  }
}
export async function deliver(
  part: Part,
  url: string,
  save: () => Promise<void>,
  now: number,
  net: Fetch = fetch,
): Promise<void> {
  if (part.status !== "pending" || (part.retryAt ?? 0) > now) return;
  part.status = "sending";
  await save();
  const result = await post(url, part.payload, net);
  if (result.kind === "sent") {
    part.status = "sent";
    part.messageId = result.id;
    if (result.warnings.length)
      console.warn(
        "Gryt returned delivery warnings; inspect payload compatibility",
      );
  } else if (result.kind === "retry") {
    part.status = "pending";
    part.retryAt = now + Math.max(2000, result.after);
  } else {
    part.status = result.kind;
    console.warn(
      result.kind === "unknown"
        ? "Gryt delivery uncertain; reservation retained and automatic replay blocked"
        : "Gryt rejected payload; correct webhook configuration or payload before deliberate retry",
    );
  }
  await save();
}
