import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, promises as fs } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 8787);
const CODEX_IPC_SOCKET =
  process.env.CODEX_IPC_SOCKET ||
  (process.platform === "win32"
    ? String.raw`\\.\pipe\codex-ipc`
    : path.join(os.tmpdir(), "codex-ipc", typeof process.getuid === "function" ? `ipc-${process.getuid()}.sock` : "ipc.sock"));
const STATE_DB = path.join(CODEX_HOME, "state_5.sqlite");
const SESSION_INDEX = path.join(CODEX_HOME, "session_index.jsonl");
const PUBLIC_DIR = path.join(__dirname, "public");
const IPC_VERSION_BY_METHOD = {
  "thread-follower-start-turn": 1
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const messageCache = new Map();
let codexIpcClient = null;

function sendJson(res, status, body) {
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(body));
}

function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function runSqlJson(sql) {
  return new Promise((resolve, reject) => {
    execFile("sqlite3", ["-json", STATE_DB, sql], { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      try {
        resolve(stdout.trim() ? JSON.parse(stdout) : []);
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

async function readJsonBody(req, limit = 128 * 1024) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > limit) {
      const err = new Error("Request body too large");
      err.status = 413;
      throw err;
    }
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    const err = new Error("Invalid JSON body");
    err.status = 400;
    throw err;
  }
}

class DesktopCodexIpcClient {
  constructor() {
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.ready = null;
    this.clientId = null;
  }

  async ensureReady() {
    if (this.socket?.writable && this.ready) {
      return this.ready;
    }
    this.ready = this.connect();
    return this.ready;
  }

  async connect() {
    if (process.platform !== "win32" && !existsSync(CODEX_IPC_SOCKET)) {
      throw new Error(`Codex desktop IPC socket not found: ${CODEX_IPC_SOCKET}`);
    }
    this.buffer = Buffer.alloc(0);
    this.pending.clear();
    this.clientId = null;

    await new Promise((resolve, reject) => {
      const socket = net.createConnection(CODEX_IPC_SOCKET);
      const fail = (error) => {
        socket.destroy();
        reject(error);
      };
      socket.once("connect", () => {
        socket.off("error", fail);
        resolve();
      });
      socket.once("error", fail);
      this.socket = socket;
    });

    this.socket.on("data", (chunk) => this.handleData(chunk));
    this.socket.on("error", (error) => this.reset(error));
    this.socket.on("close", () => this.reset(new Error("Codex desktop IPC connection closed")));

    const response = await this.request("initialize", { clientType: "webcontrolui" }, { includeVersion: false });
    if (response.resultType !== "success") {
      throw new Error(response.error || "Codex desktop IPC initialize failed");
    }
    this.clientId = response.result?.clientId || null;
    return response;
  }

  reset(error) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
    this.ready = null;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.clientId = null;
  }

  encode(message) {
    const payload = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length, 0);
    return Buffer.concat([header, payload]);
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (this.buffer.length < 4 + length) return;
      const payload = this.buffer.subarray(4, 4 + length).toString("utf8");
      this.buffer = this.buffer.subarray(4 + length);
      try {
        this.handleMessage(JSON.parse(payload));
      } catch {
        // Ignore malformed frames from experimental desktop IPC.
      }
    }
  }

  handleMessage(message) {
    if (message.type !== "response" || !message.requestId) return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    clearTimeout(pending.timer);
    if (message.resultType === "error") {
      pending.reject(new Error(message.error || `${message.method || "IPC request"} failed`));
      return;
    }
    pending.resolve(message);
  }

  request(method, params = {}, { includeVersion = true, timeoutMs = 12000 } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.socket?.writable) {
        reject(new Error("Codex desktop IPC is not connected"));
        return;
      }
      const requestId = randomUUID();
      const message = {
        type: "request",
        requestId,
        sourceClientId: this.clientId || undefined,
        method,
        params
      };
      if (includeVersion) {
        message.version = IPC_VERSION_BY_METHOD[method] ?? 0;
      }
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.socket.write(this.encode(message));
    });
  }

  async startTurn(threadId, text) {
    await this.ensureReady();
    return this.request("thread-follower-start-turn", {
      conversationId: threadId,
      turnStartParams: {
        input: [{ type: "text", text, text_elements: [] }],
        attachments: []
      }
    });
  }
}

function getCodexIpcClient() {
  if (!codexIpcClient) codexIpcClient = new DesktopCodexIpcClient();
  return codexIpcClient;
}

function sqlString(value) {
  return String(value).replaceAll("'", "''");
}

async function getThreads() {
  if (existsSync(STATE_DB)) {
    const rows = await runSqlJson(`
      SELECT id, title, rollout_path AS rolloutPath, created_at_ms AS createdAtMs,
             updated_at_ms AS updatedAtMs, archived, preview, cwd, model
      FROM threads
      ORDER BY updated_at_ms DESC, updated_at DESC
      LIMIT 500;
    `);
    return rows.map((row) => ({
      id: row.id,
      title: row.title || "Untitled",
      rolloutPath: row.rolloutPath,
      createdAtMs: row.createdAtMs,
      updatedAtMs: row.updatedAtMs,
      archived: Boolean(row.archived),
      preview: row.preview || "",
      cwd: row.cwd || "",
      model: row.model || ""
    }));
  }

  const content = await fs.readFile(SESSION_INDEX, "utf8");
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .reverse()
    .map((row) => ({
      id: row.id,
      title: row.thread_name || "Untitled",
      rolloutPath: null,
      updatedAtMs: Date.parse(row.updated_at)
    }));
}

async function findThread(id) {
  const rows = await runSqlJson(`
    SELECT id, title, rollout_path AS rolloutPath, updated_at_ms AS updatedAtMs
    FROM threads
    WHERE id = '${sqlString(id)}'
    LIMIT 1;
  `);
  return rows[0] || null;
}

function resolveRolloutPath(rolloutPath) {
  if (!rolloutPath) return null;
  const absolute = path.isAbsolute(rolloutPath) ? rolloutPath : path.join(CODEX_HOME, rolloutPath);
  const normalized = path.normalize(absolute);
  if (!normalized.startsWith(path.normalize(CODEX_HOME + path.sep))) {
    throw new Error("Rollout path is outside CODEX_HOME");
  }
  return normalized;
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      return part.text || part.input_text || part.output_text || "";
    })
    .filter(Boolean)
    .join("\n");
}

function stripCodexDirectives(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => !line.trim().match(/^::[a-zA-Z][\w-]*\{/))
    .join("\n")
    .trim();
}

function compact(value, limit = 6000) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n... truncated ${text.length - limit} chars`;
}

function messageFromEvent(timestamp, payload, meta = {}) {
  if (payload?.type === "user_message") {
    return { role: "user", kind: "message", timestamp, ...meta, content: stripCodexDirectives(payload.message) };
  }
  if (payload?.type === "agent_message") {
    return {
      role: "assistant",
      kind: "message",
      timestamp,
      ...meta,
      phase: payload.phase || "",
      content: stripCodexDirectives(payload.message)
    };
  }
  return null;
}

function messageFromResponseItem(timestamp, payload) {
  if (payload?.type === "function_call") {
    return {
      role: "tool",
      kind: "tool_call",
      timestamp,
      title: payload.name || "function_call",
      content: compact(payload.arguments || "")
    };
  }
  if (payload?.type === "function_call_output") {
    return {
      role: "tool",
      kind: "tool_output",
      timestamp,
      title: payload.call_id || "function_call_output",
      content: compact(payload.output || "")
    };
  }
  if (payload?.type === "message") {
    return {
      role: payload.role || "assistant",
      kind: "message",
      timestamp,
      content: stripCodexDirectives(textFromContent(payload.content))
    };
  }
  return null;
}

async function parseRollout(filePath) {
  const stat = await fs.stat(filePath);
  const signature = `${stat.size}:${stat.mtimeMs}`;
  const cached = messageCache.get(filePath);
  if (cached?.signature === signature) return cached.result;

  const eventMessages = [];
  const fallbackMessages = [];
  const toolMessages = [];
  let meta = {};
  let lineNumber = 0;
  let activeTurn = null;
  const assistantMessagesByTurn = new Map();

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    lineNumber += 1;
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === "session_meta") {
        meta = { ...meta, ...(entry.payload || {}) };
        continue;
      }
      if (entry.type === "event_msg") {
        if (entry.payload?.type === "task_started") {
          activeTurn = {
            turnId: entry.payload.turn_id || null,
            startedAtMs: Number(entry.payload.started_at) ? Number(entry.payload.started_at) * 1000 : Date.parse(entry.timestamp)
          };
          continue;
        }
        if (entry.payload?.type === "task_complete") {
          const turnId = entry.payload.turn_id || activeTurn?.turnId || null;
          const durationMs = Number(entry.payload.duration_ms);
          const completedAtMs = Number(entry.payload.completed_at) ? Number(entry.payload.completed_at) * 1000 : Date.parse(entry.timestamp);
          if (turnId && assistantMessagesByTurn.has(turnId)) {
            const message = assistantMessagesByTurn.get(turnId);
            if (Number.isFinite(durationMs)) message.durationMs = durationMs;
            if (Number.isFinite(completedAtMs)) message.completedAtMs = completedAtMs;
          }
          if (turnId && activeTurn?.turnId === turnId) activeTurn = null;
          continue;
        }
        const msg = messageFromEvent(entry.timestamp, entry.payload, {
          turnId: activeTurn?.turnId || null,
          turnStartedAtMs: activeTurn?.startedAtMs || null
        });
        if (msg?.content) {
          const message = { ...msg, lineNumber };
          eventMessages.push(message);
          if (message.role === "assistant" && message.turnId) assistantMessagesByTurn.set(message.turnId, message);
        }
        continue;
      }
      if (entry.type === "response_item") {
        const msg = messageFromResponseItem(entry.timestamp, entry.payload);
        if (!msg?.content) continue;
        if (msg.role === "tool") toolMessages.push({ ...msg, lineNumber });
        else fallbackMessages.push({ ...msg, lineNumber });
      }
    } catch {
      fallbackMessages.push({
        role: "system",
        kind: "parse_error",
        timestamp: null,
        lineNumber,
        content: `Could not parse JSONL line ${lineNumber}`
      });
    }
  }

  const chatMessages = eventMessages.length ? eventMessages : fallbackMessages;
  const result = {
    meta,
    file: filePath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    messages: [...chatMessages, ...toolMessages].sort((a, b) => {
      if (a.timestamp && b.timestamp) return String(a.timestamp).localeCompare(String(b.timestamp));
      return a.lineNumber - b.lineNumber;
    })
  };

  messageCache.set(filePath, { signature, result });
  return result;
}

async function getMessages(id) {
  const thread = await findThread(id);
  if (!thread) {
    const err = new Error("Thread not found");
    err.status = 404;
    throw err;
  }
  const rolloutPath = resolveRolloutPath(thread.rolloutPath);
  if (!rolloutPath || !existsSync(rolloutPath)) {
    const err = new Error("Rollout file not found");
    err.status = 404;
    throw err;
  }
  const parsed = await parseRollout(rolloutPath);
  return { thread, ...parsed };
}

async function sendToCodex(text, threadId) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    const err = new Error("Message is empty");
    err.status = 400;
    throw err;
  }
  if (trimmed.length > 12000) {
    const err = new Error("Message is too long");
    err.status = 400;
    throw err;
  }
  const targetThreadId = threadId || (await getThreads())[0]?.id;
  if (!targetThreadId) {
    const err = new Error("No target thread selected");
    err.status = 400;
    throw err;
  }
  if (!(await findThread(targetThreadId))) {
    const err = new Error("Thread not found");
    err.status = 404;
    throw err;
  }

  let result;
  try {
    result = await getCodexIpcClient().startTurn(targetThreadId, trimmed);
  } catch (error) {
    if (error.message === "no-client-found" || error.message.includes("thread-role-timeout")) {
      const err = new Error("Codex Desktop has no open owner for this thread. Open the target conversation in Codex Desktop, then send again.");
      err.status = 409;
      throw err;
    }
    throw error;
  }
  return {
    ok: true,
    mode: "desktop-ipc",
    threadId: targetThreadId,
    turnId: result?.result?.turn?.id || result?.result?.turnId || null,
    sentAt: new Date().toISOString()
  };
}

async function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(path.normalize(PUBLIC_DIR + path.sep))) {
    sendText(res, 403, "Forbidden");
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".svg": "image/svg+xml"
    };
    res.writeHead(200, {
      "content-type": types[ext] || "application/octet-stream",
      "cache-control": "no-cache"
    });
    res.end(data);
  } catch {
    sendText(res, 404, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, { ok: true, codexHome: CODEX_HOME, codexIpcSocket: CODEX_IPC_SOCKET, now: new Date().toISOString() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/send") {
      const body = await readJsonBody(req);
      sendJson(res, 200, await sendToCodex(body.message, body.threadId));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/threads") {
      sendJson(res, 200, { threads: await getThreads() });
      return;
    }
    const match = url.pathname.match(/^\/api\/threads\/([0-9a-fA-F-]{20,})\/messages$/);
    if (req.method === "GET" && match) {
      sendJson(res, 200, await getMessages(match[1]));
      return;
    }
    if (req.method !== "GET") {
      sendText(res, 405, "Method not allowed");
      return;
    }
    await serveStatic(res, decodeURIComponent(url.pathname));
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Codex LAN Viewer listening on http://${HOST}:${PORT}`);
  console.log(`CODEX_HOME=${CODEX_HOME}`);
});
