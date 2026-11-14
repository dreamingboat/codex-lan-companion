import assert from "node:assert/strict";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const serverSource = await fs.readFile(new URL("../server.js", import.meta.url), "utf8");
const appSource = await fs.readFile(new URL("../public/app.js", import.meta.url), "utf8");
const section = (source, from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=", "base64");
const imageUrl = `data:image/png;base64,${png.toString("base64")}`;

function backend(root) {
  return vm.runInNewContext([
    section(serverSource, "function mimeTypeForAsset(", "async function readPluginIconDataUrl("),
    section(serverSource, "function textFromContent(", "const INTERACTION_TYPE_PATTERNS"),
    section(serverSource, "function messageSortCompare(", "const NOTICE_TYPE_PATTERNS"),
    section(serverSource, "function messageFromResponseItem(", "function hasDisplayableMessageContent("),
    section(serverSource, "async function serveLocalImage(", "const handleRequest ="),
    "({ messageFromResponseItem, limitMessagesForClient, mergeToolImagesIntoReplies, serveLocalImage })"
  ].join("\n"), {
    fs, existsSync, path, GENERATED_IMAGES_DIR: root, MAX_LOCAL_IMAGE_BYTES: 512,
    DEFAULT_MESSAGE_LIMIT: 80, MAX_MESSAGE_LIMIT: 1000, redactLargePayloads: (value) => value,
    sendText: (res, status, text) => { res.writeHead(status, {}); res.end(text); }
  });
}

test("native and legacy image tool outputs are parsed, with inline fallback when no file exists", () => {
  const api = backend("/missing-generated-images");
  for (const type of ["custom_tool_call_output", "function_call_output"]) {
    const message = api.messageFromResponseItem("2026-11-14T00:00:00Z", { type, call_id: "image-call", output: [
      { type: "input_image", image_url: imageUrl },
      { type: "input_text", text: "Generated images are saved to /missing-generated-images as /missing-generated-images/deleted.png by default." }
    ] });
    assert.equal(message.images[0], imageUrl);
    assert.equal(message.content, "[image output: 1 image]");
  }
});

test("generated image hints use a small local URL instead of repeating Base64 in message sync", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "clc-generated-"));
  try {
    const file = path.join(root, "poster with spaces.png");
    await fs.writeFile(file, png);
    const api = backend(root);
    const message = api.messageFromResponseItem(null, { type: "custom_tool_call_output", output: [
      { type: "input_image", image_url: imageUrl },
      { type: "input_text", text: `Generated images are saved to ${root} as ${file} by default.\nThe generated image is already displayed to the user.` }
    ] });
    assert.equal(message.images[0], `/api/local-image?path=${encodeURIComponent(file)}`);
    assert.equal(JSON.stringify(message).includes("base64"), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("image tool output survives the old-tool-message cutoff", () => {
  const api = backend("/missing");
  const image = { id: "poster", role: "tool", images: [imageUrl], lineNumber: 1 };
  const oldTextTool = { id: "old-tool", role: "tool", content: "output", lineNumber: 2 };
  const messages = [image, oldTextTool, ...Array.from({ length: 20 }, (_, index) => ({ role: "assistant", content: "reply", lineNumber: index + 3 }))];
  const result = api.limitMessagesForClient(messages);
  assert.equal(result.messages.some((message) => message.images?.includes(imageUrl)), true);
  assert.equal(result.messages.some((message) => message.id === "old-tool"), false);
});

test("image and final reply share one message without mutating the parsed source", () => {
  const api = backend("/missing");
  const image = Object.freeze({ role: "tool", turnId: "turn", images: Object.freeze([imageUrl]) });
  const reply = Object.freeze({ role: "assistant", turnId: "turn", phase: "final_answer", content: "Poster completed" });
  const merged = api.mergeToolImagesIntoReplies([image, reply]);
  assert.equal(merged[0].images.length, 0);
  assert.equal(merged[1].content, "Poster completed");
  assert.equal(merged[1].images[0], imageUrl);
  assert.equal(image.images.length, 1);
  assert.equal(reply.images, undefined);
  assert.equal(api.mergeToolImagesIntoReplies(merged)[1].images.length, 1);
});

test("multiple image outputs deduplicate into the final reply rather than progress text", () => {
  const api = backend("/missing");
  const merged = api.mergeToolImagesIntoReplies([
    { role: "tool", turnId: "turn", images: [imageUrl] },
    { role: "assistant", turnId: "turn", phase: "commentary", content: "Working" },
    { role: "tool", turnId: "turn", images: [imageUrl, "/api/local-image?path=second"] },
    { role: "assistant", turnId: "turn", phase: "final_answer", content: "Finished", images: [imageUrl] }
  ]);
  assert.equal(merged[1].images, undefined);
  assert.equal(merged[3].images.length, 2);
  assert.equal(merged.filter((message) => message.role === "tool").every((message) => !message.images.length), true);
});

test("images never cross a user-message or explicit turn boundary", () => {
  const api = backend("/missing");
  for (const boundary of [{ role: "user", content: "Next question" }, { role: "assistant", turnId: "other-turn", content: "Other reply" }]) {
    const merged = api.mergeToolImagesIntoReplies([
      { role: "tool", turnId: "image-turn", images: [imageUrl] }, boundary,
      { role: "assistant", content: "Later answer" }
    ]);
    assert.equal(merged[0].images[0], imageUrl);
    assert.equal(merged[2].images, undefined);
  }
});

test("legacy images without turn IDs match following text within the same user exchange", () => {
  const api = backend("/missing");
  const merged = api.mergeToolImagesIntoReplies([
    { role: "user", content: "Make poster" },
    { role: "tool", images: [imageUrl] },
    { role: "notice", content: "Info" },
    { role: "assistant", content: "Here is the poster" },
    { role: "user", content: "Next question" },
    { role: "assistant", content: "Next answer" }
  ]);
  assert.equal(merged[3].images[0], imageUrl);
  assert.equal(merged[5].images, undefined);
});

test("standalone images and user attachments remain visible when no reply text exists", () => {
  const api = backend("/missing");
  const merged = api.mergeToolImagesIntoReplies([
    { role: "user", images: ["user-image"] },
    { role: "tool", turnId: "turn", images: [imageUrl] },
    { role: "assistant", turnId: "turn", content: "" }
  ]);
  assert.equal(merged[0].images[0], "user-image");
  assert.equal(merged[1].images[0], imageUrl);
  assert.equal(merged[2].images, undefined);
  assert.equal(api.mergeToolImagesIntoReplies([]).length, 0);
});

test("a late image can join the explicit final reply in the same turn", () => {
  const api = backend("/missing");
  const merged = api.mergeToolImagesIntoReplies([
    { role: "assistant", turnId: "turn", phase: "final_answer", content: "Poster ready" },
    { role: "tool", turnId: "turn", images: [imageUrl] }
  ]);
  assert.equal(merged[0].images[0], imageUrl);
  assert.equal(merged[1].images.length, 0);
});

test("a partial rollout recovers message turn IDs without marking a finished task active", () => {
  const api = backend("/missing");
  const parser = vm.runInNewContext(`${section(serverSource, "function hasDisplayableMessageContent(", "function rolloutResultFromState(")}\n({ createRolloutParseState, parseRolloutLine })`, {
    messageFromResponseItem: api.messageFromResponseItem,
    messageFromEvent: () => null, messageFromInteractionEvent: () => null, messageFromNoticeEvent: () => null
  });
  const state = parser.createRolloutParseState({ mtimeMs: 0 }, 0);
  for (const entry of [
    { type: "event_msg", payload: { type: "item_completed", turn_id: "recorded-turn" } },
    { type: "response_item", payload: { type: "custom_tool_call_output", output: [{ type: "input_image", image_url: imageUrl }] } },
    { type: "response_item", payload: { type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: "Done" }] } }
  ]) parser.parseRolloutLine(JSON.stringify(entry), state);
  assert.equal(state.toolMessages[0].turnId, "recorded-turn");
  assert.equal(state.fallbackMessages[0].turnId, "recorded-turn");
  assert.equal(state.fallbackMessages[0].phase, "final_answer");
  assert.equal(state.activeTurn, null);
});

test("tail reading includes an image record cut by the initial window and stays bounded", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clc-image-tail-"));
  try {
    const file = path.join(directory, "rollout.jsonl");
    const imageRecord = JSON.stringify({ type: "custom_tool_call_output", output: [{ type: "input_image", image_url: `data:image/png;base64,${"A".repeat(2500)}` }] });
    const finalRecord = JSON.stringify({ type: "agent_message", message: "poster completed" });
    const readTail = vm.runInNewContext(`${section(serverSource, "async function readRolloutTailLines(", "async function parseRolloutTail(")}\nreadRolloutTailLines`, {
      fs, Buffer, TAIL_ROLLOUT_MIN_BYTES: 1024, TAIL_ROLLOUT_MAX_BYTES: 4096, normalizeMessageLimit: () => 0
    });
    await fs.writeFile(file, `${JSON.stringify({ padding: "x".repeat(5000) })}\n${imageRecord}\n${finalRecord}\n`);
    const recovered = await readTail(file, await fs.stat(file), 80);
    assert.equal(recovered.lines.includes(imageRecord), true);
    assert.equal(recovered.lines.includes(finalRecord), true);
    assert.equal(recovered.bytes <= 4096, true);
    const unicodeRecord = JSON.stringify({ type: "agent_message", message: "海报".repeat(300) });
    await fs.writeFile(file, `${JSON.stringify({ padding: "x".repeat(5000) })}\n${unicodeRecord}\n${finalRecord}\n`);
    const unicode = await readTail(file, await fs.stat(file), 80);
    assert.equal(unicode.lines.includes(unicodeRecord), true);
    await fs.writeFile(file, `${JSON.stringify({ image: "A".repeat(8000) })}\n${finalRecord}\n`);
    const bounded = await readTail(file, await fs.stat(file), 80);
    assert.equal(bounded.lines.includes(finalRecord), true);
    assert.equal(bounded.lines.length, 1);
    assert.equal(bounded.bytes, 4096);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("local image URLs render as images and are promoted when Tools is off", () => {
  const escapeHtml = (text) => String(text).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  const render = vm.runInNewContext(`${section(appSource, "function imageNameFromPath(", "function mimeTypeForFile(")}\n({renderMessageImages, renderPromotedToolImages})`, {
    state: { showTools: false, authToken: "test&code" }, escapeHtml,
    t: (key) => key,
    messageImageCount: (message) => message.images?.length || 0,
    formatMessageDate: () => "", roleBadge: () => "Codex"
  });
  const message = { role: "tool", images: ["/api/local-image?path=%2Ftest.png"] };
  assert.match(render.renderMessageImages(message), /src="\/api\/local-image\?path=%2Ftest.png&amp;token=test%26code"/);
  assert.match(render.renderMessageImages(message), /button class="message-image-open" type="button"/);
  assert.match(render.renderPromotedToolImages(message), /article class="message assistant tool-image"/);
  assert.doesNotMatch(render.renderMessageImages({ images: ['https://example.com/" onerror="alert(1)'] }), /example\.com|onerror/);
});

test("original-image preview uses the full source without altering the conversation image", () => {
  const preview = { open: false, shown: 0, showModal() { this.open = true; this.shown += 1; } };
  const fullImage = {};
  const open = vm.runInNewContext(`${section(appSource, "function openImagePreview(", "function mimeTypeForFile(")}\nopenImagePreview`, {
    els: { imagePreview: preview, imagePreviewImage: fullImage }
  });
  const source = Object.freeze({ currentSrc: "http://localhost/api/local-image?path=poster", src: "other", alt: "Poster" });
  open(source);
  assert.equal(preview.open, true);
  assert.equal(fullImage.src, source.currentSrc);
  assert.equal(fullImage.alt, "Poster");
  open({ src: imageUrl });
  assert.equal(fullImage.src, imageUrl);
  assert.equal(preview.shown, 1);
  open(null);
  assert.equal(preview.shown, 1);
});

test("image preview closes from its button, backdrop, and native close event", () => {
  const dialogHandlers = {};
  const buttonHandlers = {};
  const image = { src: imageUrl, removeAttribute(name) { delete this[name]; } };
  const dialog = {
    closed: 0,
    addEventListener(name, handler) { dialogHandlers[name] = handler; },
    close() { this.closed += 1; dialogHandlers.close(); }
  };
  const handlers = section(appSource, 'els.imagePreviewClose.addEventListener("click"', 'els.scrollToBottomButton.addEventListener("click"');
  vm.runInNewContext(handlers, { els: { imagePreview: dialog, imagePreviewImage: image, imagePreviewClose: { addEventListener(name, handler) { buttonHandlers[name] = handler; } } } });
  dialogHandlers.click({ target: image });
  assert.equal(dialog.closed, 0);
  buttonHandlers.click();
  assert.equal(dialog.closed, 1);
  assert.equal(image.src, undefined);
  image.src = imageUrl;
  dialogHandlers.click({ target: dialog });
  assert.equal(dialog.closed, 2);
  assert.equal(image.src, undefined);
});

test("local image serving allows real files and rejects missing, oversized, unsupported or escaped files", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clc-image-access-"));
  const root = path.join(directory, "generated");
  try {
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, "valid.png"), png);
    await fs.writeFile(path.join(root, "empty.png"), "");
    await fs.writeFile(path.join(root, "large.png"), Buffer.alloc(513));
    await fs.writeFile(path.join(root, "text.txt"), "not an image");
    await fs.writeFile(path.join(directory, "outside.png"), png);
    await fs.symlink(path.join(directory, "outside.png"), path.join(root, "escape.png"));
    const api = backend(root);
    const serve = async (file) => {
      const res = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
      await api.serveLocalImage(res, file);
      return res;
    };
    const valid = await serve(path.join(root, "valid.png"));
    assert.equal(valid.status, 200);
    assert.equal(valid.headers["content-type"], "image/png");
    assert.deepEqual(valid.body, png);
    for (const name of ["missing.png", "empty.png", "large.png"]) assert.equal((await serve(path.join(root, name))).status, 404);
    assert.equal((await serve(path.join(root, "text.txt"))).status, 415);
    assert.equal((await serve(path.join(directory, "outside.png"))).status, 403);
    assert.equal((await serve(path.join(root, "escape.png"))).status, 403);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
