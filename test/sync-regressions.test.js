import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const source = await fs.readFile(new URL("../server.js", import.meta.url), "utf8");
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const messageHelpers = section("function messageSortCompare(", "const NOTICE_TYPE_PATTERNS");
const messageContext = { DEFAULT_MESSAGE_LIMIT: 80, MAX_MESSAGE_LIMIT: 1000 };
const decodeMessage = vm.runInNewContext([
  section("function textFromContent(", "const INTERACTION_TYPE_PATTERNS"),
  section("function messageFromResponseItem(", "function hasDisplayableMessageContent("),
  "messageFromResponseItem"
].join("\n"));

test("raw developer and system instructions are not decoded as chat cards", () => {
  for (const role of ["developer", "system"]) {
    assert.equal(decodeMessage(null, { type: "message", role, content: [{ type: "input_text", text: "Tools, warnings and limits in internal instructions" }] }), null);
  }
});

test("only source-marked injected contexts are removed, not user-authored rule text", () => {
  for (const kind of ["environments.environment_context", "agents_md.instructions"]) {
    const content = [{ type: "input_text", text: "# AGENTS.md instructions\n<environment_context>example</environment_context>" }];
    const payload = { type: "message", role: "user", content };
    assert.equal(decodeMessage(null, { ...payload, internal_chat_message_metadata_passthrough: { content_item_kinds: [kind] } }), null);
    assert.equal(decodeMessage(null, payload).content, content[0].text);
    assert.equal(decodeMessage(null, { ...payload, internal_chat_message_metadata_passthrough: { content_item_kinds: [kind + ".unknown"] } }).content, content[0].text);
  }
});

test("mixed user content retains the real prompt and image when injected context is removed", () => {
  const image = "data:image/png;base64,aGVsbG8=";
  const message = decodeMessage(null, {
    type: "message", role: "user",
    content: [
      { type: "input_text", text: "<environment_context>internal</environment_context>" },
      { type: "input_text", text: "Review this image" },
      { type: "input_image", image_url: image }
    ],
    internal_chat_message_metadata_passthrough: { content_item_kinds: ["environments.environment_context", "user", "image"] }
  });
  assert.equal(message.content, "Review this image");
  assert.equal(message.images[0], image);
});

test("client filtering preserves actual errors, approvals, quota notices and chat images", () => {
  const limit = vm.runInNewContext(`${messageHelpers}\nlimitMessagesForClient`, messageContext);
  const messages = [null,
    { role: "developer", kind: "message", content: "Hidden" },
    { role: "system", kind: "message", content: "Hidden" },
    { role: "system", kind: "parse_error", content: "Invalid JSONL record" },
    { role: "notice", kind: "error", content: "Failure" },
    { role: "notice", kind: "usage_limit", content: "Quota exceeded" },
    { role: "interaction", kind: "approval", content: "Confirm", canApprove: true, requiresDesktopAction: true },
    { role: "assistant", content: "Poster", images: ["/api/local-image?path=poster"] }
  ];
  const visible = limit(messages).messages;
  assert.deepEqual(Array.from(visible, (message) => message.kind || message.role), ["parse_error", "error", "usage_limit", "approval", "assistant"]);
  assert.equal(visible.at(-1).images.length, 1);
});

test("internal context does not satisfy the visible-message tail-scan threshold", () => {
  const count = vm.runInNewContext(`${messageHelpers}\ndefaultVisibleMessageCount`, messageContext);
  const messages = [null, ...Array.from({ length: 100 }, () => ({ role: "developer", kind: "message" })),
    { role: "system", kind: "message" }, { role: "user", content: "hello" }, { role: "assistant", content: "reply" }];
  assert.equal(count(messages), 2);
});

test("tool output does not count toward the visible messages needed for a tail scan", () => {
  const count = vm.runInNewContext(`${messageHelpers}\ndefaultVisibleMessageCount`, messageContext);
  const messages = Array.from({ length: 100 }, () => ({ role: "tool" }));
  messages.push({ role: "user", content: "hello" }, { role: "assistant", content: "reply" });
  assert.equal(count(messages), 2);
});

test("automatic reviews are hidden while real approvals and important notices remain", () => {
  const limit = vm.runInNewContext(`${messageHelpers}\nlimitMessagesForClient`, messageContext);
  const result = limit([
    { role: "interaction", kind: "automaticApprovalReview", requiresDesktopAction: true },
    { role: "interaction", kind: "approval", requiresDesktopAction: true, content: "Confirm" },
    { role: "notice", kind: "error", content: "Quota exceeded" },
    { role: "user", content: "hello" }
  ]);
  assert.deepEqual(Array.from(result.messages, (m) => m.kind || m.role), ["approval", "error", "user"]);
});

test("bounded backward usage reading reconstructs JSON split across chunks", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clc-usage-test-"));
  try {
    const file = path.join(directory, "rollout.jsonl");
    const event = (percent, extra = "") => JSON.stringify({ type: "event_msg", timestamp: "2026-11-10T00:00:00Z", payload: { type: "token_count", rate_limits: { primary: { used_percent: percent } }, extra } });
    await fs.writeFile(file, [event(10), event(25, "x".repeat(600)), "malformed tail"].join("\n"));
    const read = vm.runInNewContext(`${section("function rateLimitsFromRolloutLine(", "async function readSessionIndexTitleMap(")}\nreadLatestRateLimitsFromRollout`, {
      fs, Buffer, RATE_LIMIT_ROLLOUT_CHUNK_BYTES: 128, RATE_LIMIT_ROLLOUT_MAX_SCAN_BYTES: 4096,
      normalizeRateLimits: (limits) => limits
    });
    assert.equal((await read(file)).primary.used_percent, 25);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("stale turn timestamps are not refreshed by unrelated file modification time", () => {
  const now = Date.now();
  const resultFromState = vm.runInNewContext(`${section("function rolloutResultFromState(", "async function readRolloutTailLines(")}\nrolloutResultFromState`, {
    ACTIVE_STATUS_CACHE_MS: 5000, ACTIVE_TURN_STALE_MS: 600000,
    dedupeInteractionMessages: (rows) => rows, messageSortCompare: () => 0
  });
  const result = resultFromState({ filePath: "/test", nowMs: now, stat: { size: 1, mtimeMs: now }, state: {
    activeTurn: { turnId: "old", startedAtMs: now - 1200000 }, lastEntryAtMs: now - 1100000,
    eventMessages: [], fallbackMessages: [], interactionMessages: [], noticeMessages: [], toolMessages: []
  } });
  assert.equal(result.status.thinking, false);
  assert.equal(result.status.staleTurn, true);
});

test("text steering uses Desktop follower IPC with a message identity", async () => {
  const Client = vm.runInNewContext(`${section("class DesktopCodexIpcClient {", "function getCodexIpcClient(")}\nDesktopCodexIpcClient`, {
    Buffer, IPC_VERSION_BY_METHOD: {}, randomUUID: () => "message-id"
  });
  const client = new Client();
  client.ensureReady = async () => {};
  let request;
  client.request = async (...args) => { request = args; return { result: { result: { turnId: "turn" } } }; };
  await client.steerTurn("thread", "turn", "focus here");
  assert.equal(request[0], "thread-follower-steer-turn");
  assert.equal(request[1].conversationId, "thread");
  assert.equal(request[1].input[0].text, "focus here");
  assert.equal(request[1].clientUserMessageId, "message-id");
  assert.notEqual(request[2].includeVersion, false);
});

test("steering rejection reports Desktop failure without creating an independent session", async () => {
  let fallbackCalls = 0;
  const steer = vm.runInNewContext(`${section("async function steerCodexTurn(", "async function startNewCodexThread(")}\nsteerCodexTurn`, {
    ALLOW_WRITE: true, refreshCodexHomeContext: async () => {}, recordNotice: () => {},
    getCodexIpcClient: () => ({ steerTurn: async () => { throw new Error("no-client-found"); } }),
    steerViaAppServer: async () => { fallbackCalls += 1; }
  });
  await assert.rejects(steer({ threadId: "thread", turnId: "turn", message: "hello" }), /no-client-found/);
  assert.equal(fallbackCalls, 0);
});
