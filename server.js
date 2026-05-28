#!/usr/bin/env node
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createReadStream, existsSync, promises as fs } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import qrcode from "qrcode-terminal";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inlineValue] = arg.split("=", 2);
    const nextValue = () => inlineValue ?? argv[++index];
    if (flag === "--help" || flag === "-h") options.help = true;
    else if (flag === "--host") options.host = nextValue();
    else if (flag === "--port") options.port = nextValue();
    else if (flag === "--token") options.token = nextValue();
    else if (flag === "--password") options.password = nextValue();
    else if (flag === "--codex-home") options.codexHome = nextValue();
    else if (flag === "--ipc-socket") options.ipcSocket = nextValue();
    else if (flag === "--write") options.write = true;
    else if (flag === "--readonly") options.readonly = true;
    else if (flag === "--no-auth") options.noAuth = true;
    else if (arg) {
      console.error(`Unknown option: ${arg}`);
      options.help = true;
      options.invalid = true;
    }
  }
  return options;
}

function printHelp() {
  console.log(`Codex LAN Companion

Usage:
  codex-lan-companion [options]

Options:
  --host <host>          Bind host. Default: 0.0.0.0
  --port <port>          Bind port. Default: 8787
  --password <password>  Friendly access code. Default: generated per launch
  --token <token>        Alias for --password
  --write                Enable sending messages to Codex Desktop
  --readonly             Force read-only mode. Default
  --no-auth              Disable access token guard
  --codex-home <path>    Codex data directory. Default: ~/.codex
  --ipc-socket <path>    Codex Desktop IPC socket override
  -h, --help             Show this help

Examples:
  codex-lan-companion
  codex-lan-companion --write
  codex-lan-companion --port 8790 --password home-only
`);
}

const cli = parseCliArgs(process.argv.slice(2));
if (cli.help) {
  printHelp();
  process.exit(cli.invalid ? 1 : 0);
}

const CODEX_HOME = cli.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const HOST = cli.host || process.env.HOST || "0.0.0.0";
const PORT = Number(cli.port || process.env.PORT || 8787);
const AUTH_REQUIRED = !cli.noAuth && process.env.CODEX_LAN_NO_AUTH !== "1";
const ACCESS_TOKEN = cli.password || cli.token || process.env.CODEX_LAN_PASSWORD || process.env.CODEX_LAN_TOKEN || randomBytes(4).toString("hex");
const ALLOW_WRITE = cli.readonly ? false : Boolean(cli.write || process.env.CODEX_LAN_ALLOW_WRITE === "1" || process.env.CODEX_ALLOW_WRITE === "1");
const CODEX_IPC_SOCKET =
  cli.ipcSocket ||
  process.env.CODEX_IPC_SOCKET ||
  (process.platform === "win32"
    ? String.raw`\\.\pipe\codex-ipc`
    : path.join(os.tmpdir(), "codex-ipc", typeof process.getuid === "function" ? `ipc-${process.getuid()}.sock` : "ipc.sock"));
const STATE_DB = path.join(CODEX_HOME, "state_5.sqlite");
const SESSION_INDEX = path.join(CODEX_HOME, "session_index.jsonl");
const AUTH_FILE = path.join(CODEX_HOME, "auth.json");
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
let accountCache = null;

function sendJson(res, status, body) {
  res.writeHead(status, jsonHeaders);
  res.end(JSON.stringify(body));
}

function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function requestToken(req, url) {
  const header = req.headers["x-access-token"] || req.headers.authorization;
  if (Array.isArray(header)) return header[0] || "";
  if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) return header.slice(7);
  if (typeof header === "string") return header;
  return url.searchParams.get("token") || "";
}

function isAuthorized(req, url) {
  if (!AUTH_REQUIRED) return true;
  return requestToken(req, url) === ACCESS_TOKEN;
}

function requireAuthorized(req, res, url) {
  if (isAuthorized(req, url)) return true;
  sendJson(res, 401, { error: "Unauthorized", authRequired: true });
  return false;
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

function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function displayPlanName(plan) {
  const normalized = String(plan || "").trim().toLowerCase();
  if (!normalized) return "";
  const names = {
    free: "Free",
    plus: "Plus",
    pro: "Pro",
    team: "Team",
    enterprise: "Enterprise"
  };
  return names[normalized] || normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

async function readAuthProfile() {
  if (!existsSync(AUTH_FILE)) return {};
  const raw = await fs.readFile(AUTH_FILE, "utf8");
  const auth = JSON.parse(raw);
  const idClaims = decodeJwtPayload(auth.tokens?.id_token) || {};
  const accessClaims = decodeJwtPayload(auth.tokens?.access_token) || {};
  const planClaim =
    idClaims["https://api.openai.com/auth.chatgpt_plan_type"] ||
    accessClaims["https://api.openai.com/auth.chatgpt_plan_type"];
  return {
    name: idClaims.name || accessClaims.name || "",
    email: idClaims.email || accessClaims.email || "",
    authMode: auth.auth_mode || "",
    tokenPlan: planClaim || ""
  };
}

function normalizeRateLimitWindow(limit) {
  if (!limit || typeof limit !== "object") return null;
  const resetsAtSeconds = Number(limit.resets_at);
  const usedPercent = Number(limit.used_percent);
  const windowMinutes = Number(limit.window_minutes);
  return {
    usedPercent: Number.isFinite(usedPercent) ? usedPercent : null,
    windowMinutes: Number.isFinite(windowMinutes) ? windowMinutes : null,
    resetsAtMs: Number.isFinite(resetsAtSeconds) ? resetsAtSeconds * 1000 : null
  };
}

function normalizeRateLimits(rateLimits, updatedAt) {
  if (!rateLimits || typeof rateLimits !== "object") return null;
  return {
    planType: rateLimits.plan_type || "",
    primary: normalizeRateLimitWindow(rateLimits.primary),
    secondary: normalizeRateLimitWindow(rateLimits.secondary),
    credits:
      rateLimits.credits && typeof rateLimits.credits === "object"
        ? {
            hasCredits: Boolean(rateLimits.credits.has_credits),
            unlimited: Boolean(rateLimits.credits.unlimited),
            balance: Number.isFinite(Number(rateLimits.credits.balance)) ? Number(rateLimits.credits.balance) : null
          }
        : null,
    updatedAt: updatedAt || null
  };
}

async function latestRolloutPaths(limit = 8) {
  if (!existsSync(STATE_DB)) return [];
  const rows = await runSqlJson(`
    SELECT rollout_path AS rolloutPath
    FROM threads
    WHERE rollout_path IS NOT NULL
    ORDER BY updated_at_ms DESC, updated_at DESC
    LIMIT ${Number(limit) || 8};
  `);
  return rows
    .map((row) => {
      try {
        return resolveRolloutPath(row.rolloutPath);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function readLatestRateLimits() {
  const rolloutPaths = await latestRolloutPaths();
  for (const rolloutPath of rolloutPaths) {
    if (!existsSync(rolloutPath)) continue;
    const content = await fs.readFile(rolloutPath, "utf8");
    const lines = content.split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]?.trim();
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        const rateLimits = entry.type === "event_msg" && entry.payload?.type === "token_count" ? entry.payload.rate_limits : null;
        if (rateLimits) return normalizeRateLimits(rateLimits, entry.timestamp);
      } catch {
        // Skip malformed historical lines.
      }
    }
  }
  return null;
}

async function getAccountInfo() {
  const now = Date.now();
  if (accountCache && now - accountCache.cachedAt < 15000) return accountCache.value;

  const profile = await readAuthProfile();
  const usage = await readLatestRateLimits();
  const plan = usage?.planType || profile.tokenPlan || profile.authMode || "";
  const value = {
    user: {
      name: profile.name,
      email: profile.email,
      label: profile.name || profile.email || "Codex"
    },
    plan: {
      type: String(plan || "").toLowerCase(),
      label: displayPlanName(plan)
    },
    usage
  };
  accountCache = { cachedAt: now, value };
  return value;
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
    status: {
      thinking: Boolean(activeTurn),
      turnId: activeTurn?.turnId || null,
      startedAtMs: activeTurn?.startedAtMs || null
    },
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
  if (!ALLOW_WRITE) {
    const err = new Error("Write mode is disabled. Restart with --write to send messages to Codex Desktop.");
    err.status = 403;
    throw err;
  }
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
      ".png": "image/png",
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
      if (!requireAuthorized(req, res, url)) return;
      sendJson(res, 200, {
        ok: true,
        codexHome: CODEX_HOME,
        codexIpcSocket: CODEX_IPC_SOCKET,
        authRequired: AUTH_REQUIRED,
        allowWrite: ALLOW_WRITE,
        now: new Date().toISOString()
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/send") {
      if (!requireAuthorized(req, res, url)) return;
      const body = await readJsonBody(req);
      sendJson(res, 200, await sendToCodex(body.message, body.threadId));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/account") {
      if (!requireAuthorized(req, res, url)) return;
      sendJson(res, 200, await getAccountInfo());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/threads") {
      if (!requireAuthorized(req, res, url)) return;
      sendJson(res, 200, { threads: await getThreads() });
      return;
    }
    const match = url.pathname.match(/^\/api\/threads\/([0-9a-fA-F-]{20,})\/messages$/);
    if (req.method === "GET" && match) {
      if (!requireAuthorized(req, res, url)) return;
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
  const localUrl = `http://127.0.0.1:${PORT}/`;
  const lanUrls = Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => `http://${entry.address}:${PORT}/`);
  const primaryUrl = lanUrls[0] || localUrl;

  console.log("Codex LAN Companion is running");
  console.log(`Local:  ${localUrl}`);
  for (const lanUrl of lanUrls) console.log(`LAN:    ${lanUrl}`);
  if (AUTH_REQUIRED) console.log(`Access code: ${ACCESS_TOKEN}`);
  console.log(`Mode:   ${ALLOW_WRITE ? "write enabled" : "read-only"}${AUTH_REQUIRED ? " · token protected" : " · auth disabled"}`);
  console.log(`Data:   ${CODEX_HOME}`);
  console.log("");
  qrcode.generate(primaryUrl, { small: true });
});
