import assert from "node:assert/strict";
import type { HostKvApi, JsonValue } from "@grok/agent-sdk";
import { stagePack, type Pack } from "./publish.js";

function memoryKv(seed: Record<string, JsonValue> = {}): HostKvApi {
  const store = new Map<string, JsonValue>(Object.entries(seed));
  return {
    async get(key) {
      return store.get(key);
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

const pack: Pack = {
  packId: "aaaaaaaaaaaa",
  headline: "Bitcoin ETFs see inflows",
  post: "Bitcoin ETFs see $1.1 billion of inflows in one day. CoinDesk.",
  thread: [],
  caption: "Bitcoin ETFs see $1.1 billion of inflows in one day. CoinDesk. Not investment advice.",
  designId: "",
  canvaUrl: "",
  canonical: "https://www.coindesk.com/markets/test",
  channel: "C123",
  threadTs: "1.1",
  at: "2026-11-14T21:00:00.000Z",
};

const kv = memoryKv({ "desk:pack:aaaaaaaaaaaa": pack });
const staged = await stagePack(kv, "aaaaaaaaaaaa");
assert.equal(staged.status, "staged");
if (staged.status === "staged") {
  assert.match(staged.xText, /\$1\.1 billion/);
  assert.match(staged.instagramCaption, /Not investment advice/);
  assert.equal(staged.cardUrl, "");
}
const again = await stagePack(kv, "aaaaaaaaaaaa");
assert.deepEqual(again, { status: "already_staged", packId: "aaaaaaaaaaaa" });
const missing = await stagePack(kv, "bbbbbbbbbbbb");
assert.deepEqual(missing, { status: "unknown_pack", packId: "bbbbbbbbbbbb" });
console.log(JSON.stringify({ ok: true, staged: staged.status }));
