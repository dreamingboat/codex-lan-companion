import assert from "node:assert/strict";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const source = await fs.readFile(new URL("../server.js", import.meta.url), "utf8");
const client = await fs.readFile(new URL("../public/app.js", import.meta.url), "utf8");
const section = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));
const videoHelpers = vm.runInNewContext([
  section(source, "function videosFromText(", "function stripCodexDirectives("),
  section(source, "function parseVideoRange(", "async function serveLocalVideo("),
  "({videosFromText, parseVideoRange})"
].join("\n"), { path });

test("local MP4 embeds and download links deduplicate while remote, relative and code examples stay excluded", () => {
  const file = "/project with spaces/poster (final).mp4";
  const videos = videoHelpers.videosFromText(`Intro\n![Demo](<${file}>)\n[Download](<${file}>)\n[remote](https://example.com/v.mp4)\n[relative](./v.mp4)\n\`\`\`\n[example](/secret/demo.mp4)\n\`\`\``);
  assert.equal(videos.length, 1);
  assert.equal(videos[0].path, file);
  assert.equal(videos[0].label, "Demo");
  assert.equal(videos[0].references.length, 2);
  assert.equal(videoHelpers.videosFromText(null).length, 0);
  assert.equal(videoHelpers.videosFromText("[Video](/project/demo.MP4)").length, 1);
});

test("byte ranges support explicit, open-ended and suffix requests and reject invalid ranges", () => {
  for (const [header, expected] of [
    [undefined, [0, 99, false]], ["bytes=5-9", [5, 9, true]], ["bytes=95-", [95, 99, true]],
    ["bytes=-5", [95, 99, true]], ["bytes=-500", [0, 99, true]], ["bytes=0-500", [0, 99, true]]
  ]) {
    const range = videoHelpers.parseVideoRange(header, 100);
    assert.deepEqual([range.start, range.end, range.partial], expected);
  }
  for (const header of ["bytes=", "bytes=-", "bytes=-0", "bytes=100-", "bytes=8-3", "bytes=0-1,3-4", "items=0-9", "bytes=99999999999999999999-", "bytes=-99999999999999999999"]) {
    assert.equal(videoHelpers.parseVideoRange(header, 100), null, header);
  }
});

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "clc-video-test-"));
  const root = path.join(directory, "project");
  await fs.mkdir(root);
  const file = path.join(root, "demo clip.mp4");
  const bytes = Buffer.from(Array.from({ length: 65536 }, (_, index) => index % 251));
  await fs.writeFile(file, bytes);
  await fs.writeFile(path.join(root, "empty.mp4"), "");
  await fs.writeFile(path.join(root, "private.mp4"), bytes);
  await fs.writeFile(path.join(root, "private.txt"), "private");
  await fs.writeFile(path.join(directory, "outside.mp4"), bytes);
  await fs.symlink(path.join(directory, "outside.mp4"), path.join(root, "escape.mp4"));
  await fs.symlink(path.join(root, "private.txt"), path.join(root, "wrong-type.mp4"));
  await fs.mkdir(path.join(root, "directory.mp4"));
  const abortFile = path.join(root, "abort.mp4");
  const sparse = await fs.open(abortFile, "w");
  await sparse.truncate(16 * 1024 * 1024);
  await sparse.close();
  const referenced = [file, path.join(root, "empty.mp4"), path.join(root, "missing.mp4"), path.join(root, "escape.mp4"), path.join(root, "wrong-type.mp4"), path.join(root, "directory.mp4"), path.join(directory, "outside.mp4"), abortFile];
  const streams = [];
  const serve = vm.runInNewContext(`${section(source, "function parseVideoRange(", "const handleRequest =")}\nserveLocalVideo`, {
    path,
    fs: { ...fs,
      readFile: async () => { throw new Error("Videos must not be buffered with readFile"); },
      open: async (...args) => {
        const handle = await fs.open(...args);
        const create = handle.createReadStream.bind(handle);
        handle.createReadStream = (options) => { const stream = create(options); streams.push(stream); return stream; };
        return handle;
      }
    },
    getMessages: async (id) => {
      if (id !== "thread") throw Object.assign(new Error("Thread not found"), { status: 404 });
      return { thread: { cwd: root }, messages: [{ role: "assistant", videos: referenced.map((filePath) => ({ path: filePath })) }] };
    },
    sendText: (res, status, text) => { res.writeHead(status, { "content-type": "text/plain" }); res.end(text); }
  });
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers["x-access-token"] !== "test") { res.writeHead(401); res.end(); return; }
      const url = new URL(req.url, "http://localhost");
      await serve(req, res, { threadId: url.searchParams.get("threadId"), filePath: url.searchParams.get("path"), download: url.searchParams.get("download") === "1" });
    } catch (error) { res.writeHead(error.status || 500); res.end(error.message); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  const target = (filePath = file, threadId = "thread", download = false) => `/?threadId=${encodeURIComponent(threadId)}&path=${encodeURIComponent(filePath)}${download ? "&download=1" : ""}`;
  const request = (options = {}) => new Promise((resolve, reject) => {
    const headers = options.auth === false ? {} : { "x-access-token": "test" };
    if (options.range !== undefined) headers.range = options.range;
    const req = http.request({ host: "127.0.0.1", port, path: target(options.file || file, options.threadId ?? "thread", options.download), method: options.method || "GET", headers, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.setTimeout(4000, () => req.destroy(new Error("HTTP timeout")));
    req.on("error", reject);
    req.end();
  });
  return { root, file, directory, bytes, streams, port, abortFile, target, request, async close() {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  } };
}

test("real HTTP video responses stream full files, HEAD, downloads and concurrent ranges", async () => {
  const app = await fixture();
  try {
    const full = await app.request();
    assert.equal(full.status, 200);
    assert.equal(full.headers["content-type"], "video/mp4");
    assert.equal(full.headers["accept-ranges"], "bytes");
    assert.deepEqual(full.body, app.bytes);
    const partials = await Promise.all([app.request({ range: "bytes=10-29" }), app.request({ range: "bytes=-7" })]);
    assert.equal(partials[0].status, 206);
    assert.equal(partials[0].headers["content-range"], "bytes 10-29/65536");
    assert.deepEqual(partials[0].body, app.bytes.subarray(10, 30));
    assert.deepEqual(partials[1].body, app.bytes.subarray(-7));
    const before = app.streams.length;
    const head = await app.request({ method: "HEAD", download: true });
    assert.equal(head.status, 200);
    assert.equal(head.headers["content-length"], "65536");
    assert.match(head.headers["content-disposition"], /attachment; filename\*=UTF-8''demo%20clip\.mp4/);
    assert.equal(head.body.length, 0);
    assert.equal(app.streams.length, before);
    const seek = await app.request({ range: "bytes=65530-" });
    assert.equal(seek.status, 206);
    assert.deepEqual(seek.body, app.bytes.subarray(65530));
    const invalid = await app.request({ range: "bytes=65536-" });
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers["content-range"], "bytes */65536");
    assert.equal(invalid.body.length, 0);
  } finally { await app.close(); }
});

test("video access rejects unauthenticated, unreferenced, cross-thread, missing and escaped paths", async () => {
  const app = await fixture();
  try {
    assert.equal((await app.request({ auth: false })).status, 401);
    assert.equal((await app.request({ file: path.join(app.root, "private.mp4") })).status, 403);
    assert.equal((await app.request({ threadId: "another-thread" })).status, 404);
    assert.equal((await app.request({ threadId: "" })).status, 400);
    assert.equal((await app.request({ file: path.join(app.directory, "outside.mp4") })).status, 403);
    assert.equal((await app.request({ file: path.join(app.root, "escape.mp4") })).status, 403);
    assert.equal((await app.request({ file: path.join(app.root, "wrong-type.mp4") })).status, 415);
    assert.equal((await app.request({ file: path.join(app.root, "private.txt") })).status, 415);
    for (const name of ["missing.mp4", "empty.mp4", "directory.mp4"]) assert.equal((await app.request({ file: path.join(app.root, name) })).status, 404);
  } finally { await app.close(); }
});

test("aborting a video request destroys its stream before the entire file is read", async () => {
  const app = await fixture();
  try {
    await new Promise((resolve, reject) => {
      const req = http.get({ host: "127.0.0.1", port: app.port, path: app.target(app.abortFile), headers: { "x-access-token": "test" }, agent: false }, (res) => {
        res.once("data", () => { req.destroy(); resolve(); });
        res.on("error", () => {});
      });
      req.on("error", (error) => { if (error.code === "ECONNRESET") resolve(); else reject(error); });
    });
    const stream = app.streams.at(-1);
    if (!stream.closed) await once(stream, "close");
    assert.equal(stream.destroyed, true);
    assert.equal(stream.bytesRead < 16 * 1024 * 1024, true);
  } finally { await app.close(); }
});

test("video HTML is inline, metadata-only, escaped and has a download link", () => {
  const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  const render = vm.runInNewContext(`${section(client, "function renderMessageVideos(", "function openImagePreview(")}\nrenderMessageVideos`, { state: { selectedId: "thread", authToken: "token&test" }, escapeHtml, t: () => "Download MP4" });
  const html = render({ timestamp: "time", videos: [{ path: "/project/demo clip.mp4", label: '<img src=x onerror="bad">' }] });
  assert.match(html, /controls playsinline preload="metadata"/);
  assert.match(html, /download=1/);
  assert.match(html, /%2Fproject%2Fdemo%20clip.mp4/);
  assert.doesNotMatch(html, /autoplay|<img src/);
});

test("video reference removal preserves prose and literal fenced code", () => {
  const reference = "![Demo](</project/demo.mp4>)";
  const render = vm.runInNewContext(`${section(client, "function renderMarkdownLite(", "function renderGeneratedImageMarkdown(")}\nrenderMarkdownLite`, {
    escapeHtml: (value) => String(value).replaceAll("<", "&lt;"),
    renderInlinePluginRefs: (value) => value, renderGeneratedImageMarkdown: (value) => value
  });
  const html = render(`Video completed.\n\n${reference}\n\n\`\`\`\n${reference}\n\`\`\``, [{ references: [reference] }]);
  assert.match(html, /Video completed/);
  assert.equal((html.match(/demo\.mp4/g) || []).length, 1);
  assert.match(html, /<pre><code>/);
});

test("conversation rerender reuses the playing video node and releases removed videos", () => {
  const src = "/api/local-video?threadId=thread&path=demo";
  const calls = [];
  const existing = { currentTime: 42, getAttribute: () => src, pause() { calls.push("unexpected pause"); } };
  const removed = { pause() { calls.push("pause"); }, removeAttribute() { calls.push("clear"); }, load() { calls.push("load"); } };
  const placeholder = { dataset: { videoKey: "same" }, getAttribute: () => src, replaceWith(node) { assert.equal(node, existing); calls.push("reuse"); } };
  const restore = section(client, '  for (const placeholder of els.messageList.querySelectorAll("video[data-video-key]"))', "  if (focusedQuestion)");
  vm.runInNewContext(restore, { playingVideos: new Map([["same", existing], ["removed", removed]]), els: { messageList: { querySelectorAll: () => [placeholder] } } });
  assert.equal(existing.currentTime, 42);
  assert.deepEqual(calls, ["reuse", "pause", "clear", "load"]);
});
