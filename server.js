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
    else if (flag === "--dev-any-code") options.devAnyCode = true;
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
  --dev-any-code         Test mode: accept any non-empty access code
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
const DEV_ANY_CODE = Boolean(cli.devAnyCode || process.env.CODEX_LAN_DEV_ANY_CODE === "1");
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
const MAX_SEND_IMAGES = 4;
const MAX_SEND_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_SEND_BODY_BYTES = 32 * 1024 * 1024;
const MIN_SEND_IMAGE_BYTES = 512;
const MIN_SEND_IMAGE_EDGE = 16;
const MAX_SEND_IMAGE_EDGE = 4096;
const MAX_SEND_IMAGE_PIXELS = 12_000_000;
const SUPPORTED_SEND_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const IPC_VERSION_BY_METHOD = {
  "thread-follower-start-turn": 1,
  "thread-follower-interrupt-turn": 1
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const messageCache = new Map();
const recentNotices = [];
let codexIpcClient = null;
let accountCache = null;
let sqliteQueue = Promise.resolve();

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
  const token = requestToken(req, url);
  if (DEV_ANY_CODE) return Boolean(String(token || "").trim());
  return token === ACCESS_TOKEN;
}

function requireAuthorized(req, res, url) {
  if (isAuthorized(req, url)) return true;
  sendJson(res, 401, { error: "Unauthorized", authRequired: true });
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSqliteLocked(error) {
  return String(error?.message || error || "").toLowerCase().includes("database is locked");
}

function runSqlJsonAttempt(sql) {
  return new Promise((resolve, reject) => {
    execFile("sqlite3", ["-json", "-cmd", ".timeout 5000", STATE_DB, sql], { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
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

function runSqlJson(sql) {
  const work = async () => {
    let lastError;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await runSqlJsonAttempt(sql);
      } catch (error) {
        lastError = error;
        if (!isSqliteLocked(error)) throw error;
        await sleep(150 * (attempt + 1));
      }
    }
    throw lastError;
  };
  const next = sqliteQueue.then(work, work);
  sqliteQueue = next.catch(() => {});
  return next;
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
    this.events = [];
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
    if (message.type !== "response" || !message.requestId) {
      this.captureEvent(message);
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) {
      this.captureEvent(message);
      return;
    }
    this.pending.delete(message.requestId);
    clearTimeout(pending.timer);
    if (message.resultType === "error") {
      const error = new Error(message.error || `${message.method || pending.method || "IPC request"} failed`);
      error.ipcMessage = message;
      error.ipcMethod = pending.method;
      error.ipcParams = pending.params;
      pending.reject(error);
      return;
    }
    pending.resolve(message);
  }

  captureEvent(message) {
    if (!message || typeof message !== "object") return;
    this.events.push({
      timestamp: new Date().toISOString(),
      message
    });
    if (this.events.length > 120) this.events.splice(0, this.events.length - 120);
  }

  getRecentInteractionMessages(threadId) {
    const selectedThreadId = String(threadId || "");
    return this.events
      .map((event, index) => {
        const payload = event.message?.payload || event.message?.params || event.message;
        const messageThreadId =
          event.message?.conversationId ||
          event.message?.conversation_id ||
          event.message?.threadId ||
          event.message?.thread_id ||
          event.message?.params?.conversationId ||
          event.message?.params?.conversation_id ||
          event.message?.params?.threadId ||
          event.message?.params?.thread_id ||
          "";
        if (messageThreadId && String(messageThreadId) !== selectedThreadId) return null;
        const interaction = messageFromInteractionEvent(event.timestamp, payload, {
          source: "desktop-ipc",
          turnId: event.message?.turnId || event.message?.params?.turnId || null
        });
        if (!hasDisplayableMessageContent(interaction)) return null;
        return {
          ...interaction,
          lineNumber: 1000000 + index,
          requiresDesktopAction: true
        };
      })
      .filter(Boolean);
  }

  getRecentNoticeMessages(threadId) {
    const selectedThreadId = String(threadId || "");
    return this.events
      .map((event, index) => {
        const payload = event.message?.payload || event.message?.params || event.message;
        const messageThreadId =
          event.message?.conversationId ||
          event.message?.conversation_id ||
          event.message?.threadId ||
          event.message?.thread_id ||
          event.message?.params?.conversationId ||
          event.message?.params?.conversation_id ||
          event.message?.params?.threadId ||
          event.message?.params?.thread_id ||
          "";
        if (messageThreadId && String(messageThreadId) !== selectedThreadId) return null;
        const notice = messageFromNoticeEvent(event.timestamp, payload, {
          source: "desktop-ipc",
          turnId: event.message?.turnId || event.message?.params?.turnId || null
        });
        if (!hasDisplayableMessageContent(notice)) return null;
        return {
          ...notice,
          lineNumber: 1500000 + index
        };
      })
      .filter(Boolean);
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
      this.pending.set(requestId, { resolve, reject, timer, method, params });
      this.socket.write(this.encode(message));
    });
  }

  async startTurn(threadId, text, images = []) {
    await this.ensureReady();
    const input = [];
    if (text) input.push({ type: "text", text, text_elements: [] });
    for (const image of images) {
      input.push({
        type: "image",
        url: `data:${image.mimeType};base64,${image.data}`
      });
    }
    return this.request("thread-follower-start-turn", {
      conversationId: threadId,
      turnStartParams: {
        input,
        attachments: []
      }
    });
  }

  async interruptTurn(threadId) {
    await this.ensureReady();
    return this.request("thread-follower-interrupt-turn", {
      conversationId: threadId
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

function imagesFromContent(content) {
  if (!Array.isArray(content)) return [];
  return content
    .map((part) => {
      const source = part?.source || {};
      if (part?.type !== "image" || source.type !== "base64" || !source.data || !source.media_type) return null;
      return `data:${source.media_type};base64,${source.data}`;
    })
    .filter(Boolean);
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

const INTERACTION_TYPE_PATTERNS = [
  "approval",
  "permission",
  "permissions",
  "elicitation",
  "request_user_input",
  "user_input_request",
  "terminal_interaction",
  "dynamic_tool_call_request",
  "command_approval",
  "file_approval"
];

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && value.length) {
      const joined = value
        .map((part) => (typeof part === "string" ? part : ""))
        .filter(Boolean)
        .join(" ");
      if (joined.trim()) return joined.trim();
    }
  }
  return "";
}

function redactLargePayloads(value, depth = 0) {
  if (depth > 5) return "[nested payload]";
  if (typeof value === "string") {
    if (value.length > 240 && /^[A-Za-z0-9+/]+={0,2}$/.test(value)) return `[base64 data ${value.length} chars]`;
    if (value.length > 1200) return `${value.slice(0, 1200)}...`;
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactLargePayloads(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.includes("image") || normalizedKey.includes("base64") || normalizedKey === "data") {
        if (typeof item === "string") return [key, `[omitted ${item.length} chars]`];
        return [key, "[omitted binary payload]"];
      }
      return [key, redactLargePayloads(item, depth + 1)];
    })
  );
}

function isInteractionPayload(payload) {
  const text = [
    payload?.type,
    payload?.method,
    payload?.name,
    payload?.event,
    payload?.kind,
    payload?.payload?.type,
    payload?.params?.type
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return INTERACTION_TYPE_PATTERNS.some((pattern) => text.includes(pattern));
}

function interactionTitle(payload) {
  const type = String(payload?.type || payload?.method || payload?.name || payload?.kind || "").toLowerCase();
  if (type.includes("command")) return "Command approval requested";
  if (type.includes("file")) return "File approval requested";
  if (type.includes("permission")) return "Permission requested";
  if (type.includes("elicitation")) return "Additional information requested";
  if (type.includes("user_input")) return "User input requested";
  if (type.includes("terminal")) return "Terminal interaction requested";
  if (type.includes("tool")) return "Tool interaction requested";
  return "Codex interaction requested";
}

function interactionContent(payload) {
  const params = payload?.params || payload?.payload || {};
  const request = payload?.request || params?.request || {};
  const toolCall = payload?.tool_call || params?.tool_call || params?.toolCall || {};
  const command = firstString(
    payload?.command,
    params?.command,
    request?.command,
    payload?.cmd,
    params?.cmd,
    toolCall?.command,
    toolCall?.name
  );
  const pathValue = firstString(payload?.path, params?.path, request?.path, payload?.file_path, params?.file_path, request?.file_path);
  const prompt = firstString(
    payload?.message,
    params?.message,
    request?.message,
    payload?.prompt,
    params?.prompt,
    payload?.question,
    params?.question,
    request?.question,
    payload?.reason,
    params?.reason,
    request?.reason
  );
  const choices = Array.isArray(payload?.options)
    ? payload.options
    : Array.isArray(params?.options)
      ? params.options
      : Array.isArray(request?.options)
        ? request.options
        : [];
  const lines = [
    prompt ? `Prompt: ${prompt}` : "",
    command ? `Command: ${command}` : "",
    pathValue ? `Path: ${pathValue}` : "",
    choices.length ? `Options: ${choices.map((option) => firstString(option?.label, option?.title, option?.id, option)).filter(Boolean).join(", ")}` : ""
  ].filter(Boolean);
  if (lines.length) return lines.join("\n\n");
  return compact(redactLargePayloads(payload), 2400);
}

function messageFromInteractionEvent(timestamp, payload, meta = {}) {
  if (!isInteractionPayload(payload)) return null;
  return {
    role: "interaction",
    kind: payload?.type || payload?.method || payload?.name || "interaction",
    timestamp,
    ...meta,
    title: interactionTitle(payload),
    requestId: payload?.request_id || payload?.requestId || payload?.id || payload?.call_id || payload?.params?.request_id || null,
    content: interactionContent(payload),
    requiresDesktopAction: true
  };
}

const NOTICE_TYPE_PATTERNS = [
  "notice",
  "notification",
  "toast",
  "banner",
  "alert",
  "warning",
  "error",
  "limit",
  "quota",
  "rate_limit",
  "usage_limit",
  "plan_limit"
];

function isNoticePayload(payload) {
  const text = [
    payload?.type,
    payload?.method,
    payload?.name,
    payload?.event,
    payload?.kind,
    payload?.code,
    payload?.errorCode,
    payload?.payload?.type,
    payload?.payload?.code,
    payload?.params?.type,
    payload?.params?.code
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return NOTICE_TYPE_PATTERNS.some((pattern) => text.includes(pattern));
}

function noticeSeverity(payload, fallback = "info") {
  const text = [
    fallback,
    payload?.level,
    payload?.severity,
    payload?.type,
    payload?.kind,
    payload?.code,
    payload?.errorCode,
    payload?.resultType,
    payload?.params?.level,
    payload?.payload?.level
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (text.includes("error") || text.includes("fail") || text.includes("limit") || text.includes("quota")) return "error";
  if (text.includes("warn")) return "warning";
  return fallback || "info";
}

function noticeTitle(payload, severity = "info") {
  const text = [
    payload?.title,
    payload?.params?.title,
    payload?.payload?.title,
    payload?.code,
    payload?.errorCode,
    payload?.type,
    payload?.kind
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (text.includes("limit") || text.includes("quota") || text.includes("rate")) return "Usage limit";
  if (severity === "error") return "Error";
  if (severity === "warning") return "Warning";
  return "Notice";
}

function noticeContent(payload) {
  const params = payload?.params || payload?.payload || {};
  const content = firstString(
    payload?.message,
    payload?.error,
    payload?.description,
    payload?.body,
    payload?.text,
    payload?.title,
    params?.message,
    params?.error,
    params?.description,
    params?.body,
    params?.text,
    params?.title
  );
  if (content) return content;
  return compact(redactLargePayloads(payload), 1800);
}

function messageFromNoticeEvent(timestamp, payload, meta = {}) {
  if (!isNoticePayload(payload)) return null;
  const severity = noticeSeverity(payload);
  return {
    role: "notice",
    kind: severity,
    timestamp,
    ...meta,
    title: noticeTitle(payload, severity),
    content: noticeContent(payload)
  };
}

function recordNotice(threadId, { severity = "info", title = "", content = "", source = "server" } = {}) {
  if (!threadId || !content) return null;
  const notice = {
    id: randomUUID(),
    threadId: String(threadId),
    timestamp: new Date().toISOString(),
    role: "notice",
    kind: severity,
    title: title || noticeTitle({ type: severity }, severity),
    content: String(content).trim(),
    source,
    lineNumber: 2000000 + recentNotices.length
  };
  recentNotices.push(notice);
  if (recentNotices.length > 120) recentNotices.splice(0, recentNotices.length - 120);
  return notice;
}

function getRecentNoticeMessages(threadId) {
  const selectedThreadId = String(threadId || "");
  return recentNotices
    .filter((notice) => notice.threadId === selectedThreadId)
    .map((notice, index) => ({ ...notice, lineNumber: notice.lineNumber || 2000000 + index }));
}

function messageFromEvent(timestamp, payload, meta = {}) {
  if (payload?.type === "user_message") {
    return {
      role: "user",
      kind: "message",
      timestamp,
      ...meta,
      content: stripCodexDirectives(payload.message),
      images: Array.isArray(payload.images) ? payload.images : [],
      localImages: Array.isArray(payload.local_images) ? payload.local_images : []
    };
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
      content: stripCodexDirectives(textFromContent(payload.content)),
      images: imagesFromContent(payload.content)
    };
  }
  return null;
}

function hasDisplayableMessageContent(message) {
  return Boolean(message?.content || message?.images?.length || message?.localImages?.length);
}

function isTurnEndEvent(payload) {
  return payload?.type === "task_complete" || payload?.type === "turn_aborted";
}

async function parseRollout(filePath) {
  const stat = await fs.stat(filePath);
  const signature = `${stat.size}:${stat.mtimeMs}`;
  const cached = messageCache.get(filePath);
  if (cached?.signature === signature) return cached.result;

  const eventMessages = [];
  const fallbackMessages = [];
  const toolMessages = [];
  const interactionMessages = [];
  const noticeMessages = [];
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
        if (isTurnEndEvent(entry.payload)) {
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
        const messageMeta = {
          turnId: activeTurn?.turnId || null,
          turnStartedAtMs: activeTurn?.startedAtMs || null
        };
        const interaction = messageFromInteractionEvent(entry.timestamp, entry.payload, messageMeta);
        if (hasDisplayableMessageContent(interaction)) {
          interactionMessages.push({ ...interaction, lineNumber });
          continue;
        }
        const notice = messageFromNoticeEvent(entry.timestamp, entry.payload, messageMeta);
        if (hasDisplayableMessageContent(notice)) {
          noticeMessages.push({ ...notice, lineNumber });
          continue;
        }
        const msg = messageFromEvent(entry.timestamp, entry.payload, messageMeta);
        if (hasDisplayableMessageContent(msg)) {
          const message = { ...msg, lineNumber };
          eventMessages.push(message);
          if (message.role === "assistant" && message.turnId) assistantMessagesByTurn.set(message.turnId, message);
        }
        continue;
      }
      if (entry.type === "response_item") {
        const interaction = messageFromInteractionEvent(entry.timestamp, entry.payload);
        if (hasDisplayableMessageContent(interaction)) {
          interactionMessages.push({ ...interaction, lineNumber });
          continue;
        }
        const notice = messageFromNoticeEvent(entry.timestamp, entry.payload);
        if (hasDisplayableMessageContent(notice)) {
          noticeMessages.push({ ...notice, lineNumber });
          continue;
        }
        const msg = messageFromResponseItem(entry.timestamp, entry.payload);
        if (!hasDisplayableMessageContent(msg)) continue;
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
  for (const message of interactionMessages) {
    message.requiresDesktopAction = Boolean(activeTurn && (!message.turnId || message.turnId === activeTurn.turnId));
  }
  const pendingInteractions = interactionMessages.filter((message) => message.requiresDesktopAction);
  const result = {
    meta,
    file: filePath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    status: {
      thinking: Boolean(activeTurn),
      turnId: activeTurn?.turnId || null,
      startedAtMs: activeTurn?.startedAtMs || null,
      interactionRequired: pendingInteractions.length > 0
    },
    messages: [...chatMessages, ...interactionMessages, ...noticeMessages, ...toolMessages].sort((a, b) => {
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
  const ipcInteractions = codexIpcClient?.getRecentInteractionMessages(id) || [];
  const ipcNotices = codexIpcClient?.getRecentNoticeMessages(id) || [];
  const serverNotices = getRecentNoticeMessages(id);
  const liveMessages = [...ipcInteractions, ...ipcNotices, ...serverNotices];
  if (!liveMessages.length) return { thread, ...parsed };
  return {
    thread,
    ...parsed,
    status: {
      ...parsed.status,
      interactionRequired: parsed.status?.interactionRequired || ipcInteractions.some((message) => message.requiresDesktopAction)
    },
    messages: [...parsed.messages, ...liveMessages].sort((a, b) => {
      if (a.timestamp && b.timestamp) return String(a.timestamp).localeCompare(String(b.timestamp));
      return a.lineNumber - b.lineNumber;
    })
  };
}

function normalizeSendImages(images) {
  if (!Array.isArray(images)) return [];
  if (images.length > MAX_SEND_IMAGES) {
    const err = new Error(`Too many images. Maximum is ${MAX_SEND_IMAGES}.`);
    err.status = 400;
    throw err;
  }
  return images.map((image, index) => {
    const mimeType = String(image?.mimeType || "").trim().toLowerCase();
    const data = String(image?.data || "").replace(/^data:[^;]+;base64,/, "");
    const name = String(image?.name || `image-${index + 1}`).slice(0, 120);
    if (!SUPPORTED_SEND_IMAGE_MIME_TYPES.has(mimeType)) {
      const err = new Error("Unsupported image format. Use JPEG, PNG, or WebP.");
      err.status = 400;
      throw err;
    }
    if (!data || data.length % 4 !== 0 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(data)) {
      const err = new Error("Invalid image data");
      err.status = 400;
      throw err;
    }
    const bytes = Buffer.from(data, "base64");
    const validation = validateSendImageBytes(bytes, mimeType);
    if (bytes.byteLength > MAX_SEND_IMAGE_BYTES) {
      const err = new Error(`Image is too large. Maximum is ${Math.round(MAX_SEND_IMAGE_BYTES / 1024 / 1024)} MB.`);
      err.status = 400;
      throw err;
    }
    return { name, mimeType, data, size: bytes.byteLength, width: validation.width, height: validation.height };
  });
}

function invalidImage(message = "Invalid image data") {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function validateSendImageBytes(bytes, mimeType) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength < MIN_SEND_IMAGE_BYTES) {
    throw invalidImage("Invalid image: image data is too small.");
  }
  const dimensions =
    mimeType === "image/jpeg"
      ? jpegDimensions(bytes)
      : mimeType === "image/png"
        ? pngDimensions(bytes)
        : mimeType === "image/webp"
          ? webpDimensions(bytes)
          : null;
  if (!dimensions) {
    throw invalidImage("Invalid image: file content does not match its image type.");
  }
  const { width, height } = dimensions;
  const pixels = width * height;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < MIN_SEND_IMAGE_EDGE ||
    height < MIN_SEND_IMAGE_EDGE ||
    width > MAX_SEND_IMAGE_EDGE ||
    height > MAX_SEND_IMAGE_EDGE ||
    pixels > MAX_SEND_IMAGE_PIXELS
  ) {
    throw invalidImage(
      `Invalid image: dimensions must be ${MIN_SEND_IMAGE_EDGE}-${MAX_SEND_IMAGE_EDGE}px per side and under ${Math.round(MAX_SEND_IMAGE_PIXELS / 1_000_000)}MP.`
    );
  }
  return dimensions;
}

function pngDimensions(bytes) {
  const signature = "89504e470d0a1a0a";
  if (bytes.byteLength < 33 || bytes.subarray(0, 8).toString("hex") !== signature) return null;
  if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return { width, height };
}

function jpegDimensions(bytes) {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) return null;
    let marker = bytes[offset + 1];
    while (marker === 0xff) {
      offset += 1;
      marker = bytes[offset + 1];
    }
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > bytes.byteLength) return null;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) return null;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (segmentLength < 7) return null;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      return { width, height };
    }
    offset += segmentLength;
  }
  return null;
}

function webpDimensions(bytes) {
  if (bytes.byteLength < 30 || bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WEBP") {
    return null;
  }
  const chunk = bytes.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X" && bytes.byteLength >= 30) {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3)
    };
  }
  if (chunk === "VP8 " && bytes.byteLength >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff
    };
  }
  if (chunk === "VP8L" && bytes.byteLength >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1
    };
  }
  return null;
}

async function sendToCodex(text, threadId, images = []) {
  if (!ALLOW_WRITE) {
    const err = new Error("Write mode is disabled. Restart with --write to send messages to Codex Desktop.");
    err.status = 403;
    throw err;
  }
  const trimmed = String(text || "").trim();
  const normalizedImages = normalizeSendImages(images);
  if (!trimmed && !normalizedImages.length) {
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
    result = await getCodexIpcClient().startTurn(targetThreadId, trimmed, normalizedImages);
  } catch (error) {
    const noticeMessage = error?.message || "Codex Desktop rejected the message.";
    if (error.message === "no-client-found" || error.message.includes("thread-role-timeout")) {
      const err = new Error("Codex Desktop has no open owner for this thread. Open the target conversation in Codex Desktop, then send again.");
      err.status = 409;
      recordNotice(targetThreadId, {
        severity: "error",
        title: "Send failed",
        content: err.message,
        source: "send"
      });
      throw err;
    }
    recordNotice(targetThreadId, {
      severity: noticeSeverity(error?.ipcMessage || { type: "error", message: noticeMessage }, "error"),
      title: noticeTitle(error?.ipcMessage || { type: "error", message: noticeMessage }, "error"),
      content: noticeMessage,
      source: "send"
    });
    throw error;
  }
  return {
    ok: true,
    mode: "desktop-ipc",
    threadId: targetThreadId,
    images: normalizedImages.map(({ name, mimeType, size }) => ({ name, mimeType, size })),
    turnId: result?.result?.turn?.id || result?.result?.turnId || null,
    sentAt: new Date().toISOString()
  };
}

async function interruptCodex(threadId) {
  if (!ALLOW_WRITE) {
    const err = new Error("Write mode is disabled. Restart with --write to control Codex Desktop.");
    err.status = 403;
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

  try {
    await getCodexIpcClient().interruptTurn(targetThreadId);
  } catch (error) {
    if (error.message === "no-client-found" || error.message.includes("thread-role-timeout")) {
      const err = new Error("Codex Desktop has no open owner for this thread. Open the target conversation in Codex Desktop, then try again.");
      err.status = 409;
      throw err;
    }
    throw error;
  }
  return {
    ok: true,
    mode: "desktop-ipc",
    threadId: targetThreadId,
    interruptedAt: new Date().toISOString()
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
      "cache-control": "no-store, must-revalidate"
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
        devAnyCode: DEV_ANY_CODE,
        allowWrite: ALLOW_WRITE,
        now: new Date().toISOString()
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/send") {
      if (!requireAuthorized(req, res, url)) return;
      const body = await readJsonBody(req, MAX_SEND_BODY_BYTES);
      sendJson(res, 200, await sendToCodex(body.message, body.threadId, body.images));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/interrupt") {
      if (!requireAuthorized(req, res, url)) return;
      const body = await readJsonBody(req);
      sendJson(res, 200, await interruptCodex(body.threadId));
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
  if (AUTH_REQUIRED) console.log(`Access code: ${DEV_ANY_CODE ? "any non-empty code accepted for testing" : ACCESS_TOKEN}`);
  console.log(
    `Mode:   ${ALLOW_WRITE ? "write enabled" : "read-only"}${
      AUTH_REQUIRED ? (DEV_ANY_CODE ? " · dev any-code" : " · token protected") : " · auth disabled"
    }`
  );
  console.log(`Data:   ${CODEX_HOME}`);
  console.log("");
  qrcode.generate(primaryUrl, { small: true });
});
