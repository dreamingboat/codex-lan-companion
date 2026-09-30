import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { readDesktopIpcVersions, desktopRequestEnvelope, desktopStartTurnParams } from "../lib/desktop-ipc-protocol.js";

const current = { detected: true, versions: { "thread-follower-start-turn": 2, "thread-follower-interrupt-turn": 4, "thread-owner-discovery": 1 } };
const legacy = { detected: false, versions: { "thread-follower-start-turn": 1 } };
const input = [{ type: "text", text: "hello", text_elements: [] }];

test("current local requests use version 2 without selecting the remote host protocol", () => {
  assert.deepEqual(desktopRequestEnvelope(current, "thread-follower-start-turn", { hostId: "local" }), { version: 2 });
  assert.deepEqual(desktopRequestEnvelope(current, "thread-follower-start-turn", { hostId: "remote" }), { hostId: "remote", version: 3 });
  assert.deepEqual(desktopRequestEnvelope(current, "thread-owner-discovery", { hostId: "local" }), { version: 1 });
});

test("current start parameters preserve thread settings and message identity", () => {
  const params = desktopStartTurnParams(current, "thread", input, "message");
  assert.deepEqual(params.turnStart.request, { threadId: "thread", input, clientUserMessageId: "message" });
  assert.equal(params.turnStart.context.inheritThreadSettings, true);
  assert.equal(params.turnStartParams, undefined);
  assert.equal(params.turnStart.request.approvalPolicy, undefined);
  assert.equal(params.turnStart.request.model, undefined);
});

test("legacy fallback retains the existing request format", () => {
  assert.deepEqual(desktopRequestEnvelope(legacy, "thread-follower-start-turn", { hostId: "local" }), { hostId: "local", version: 1 });
  assert.deepEqual(desktopStartTurnParams(legacy, "thread", input, "message"), { conversationId: "thread", hostId: "local", turnStartParams: { input, attachments: [] } });
});

test("interrupt without an expected turn uses the Desktop compatibility version", () => {
  assert.equal(desktopRequestEnvelope(current, "thread-follower-interrupt-turn", { conversationId: "thread" }).version, 3);
  assert.equal(desktopRequestEnvelope(current, "thread-follower-interrupt-turn", { expectedTurnId: "turn" }).version, 4);
});

test("version discovery reads an ASAR table without running bundled JavaScript", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clc-ipc-test-"));
  try {
    const source = Buffer.from('throw new Error("must not run"); const versions={"thread-owner-discovery":1,"thread-follower-start-turn":2};');
    const json = Buffer.from(JSON.stringify({ files: { ".vite": { files: { build: { files: { "src-test.js": { size: source.length, offset: "0" } } } } } } }));
    const prefix = Buffer.alloc(16);
    prefix.writeUInt32LE(json.length + 8, 4);
    prefix.writeUInt32LE(json.length, 12);
    const archive = path.join(directory, "app.asar");
    await fs.writeFile(archive, Buffer.concat([prefix, json, source]));
    assert.deepEqual(await readDesktopIpcVersions(archive), { "thread-owner-discovery": 1, "thread-follower-start-turn": 2 });
    await fs.writeFile(archive, Buffer.from("short"));
    assert.equal(await readDesktopIpcVersions(archive), null);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("Desktop client sends the new envelope exactly once and propagates the Desktop turn result", async () => {
  const source = await fs.readFile(new URL("../server.js", import.meta.url), "utf8");
  const classSource = source.slice(source.indexOf("class DesktopCodexIpcClient {"), source.indexOf("\nfunction getCodexIpcClient()"));
  const Client = vm.runInNewContext(`${classSource}\nDesktopCodexIpcClient`, {
    Buffer, randomUUID, setTimeout, clearTimeout, desktopRequestEnvelope, desktopStartTurnParams,
    IPC_VERSION_BY_METHOD: legacy.versions
  });
  const client = new Client();
  client.protocol = current;
  client.ready = Promise.resolve();
  client.captureEvent = () => {};
  const frames = [];
  client.socket = { writable: true, write(frame) {
    const message = JSON.parse(frame.subarray(4).toString());
    frames.push(message);
    queueMicrotask(() => client.handleMessage({ type: "response", requestId: message.requestId, resultType: "success", result: { result: { turn: { id: "turn" } } } }));
  } };
  const response = await client.startTurn("thread", "hello");
  assert.equal(frames.length, 1);
  assert.equal(frames[0].version, 2);
  assert.equal(frames[0].hostId, undefined);
  assert.equal(frames[0].params.turnStart.request.threadId, "thread");
  assert.equal(frames[0].params.turnStart.request.input[0].text, "hello");
  assert.equal(response.result.result.turn.id, "turn");
});

test("simultaneous startup requests share one IPC connection attempt", async () => {
  const source = await fs.readFile(new URL("../server.js", import.meta.url), "utf8");
  const classSource = source.slice(source.indexOf("class DesktopCodexIpcClient {"), source.indexOf("\nfunction getCodexIpcClient()"));
  const Client = vm.runInNewContext(`${classSource}\nDesktopCodexIpcClient`, { Buffer, IPC_VERSION_BY_METHOD: legacy.versions });
  const client = new Client();
  let attempts = 0;
  client.connect = async () => { attempts += 1; await Promise.resolve(); return { ok: true }; };
  await Promise.all([client.ensureReady(), client.ensureReady(), client.ensureReady()]);
  assert.equal(attempts, 1);
});
