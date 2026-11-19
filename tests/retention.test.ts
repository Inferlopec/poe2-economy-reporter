import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configure } from "../dist/config.js";
import { cleanup, remember, recoverReceipts, startRetention, validReceipt } from "../dist/retention.js";
import { cleanerClient, connectCleaner } from "../dist/retention-bot.js";
import { deliver, post } from "../dist/delivery.js";
import { emptyState } from "../dist/model.js";
import { stateSchema } from "../dist/validation.js";
const now = Date.UTC(2026, 0, 15, 9);
const server = "https://gryt.example";
const url = server + "/api/webhooks/id/token";
const config = configure({ retention: { enabled: true, days: 3 } }, {});
const receipt = (id, extra = {}) => ({ server, conversationId: "channel", messageId: id, sentAt: now - 3 * 86400000, ...extra });
async function temporary(fn) {
  const dir = await mkdtemp(join(tmpdir(), "poe-retention-"));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
const entries = async dir => Promise.all((await readdir(join(dir,"retention-messages"))).map(async f => JSON.parse(await readFile(join(dir,"retention-messages", f), "utf8"))));
test("retention defaults, validation and old delivery state compatibility", () => {
  assert.deepEqual(configure({}, {}).retention, { enabled: false, days: 3 });
  for (const days of [0, -1, 1.2, Infinity, Number.MAX_SAFE_INTEGER, "3"])
    assert.throws(() => configure({retention: { days }}, {}));
  assert.throws(() => configure({retention: { enabled: "yes" }}, {}));
  assert.deepEqual(stateSchema(emptyState()), emptyState());
  assert.equal(validReceipt(receipt("x", {server: "https://host/secret"})), false);
});
test("once daily cleanup skips young and old-server messages and continues after absent entries", async () => temporary(async dir => {
  await Promise.all([
    remember(dir, receipt("absent")), remember(dir, receipt("expired")),
    remember(dir, receipt("young", {sentAt: now - 3 * 86400000 + 1})),
    remember(dir, receipt("old-server", {server: "https://old.example"})),
  ]);
  const deleted = [];
  const bot = {ready: () => true, stop: async () => {}, delete: async r => { deleted.push(r.messageId); return r.messageId === "absent" ? "absent" : "deleted"; }};
  await cleanup(dir, server, config, now, bot);
  assert.deepEqual(deleted.sort(), ["absent", "expired"]);
  const data = await entries(dir);
  assert.equal(data.find(r=>r.messageId === "absent").status, "absent");
  await cleanup(dir, server, config, now + 1, bot);
  assert.equal(deleted.length, 2);
  await cleanup(dir, server, config, now + 86400000, bot);
  assert.equal(deleted.at(-1), "young");
  assert.equal((await entries(dir)).find(r=>r.messageId === "old-server").status, "pending");
}));
test("waiting for approval does not consume today's pass; disabled cleanup does nothing", async () => temporary(async dir => {
  const bot = {ready: () => false, stop: async () => {}, delete: async () => {throw Error("unexpected")}};
  await cleanup(dir, server, config, now, bot);
  await cleanup(dir, server, configure({},{}), now, {...bot, ready:()=>true});
  assert.deepEqual(await readdir(dir), []);
  await remember(dir, receipt("x"));
  await cleanup(dir, server, config, now, {...bot, ready:()=>true, delete:async()=>"deleted"});
  assert.equal((await entries(dir))[0].status, "deleted");
}));
test("failed deletion remains pending, daily attempt survives restart, next day retries", async () => temporary(async dir => {
  await remember(dir, receipt("x"));
  let calls = 0;
  const bot = {ready:()=>true, stop:async()=>{}, delete:async()=> {calls++; throw Error("rate limit or timeout");}};
  await assert.rejects(cleanup(dir, server, config, now, bot));
  assert.equal((await entries(dir))[0].status, "pending");
  await cleanup(dir, server, config, now + 1000, bot);
  assert.equal(calls, 1);
  await cleanup(dir, server, config, now + 86400000, {...bot, delete:async()=>"deleted"});
  await remember(dir, receipt("x")); // Recovery must not undo the terminal marker.
  assert.equal((await entries(dir))[0].status, "deleted");
}));
test("corrupt receipt is preserved while other messages are cleaned", async () => temporary(async dir => {
  await remember(dir, receipt("bad"));
  const path = join(dir,"retention-messages",(await readdir(join(dir,"retention-messages")))[0]);
  await writeFile(path, "{broken");
  await remember(dir, receipt("good"));
  const calls = [];
  await cleanup(dir,server,config,now,{ready:()=>true,stop:async()=>{},delete:async r=>{calls.push(r.messageId);return "deleted";}});
  assert.deepEqual(calls,["good"]);
  assert.equal(await readFile(path,"utf8"),"{broken");
}));
test("automatic successful sends retain receipts; unknown and legacy responses cannot invent them", async () => {
  const part = {payload:{text:"report"}, status:"pending"};
  const saves = [];
  await deliver(part,url,async()=>{saves.push(structuredClone(part));},now,async()=>Response.json({message_id:"published",conversation_id:"channel"}));
  assert.equal(part.status,"sent");
  assert.equal(part.receipt.server,server);
  assert.equal(part.receipt.messageId,"published");
  assert.equal(saves[0].status,"sending");
  const unknown = await post(url,{text:"x"},async()=>Response.json({}, {status:500}));
  assert.equal(unknown.kind,"unknown");
  const legacy = await post(url,{text:"x"},async()=>Response.json({message_id:"old"}));
  assert.equal(legacy.kind,"sent");
  assert.equal(legacy.receipt,undefined);
});
class FakeBot extends EventEmitter {
  socket = new EventEmitter();
  permissions = ["read_messages","manage_messages"];
  closed = false;
  behavior = () => {};
  async start() { return new Promise(()=>{}); }
  async stop() { this.closed = true; }
  async delete(channel,id) { this.behavior(channel,id); }
}
test("bot startup does not await approval and emission alone is not deletion acknowledgement", async () => {
  const bot = new FakeBot();
  const client = cleanerClient(bot);
  assert.equal(client.ready(),false);
  bot.emit("waiting","approval");
  bot.emit("ready",{});
  assert.equal(client.ready(),true);
  let done = false;
  const deletion = client.delete(receipt("x")).then(r=>{done=true;return r;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(done,false);
  bot.socket.emit("chat:deleted",{conversation_id:"other",message_id:"x"});
  assert.equal(done,false);
  bot.socket.emit("chat:deleted",{conversation_id:"channel",message_id:"x"});
  assert.equal(await deletion,"deleted");
  await client.stop();
});
test("exact missing message is terminal; other errors close session and never count as absent", async () => {
  for (const error of ["Message not found", "No such conversation", {error:"forbidden"}, {error:"rate_limited"}]) {
    const bot = new FakeBot();
    bot.behavior=()=>queueMicrotask(()=>bot.socket.emit("chat:error",error));
    const client = cleanerClient(bot); bot.emit("ready",{});
    if(error === "Message not found") assert.equal(await client.delete(receipt("x")),"absent");
    else { await assert.rejects(client.delete(receipt("x"))); assert.equal(bot.closed,true); }
    await client.stop();
  }
});
test("disconnect closes old session before a late error can be attributed to another message", async () => {
  const bot = new FakeBot(), client = cleanerClient(bot); bot.emit("ready",{});
  const deletion=client.delete(receipt("x"));
  bot.emit("disconnected","network");
  await assert.rejects(deletion);
  bot.socket.emit("chat:error","Message not found");
  assert.equal(client.ready(),false);
  await assert.rejects(client.delete(receipt("next")));
});
test("disabled retention starts no identity, journal or connection", async () => temporary(async dir => {
  await startRetention(configure({},{}),url,dir,emptyState()).stop();
  assert.deepEqual(await readdir(dir),[]);
}));

test("timeout closes the deletion session and leaves no acknowledgement listeners", async () => {
  const bot = new FakeBot(), client = cleanerClient(bot, 5);
  bot.emit("ready", {});
  await assert.rejects(client.delete(receipt("x")), /timeout/);
  assert.equal(bot.closed, true);
  assert.equal(bot.socket.listenerCount("chat:deleted"), 0);
  assert.equal(bot.socket.listenerCount("chat:error"), 0);
  await assert.rejects(client.delete(receipt("next")));
});
test("corrupt identity is preserved without connecting or generating a replacement", async () => temporary(async dir => {
  const path = join(dir, "gryt-retention-identity.json");
  await writeFile(path, "{broken");
  await assert.rejects(connectCleaner(server, dir));
  assert.equal(await readFile(path, "utf8"), "{broken");
}));
test("receipt recovery covers reports and alerts, preserves state, and ignores unknown/legacy parts", async () => temporary(async dir => {
  const state = emptyState();
  state.reports.push({day:"2026-01-15",league:"L",epoch:"e",expires:now,parts:[
    {status:"sent",messageId:"report",payload:{text:"report"},receipt:receipt("report")},
    {status:"sent",messageId:"legacy",payload:{text:"legacy"}},
    {status:"unknown",payload:{text:"unknown"},receipt:receipt("unknown")},
  ]});
  state.alerts.push({day:"2026-01-15",expires:now,signals:[],part:{status:"sent",messageId:"alert",payload:{text:"alert"},receipt:receipt("alert")}});
  const before = JSON.stringify(state);
  await recoverReceipts(dir,stateSchema(JSON.parse(before)));
  assert.deepEqual((await entries(dir)).map(r=>r.messageId).sort(),["alert","report"]);
  assert.equal(JSON.stringify(state),before);
}));
test("concurrent manual receipts are independent and contain no webhook token", async () => temporary(async dir => {
  await Promise.all(Array.from({length:20},(_,i)=>remember(dir,receipt(`manual-${i}`))));
  assert.equal((await entries(dir)).length,20);
  assert.ok(!(JSON.stringify(await entries(dir))).includes("token"));
}));
