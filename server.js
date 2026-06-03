#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
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
  --password <password>  Friendly access code. Default: generated 6-digit code per launch
  --token <token>        Alias for --password
  --readonly             Disable sending messages to Codex Desktop
  --no-auth              Disable access-code guard
  --codex-home <path>    Codex data directory. Default: ~/.codex
  --ipc-socket <path>    Codex Desktop IPC socket override
  -h, --help             Show this help

Examples:
  codex-lan-companion
  codex-lan-companion --readonly
  codex-lan-companion --port 8790 --password home-only
`);
}

const cli = parseCliArgs(process.argv.slice(2));
if (cli.help) {
  printHelp();
  process.exit(cli.invalid ? 1 : 0);
}

const INITIAL_CODEX_HOME = cli.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const CODEX_HOME_FIXED = Boolean(cli.codexHome || process.env.CODEX_LAN_FIXED_CODEX_HOME === "1");
const HOST = cli.host || process.env.HOST || "0.0.0.0";
const PORT = Number(cli.port || process.env.PORT || 8787);
let AUTH_REQUIRED = !cli.noAuth && process.env.CODEX_LAN_NO_AUTH !== "1";
const ACCESS_TOKEN = cli.password || cli.token || process.env.CODEX_LAN_PASSWORD || process.env.CODEX_LAN_TOKEN || String(randomInt(100000, 1000000));
const ALLOW_WRITE = !cli.readonly && process.env.CODEX_LAN_READONLY !== "1";
const CODEX_IPC_SOCKET =
  cli.ipcSocket ||
  process.env.CODEX_IPC_SOCKET ||
  (process.platform === "win32"
    ? String.raw`\\.\pipe\codex-ipc`
    : path.join(os.tmpdir(), "codex-ipc", typeof process.getuid === "function" ? `ipc-${process.getuid()}.sock` : "ipc.sock"));
const CODEX_CLI = process.env.CODEX_CLI || (existsSync("/Applications/Codex.app/Contents/Resources/codex") ? "/Applications/Codex.app/Contents/Resources/codex" : "codex");
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_SEND_IMAGES = 4;
const MAX_SEND_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_SEND_BODY_BYTES = 32 * 1024 * 1024;
const MIN_SEND_IMAGE_BYTES = 512;
const MIN_SEND_IMAGE_EDGE = 16;
const MAX_SEND_IMAGE_EDGE = 4096;
const MAX_SEND_IMAGE_PIXELS = 12_000_000;
const SUPPORTED_SEND_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ACTIVE_TURN_STALE_MS = 10 * 60 * 1000;
const ACTIVE_STATUS_CACHE_MS = 5000;
const IPC_VERSION_BY_METHOD = {
  "thread-follower-start-turn": 1,
  "thread-follower-interrupt-turn": 1,
  "thread-follower-command-approval-decision": 1,
  "thread-follower-file-approval-decision": 1,
  "thread-follower-permissions-request-approval-response": 1
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const messageCache = new Map();
const recentNotices = [];
let codexIpcClient = null;
let accountCache = null;
let threadAccountCache = null;
let sqliteQueue = Promise.resolve();
let codexHomeState = {
  home: path.resolve(INITIAL_CODEX_HOME),
  version: 1,
  source: "startup",
  fixed: CODEX_HOME_FIXED,
  signature: "",
  checkedAt: 0,
  candidateCheckedAt: 0,
  changedAt: new Date().toISOString()
};

function rawDebugEventsLimit(value = 80) {
  const limit = Number(value);
  if (!Number.isFinite(limit)) return 80;
  return Math.max(1, Math.min(300, Math.floor(limit)));
}

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
  return token === ACCESS_TOKEN;
}

function requireAuthorized(req, res, url) {
  if (isAuthorized(req, url)) return true;
  sendJson(res, 401, { error: "Unauthorized", authRequired: true });
  return false;
}

function loginUrlFor(baseUrl) {
  if (!AUTH_REQUIRED) return baseUrl;
  const url = new URL(baseUrl);
  url.searchParams.set("login", ACCESS_TOKEN);
  return url.toString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSqliteLocked(error) {
  return String(error?.message || error || "").toLowerCase().includes("database is locked");
}

function codexPaths(home = codexHomeState.home) {
  const root = path.resolve(home || INITIAL_CODEX_HOME);
  return {
    home: root,
    stateDb: path.join(root, "state_5.sqlite"),
    logsDb: path.join(root, "logs_2.sqlite"),
    sessionIndex: path.join(root, "session_index.jsonl"),
    authFile: path.join(root, "auth.json")
  };
}

async function findPluginManifests(dir, depth = 0) {
  if (depth > 6) return [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const manifests = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".codex-plugin") {
        const manifestPath = path.join(entryPath, "plugin.json");
        if (existsSync(manifestPath)) manifests.push(manifestPath);
      } else {
        manifests.push(...(await findPluginManifests(entryPath, depth + 1)));
      }
    }
  }
  return manifests;
}

async function findSkillFiles(dir, depth = 0) {
  if (depth > 8) return [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === "SKILL.md") {
      files.push(entryPath);
    } else if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
      files.push(...(await findSkillFiles(entryPath, depth + 1)));
    }
  }
  return files;
}

function pluginMarketplaceFromManifest(manifestPath, cacheRoot) {
  const relative = path.relative(cacheRoot, manifestPath);
  const [marketplace] = relative.split(path.sep);
  return marketplace && !marketplace.startsWith("..") ? marketplace : "";
}

function compactPluginDescription(value) {
  const firstLine = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "";
  return firstLine.length > 180 ? `${firstLine.slice(0, 177)}...` : firstLine;
}

function parseSkillMetadata(raw, fallbackName) {
  const text = String(raw || "");
  const frontmatter = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const meta = {};
  if (frontmatter) {
    for (const line of frontmatter[1].split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!match) continue;
      const value = match[2].trim().replace(/^["']|["']$/g, "");
      meta[match[1]] = value;
    }
  }
  const body = frontmatter ? text.slice(frontmatter[0].length) : text;
  const description =
    meta.description ||
    body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#")) ||
    "";
  return {
    name: String(meta.name || fallbackName || "").trim(),
    description: compactPluginDescription(description)
  };
}

function skillSourceInfo(skillPath, home) {
  const skillsRoot = path.join(home, "skills");
  const pluginCacheRoot = path.join(home, "plugins", "cache");
  const relativeLocal = path.relative(skillsRoot, skillPath);
  if (relativeLocal && !relativeLocal.startsWith("..") && !path.isAbsolute(relativeLocal)) {
    const [scope] = relativeLocal.split(path.sep);
    return {
      key: scope === ".system" ? "system" : "local",
      label: scope === ".system" ? "System" : "Local"
    };
  }
  const relativePlugin = path.relative(pluginCacheRoot, skillPath);
  if (relativePlugin && !relativePlugin.startsWith("..") && !path.isAbsolute(relativePlugin)) {
    const [marketplace, pluginName] = relativePlugin.split(path.sep);
    return {
      key: `plugin:${marketplace}:${pluginName}`,
      label: [marketplace, pluginName].filter(Boolean).join("/")
    };
  }
  return { key: "unknown", label: "Unknown" };
}

function mimeTypeForAsset(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "";
}

async function readPluginIconDataUrl(manifest, manifestPath) {
  const pluginInterface = manifest.interface && typeof manifest.interface === "object" ? manifest.interface : {};
  const iconValue = String(
    manifest.composerIcon ||
      manifest.icon ||
      manifest.logo ||
      pluginInterface.composerIcon ||
      pluginInterface.icon ||
      pluginInterface.logo ||
      ""
  ).trim();
  if (!iconValue || /^https?:\/\//i.test(iconValue) || iconValue.startsWith("data:")) return "";
  const pluginRoot = path.dirname(path.dirname(manifestPath));
  const iconPath = path.resolve(pluginRoot, iconValue);
  if (!iconPath.startsWith(pluginRoot + path.sep)) return "";
  const mimeType = mimeTypeForAsset(iconPath);
  if (!mimeType) return "";
  try {
    const stat = await fs.stat(iconPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 200 * 1024) return "";
    const data = await fs.readFile(iconPath);
    return `data:${mimeType};base64,${data.toString("base64")}`;
  } catch {
    return "";
  }
}

async function getPlugins() {
  const homeState = await refreshCodexHomeContext({ source: "plugins" });
  const cacheRoot = path.join(homeState.home, "plugins", "cache");
  const manifests = await findPluginManifests(cacheRoot);
  const byUri = new Map();
  for (const manifestPath of manifests) {
    try {
      const raw = await fs.readFile(manifestPath, "utf8");
      const manifest = JSON.parse(raw);
      const name = String(manifest.name || "").trim();
      const marketplace = pluginMarketplaceFromManifest(manifestPath, cacheRoot);
      if (!name || !marketplace) continue;
      const pluginInterface = manifest.interface && typeof manifest.interface === "object" ? manifest.interface : {};
      const displayName = String(pluginInterface.displayName || manifest.displayName || manifest.display_name || manifest.title || name).trim();
      const description = compactPluginDescription(
        pluginInterface.shortDescription ||
          pluginInterface.short_description ||
          manifest.shortDescription ||
          manifest.short_description ||
          manifest.description ||
          pluginInterface.longDescription ||
          ""
      );
      const uri = `plugin://${name}@${marketplace}`;
      const iconDataUrl = await readPluginIconDataUrl(manifest, manifestPath);
      byUri.set(uri, {
        name,
        displayName,
        description,
        marketplace,
        uri,
        iconDataUrl
      });
    } catch {
      // Ignore stale or partially installed plugin cache entries.
    }
  }
  const plugins = [...byUri.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
  return {
    plugins,
    codexHome: homeState.home,
    codexHomeVersion: homeState.version
  };
}

async function getSkills() {
  const homeState = await refreshCodexHomeContext({ source: "skills" });
  const roots = [path.join(homeState.home, "skills"), path.join(homeState.home, "plugins", "cache")];
  const files = [];
  for (const root of roots) files.push(...(await findSkillFiles(root)));
  const byUri = new Map();
  for (const skillPath of files) {
    try {
      const raw = await fs.readFile(skillPath, "utf8");
      const fallbackName = path.basename(path.dirname(skillPath));
      const metadata = parseSkillMetadata(raw, fallbackName);
      if (!metadata.name) continue;
      const source = skillSourceInfo(skillPath, homeState.home);
      const uri = `skill://${encodeURIComponent(metadata.name)}@${encodeURIComponent(source.key)}`;
      byUri.set(uri, {
        name: metadata.name,
        displayName: metadata.name,
        description: metadata.description,
        source: source.label,
        uri
      });
    } catch {
      // Ignore stale or partially installed skill entries.
    }
  }
  const skills = [...byUri.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
  return {
    skills,
    codexHome: homeState.home,
    codexHomeVersion: homeState.version
  };
}

function clearHomeScopedCaches() {
  accountCache = null;
  threadAccountCache = null;
  messageCache.clear();
  recentNotices.splice(0, recentNotices.length);
}

function normalizeCandidateHome(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const expanded = text.startsWith("~/") ? path.join(os.homedir(), text.slice(2)) : text;
  const normalized = path.resolve(expanded);
  const parts = normalized.split(path.sep);
  const codexIndex = parts.lastIndexOf(".codex");
  if (codexIndex >= 0) return parts.slice(0, codexIndex + 1).join(path.sep) || path.sep;
  if (["state_5.sqlite", "session_index.jsonl", "auth.json"].includes(path.basename(normalized))) return path.dirname(normalized);
  return normalized;
}

function isLikelyCodexHome(home) {
  if (!home || !existsSync(home)) return false;
  const paths = codexPaths(home);
  return existsSync(paths.stateDb) || existsSync(paths.sessionIndex) || existsSync(paths.authFile) || existsSync(path.join(paths.home, "sessions"));
}

function applyCodexHomeCandidate(candidate, source = "unknown") {
  if (codexHomeState.fixed) return false;
  const home = normalizeCandidateHome(candidate);
  if (!isLikelyCodexHome(home)) return false;
  if (home === codexHomeState.home) return false;
  codexHomeState = {
    ...codexHomeState,
    home,
    version: codexHomeState.version + 1,
    source,
    signature: "",
    checkedAt: 0,
    changedAt: new Date().toISOString()
  };
  clearHomeScopedCaches();
  console.log(`Codex home changed: ${home} (${source})`);
  return true;
}

function extractCodexHomeCandidates(value, depth = 0, seen = new Set(), keyHint = "") {
  if (value == null || depth > 8) return [];
  if (typeof value === "string") {
    const hint = String(keyHint || "").toLowerCase();
    const looksLikeHomeKey = /codex[_-]?home|codexhome|data[_-]?dir|data[_-]?directory/.test(hint);
    const looksLikeCodexPath = value.includes(`${path.sep}.codex`) || value.includes("/.codex") || value.includes("\\.codex");
    if (looksLikeHomeKey || looksLikeCodexPath || ["state_5.sqlite", "session_index.jsonl", "auth.json"].some((name) => value.includes(name))) {
      return [normalizeCandidateHome(value)];
    }
    return [];
  }
  if (typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  const candidates = [];
  if (Array.isArray(value)) {
    for (const item of value) candidates.push(...extractCodexHomeCandidates(item, depth + 1, seen, keyHint));
    return candidates;
  }
  for (const [key, child] of Object.entries(value)) {
    candidates.push(...extractCodexHomeCandidates(child, depth + 1, seen, key));
  }
  return candidates;
}

function maybeUpdateCodexHomeFromMessage(message) {
  for (const candidate of extractCodexHomeCandidates(message)) {
    if (applyCodexHomeCandidate(candidate, "desktop-ipc")) return true;
  }
  return false;
}

async function fileSignature(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return `${filePath}:${stat.size}:${Math.round(stat.mtimeMs)}`;
  } catch {
    return `${filePath}:missing`;
  }
}

async function fileMtimeMs(filePath) {
  try {
    return (await fs.stat(filePath)).mtimeMs;
  } catch {
    return 0;
  }
}

async function discoverCodexHomeCandidates() {
  const candidates = new Set([
    INITIAL_CODEX_HOME,
    process.env.CODEX_HOME,
    path.join(os.homedir(), ".codex"),
    ...(process.env.CODEX_LAN_CODEX_HOME_CANDIDATES || "").split(path.delimiter)
  ]);
  try {
    for (const entry of await fs.readdir(os.homedir(), { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith(".codex")) {
        candidates.add(path.join(os.homedir(), entry.name));
      }
    }
  } catch {
    // Candidate discovery is best-effort; IPC is the preferred signal.
  }
  const appSupport = path.join(os.homedir(), "Library", "Application Support");
  try {
    for (const entry of await fs.readdir(appSupport, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.toLowerCase().includes("codex")) {
        candidates.add(path.join(appSupport, entry.name));
      }
    }
  } catch {
    // Ignore unavailable platform-specific directories.
  }
  return [...candidates].map(normalizeCandidateHome).filter((candidate) => candidate && isLikelyCodexHome(candidate));
}

async function maybeDiscoverNewCodexHome(now) {
  if (codexHomeState.fixed || now - codexHomeState.candidateCheckedAt < 10000) return false;
  codexHomeState = { ...codexHomeState, candidateCheckedAt: now };
  const currentAuthMtime = await fileMtimeMs(codexPaths().authFile);
  let best = null;
  for (const candidate of await discoverCodexHomeCandidates()) {
    if (candidate === codexHomeState.home) continue;
    const authMtime = await fileMtimeMs(codexPaths(candidate).authFile);
    if (authMtime > currentAuthMtime && (!best || authMtime > best.authMtime)) {
      best = { home: candidate, authMtime };
    }
  }
  return best ? applyCodexHomeCandidate(best.home, "poll-discovery") : false;
}

async function codexHomeSignature(home = codexHomeState.home) {
  const paths = codexPaths(home);
  return fileSignature(paths.authFile);
}

async function refreshCodexHomeContext({ force = false, source = "poll" } = {}) {
  maybeUpdateCodexHomeFromMessage(codexIpcClient?.events?.at(-1)?.message);
  const now = Date.now();
  await maybeDiscoverNewCodexHome(now);
  if (!force && now - codexHomeState.checkedAt < 2000) return codexHomeState;
  const signature = await codexHomeSignature();
  if (codexHomeState.signature && signature !== codexHomeState.signature) {
    codexHomeState = {
      ...codexHomeState,
      version: codexHomeState.version + 1,
      source,
      signature,
      checkedAt: now,
      changedAt: new Date().toISOString()
    };
    clearHomeScopedCaches();
  } else {
    codexHomeState = {
      ...codexHomeState,
      signature,
      checkedAt: now
    };
  }
  return codexHomeState;
}

function runSqlJsonAttempt(sql, dbPath = codexPaths().stateDb) {
  return new Promise((resolve, reject) => {
    execFile("sqlite3", ["-json", "-cmd", ".timeout 5000", dbPath, sql], { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
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

async function runSqlJsonFromDb(dbPath, sql) {
  const work = async () => {
    let lastError;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await runSqlJsonAttempt(sql, dbPath);
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

async function runSqlJson(sql) {
  const { stateDb } = codexPaths((await refreshCodexHomeContext()).home);
  return runSqlJsonFromDb(stateDb, sql);
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
    this.desktopConversationRows = new Map();
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
    this.captureEvent({
      ...message,
      direction: "incoming-response",
      method: message.method || pending.method,
      params: pending.params
    });
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
    maybeUpdateCodexHomeFromMessage(message);
    this.rememberDesktopConversation(message);
    this.events.push({
      timestamp: new Date().toISOString(),
      message
    });
    if (this.events.length > 120) this.events.splice(0, this.events.length - 120);
  }

  conversationIdFromMessage(message) {
    return (
      message?.conversationId ||
      message?.conversation_id ||
      message?.threadId ||
      message?.thread_id ||
      message?.params?.conversationId ||
      message?.params?.conversation_id ||
      message?.params?.threadId ||
      message?.params?.thread_id ||
      message?.params?.conversationState?.id ||
      ""
    );
  }

  rememberDesktopConversation(message) {
    const id = this.conversationIdFromMessage(message);
    if (!id) return;
    const timestampMs = Date.now();
    const key = String(id);
    const existing = this.desktopConversationRows.get(key) || {};
    const title = firstString(message?.params?.conversationState?.title, message?.params?.title, message?.title, existing.title);
    this.desktopConversationRows.set(key, {
      id: key,
      title: title || existing.title || "Desktop conversation",
      rolloutPath: null,
      createdAtMs: existing.createdAtMs || timestampMs,
      updatedAtMs: Math.max(existing.updatedAtMs || 0, timestampMs),
      archived: false,
      preview: existing.preview || "",
      cwd: existing.cwd || "",
      model: existing.model || "",
      source: "desktop-ipc"
    });
    if (this.desktopConversationRows.size > 80) {
      const oldest = [...this.desktopConversationRows.values()].sort((a, b) => (a.updatedAtMs || 0) - (b.updatedAtMs || 0))[0];
      if (oldest?.id) this.desktopConversationRows.delete(oldest.id);
    }
  }

  rawEvents(limit = 80) {
    return this.events.slice(-rawDebugEventsLimit(limit)).map((event, index) => ({
      index,
      timestamp: event.timestamp,
      type: event.message?.type || "",
      method: event.message?.method || "",
      resultType: event.message?.resultType || "",
      requestId: event.message?.requestId || "",
      conversationId:
        event.message?.conversationId ||
        event.message?.conversation_id ||
        event.message?.threadId ||
        event.message?.thread_id ||
        event.message?.params?.conversationId ||
        event.message?.params?.conversation_id ||
        event.message?.params?.threadId ||
        event.message?.params?.thread_id ||
        "",
      summary: compact(redactLargePayloads(event.message), 3000)
    }));
  }

  getRecentConversationIds(maxAgeMs = 15 * 60 * 1000) {
    const cutoff = Date.now() - maxAgeMs;
    const ids = new Set();
    for (const event of this.events) {
      if (Date.parse(event.timestamp) < cutoff) continue;
      const id = this.conversationIdFromMessage(event.message);
      if (id) ids.add(String(id));
    }
    return ids;
  }

  getDesktopConversationIds() {
    return new Set(this.getDesktopConversationRows().map((row) => row.id));
  }

  getDesktopConversationRows() {
    return [...this.desktopConversationRows.values()].sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
  }

  getRecentConversationRows(maxAgeMs = 15 * 60 * 1000) {
    const cutoff = Date.now() - maxAgeMs;
    const rowsById = new Map();
    for (const event of this.events) {
      const timestampMs = Date.parse(event.timestamp);
      if (timestampMs < cutoff) continue;
      const id = this.conversationIdFromMessage(event.message);
      if (!id) continue;
      const existing = rowsById.get(String(id)) || {};
      const title = firstString(
        event.message?.params?.conversationState?.title,
        event.message?.params?.title,
        event.message?.title,
        existing.title
      );
      rowsById.set(String(id), {
        id: String(id),
        title: title || "Desktop conversation",
        rolloutPath: null,
        createdAtMs: existing.createdAtMs || timestampMs,
        updatedAtMs: Math.max(existing.updatedAtMs || 0, timestampMs),
        archived: false,
        preview: existing.preview || "",
        cwd: existing.cwd || "",
        model: existing.model || "",
        source: "desktop-ipc"
      });
    }
    return [...rowsById.values()].sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
  }

  hasConversationEvent(threadId, sinceMs = 0) {
    const selectedThreadId = String(threadId || "");
    if (!selectedThreadId) return false;
    return this.events.some((event) => {
      if (sinceMs && Date.parse(event.timestamp) < sinceMs) return false;
      const id =
        event.message?.conversationId ||
        event.message?.conversation_id ||
        event.message?.threadId ||
        event.message?.thread_id ||
        event.message?.params?.conversationId ||
        event.message?.params?.conversation_id ||
        event.message?.params?.threadId ||
        event.message?.params?.thread_id ||
        "";
      return String(id) === selectedThreadId;
    });
  }

  async waitForConversationEvent(threadId, { sinceMs = 0, timeoutMs = 5000 } = {}) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (this.hasConversationEvent(threadId, sinceMs)) return true;
      await sleep(150);
    }
    return false;
  }

  getRecentInteractionMessages(threadId) {
    const selectedThreadId = String(threadId || "");
    const cutoff = Date.now() - 10 * 60 * 1000;
    return this.events.flatMap((event, index) => {
        if (Date.parse(event.timestamp) < cutoff) return [];
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
        if (messageThreadId && String(messageThreadId) !== selectedThreadId) return [];
        const meta = {
          source: "desktop-ipc",
          turnId: event.message?.turnId || event.message?.params?.turnId || null
        };
        const payloads = interactionPayloadsFromIpcMessage(event.message);
        if (!payloads.length && isInteractionPayload(payload)) payloads.push(payload);
        return payloads
          .map((interactionPayload, payloadIndex) => {
            const interaction = messageFromInteractionEvent(event.timestamp, interactionPayload, meta);
            if (!hasDisplayableMessageContent(interaction)) return null;
            return {
              ...interaction,
              lineNumber: 1000000 + index * 20 + payloadIndex,
              requiresDesktopAction: true
            };
          })
          .filter(Boolean);
      })
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
      if (params?.hostId) {
        message.hostId = params.hostId;
      }
      if (includeVersion) {
        message.version = IPC_VERSION_BY_METHOD[method] ?? 0;
      }
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.captureEvent({
          type: "response",
          direction: "timeout",
          requestId,
          method,
          params,
          resultType: "error",
          error: `${method} timed out`
        });
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer, method, params });
      this.captureEvent({
        ...message,
        direction: "outgoing-request"
      });
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
      hostId: "local",
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

  async refreshRecentConversations(hostId = "local") {
    await this.ensureReady();
    return this.request("refresh-recent-conversations-for-host", { hostId }, { timeoutMs: 8000 });
  }

  async setActiveConversation(threadId, active = true, hostId = "local") {
    await this.ensureReady();
    return this.request(
      "set-active-conversation",
      {
        hostId,
        conversationId: threadId,
        active
      },
      { timeoutMs: 8000 }
    );
  }

  async startConversation(text, images = []) {
    await this.ensureReady();
    const input = [];
    if (text) input.push({ type: "text", text, text_elements: [] });
    for (const image of images) {
      input.push({
        type: "image",
        url: `data:${image.mimeType};base64,${image.data}`
      });
    }
    return this.request(
      "start-conversation",
      {
        hostId: "local",
        input,
        attachments: [],
        cwd: process.cwd(),
        workspaceRoots: [process.cwd()],
        collaborationMode: null,
        threadSource: "user",
        approvalsReviewer: "user"
      },
      { timeoutMs: 60000 }
    );
  }
}

function getCodexIpcClient() {
  if (!codexIpcClient) codexIpcClient = new DesktopCodexIpcClient();
  return codexIpcClient;
}

function keepIpcWarm() {
  if (!ALLOW_WRITE) return;
  getCodexIpcClient()
    .ensureReady()
    .catch(() => {
      // The health endpoint should not fail just because Codex Desktop is closed.
    });
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
  const { authFile } = codexPaths((await refreshCodexHomeContext()).home);
  if (!existsSync(authFile)) return {};
  const raw = await fs.readFile(authFile, "utf8");
  const auth = JSON.parse(raw);
  const idClaims = decodeJwtPayload(auth.tokens?.id_token) || {};
  const accessClaims = decodeJwtPayload(auth.tokens?.access_token) || {};
  const planClaim =
    idClaims["https://api.openai.com/auth.chatgpt_plan_type"] ||
    accessClaims["https://api.openai.com/auth.chatgpt_plan_type"];
  return {
    name: idClaims.name || accessClaims.name || "",
    email: idClaims.email || accessClaims.email || "",
    sub: idClaims.sub || accessClaims.sub || "",
    authMode: auth.auth_mode || "",
    tokenPlan: planClaim || ""
  };
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function extractTelemetryAccount(body) {
  const text = String(body || "");
  const email = text.match(/\buser\.email="([^"]+)"/)?.[1] || "";
  const accountId = text.match(/\buser\.account_id="([^"]+)"/)?.[1] || "";
  if (!email && !accountId) return null;
  return {
    email: normalizeEmail(email),
    accountId: String(accountId || "").trim()
  };
}

async function readThreadAccountFilter(threadIds = []) {
  const homeState = await refreshCodexHomeContext();
  const profile = await readAuthProfile();
  const currentEmail = normalizeEmail(profile.email);
  if (!currentEmail) return null;

  const { logsDb } = codexPaths(homeState.home);
  if (!existsSync(logsDb)) return null;

  const requestedThreadIds = [...new Set(threadIds.map((id) => String(id || "").trim()).filter(Boolean))];
  const idsKey = requestedThreadIds.length ? requestedThreadIds.slice().sort().join(",") : "global";
  const cacheKey = `${homeState.home}:${homeState.version}:${currentEmail}:${idsKey}`;
  const now = Date.now();
  if (threadAccountCache?.key === cacheKey && now - threadAccountCache.cachedAt < 5000) {
    return threadAccountCache.value;
  }

  const idList = requestedThreadIds.map((id) => `'${sqlString(id)}'`).join(",");
  const rowsSql = requestedThreadIds.length
    ? `
      SELECT logs.thread_id AS threadId, logs.feedback_log_body AS body
      FROM logs
      JOIN (
        SELECT thread_id, MAX(id) AS latestId
        FROM logs
        WHERE thread_id IN (${idList})
          AND feedback_log_body LIKE '%user.email="%'
        GROUP BY thread_id
      ) latest
        ON logs.thread_id = latest.thread_id
       AND logs.id = latest.latestId
      ORDER BY logs.id DESC;
    `
    : `
      SELECT thread_id AS threadId, feedback_log_body AS body
      FROM logs
      WHERE thread_id IS NOT NULL
        AND feedback_log_body LIKE '%user.email="%'
      ORDER BY id DESC
      LIMIT 12000;
    `;
  const rows = await runSqlJsonFromDb(logsDb, rowsSql);
  const latestByThread = new Map();
  for (const row of rows) {
    const threadId = String(row.threadId || "").trim();
    if (!threadId || latestByThread.has(threadId)) continue;
    const account = extractTelemetryAccount(row.body);
    if (account?.email) latestByThread.set(threadId, account);
  }

  const knownEmails = new Set([...latestByThread.values()].map((account) => account.email).filter(Boolean));
  if (!knownEmails.size) return null;

  const allowedThreadIds = new Set(
    [...latestByThread.entries()].filter(([, account]) => account.email === currentEmail).map(([threadId]) => threadId)
  );
  const value = {
    currentEmail,
    knownEmails,
    allowedThreadIds,
    mappedThreadIds: new Set(latestByThread.keys()),
    active: knownEmails.has(currentEmail) || allowedThreadIds.size > 0
  };
  threadAccountCache = { key: cacheKey, cachedAt: now, value };
  return value;
}

async function filterRowsForCurrentAccount(rows, idSelector = (row) => row.id, preserveIds = []) {
  const rowIds = rows.map((row) => idSelector(row));
  const filter = await readThreadAccountFilter(rowIds);
  if (!filter?.active) return { rows, accountFiltered: false, accountEmail: filter?.currentEmail || "" };
  const desktopVisibleIds = codexIpcClient?.getDesktopConversationIds?.() || codexIpcClient?.getRecentConversationIds?.() || new Set();
  const preserved = new Set(preserveIds.map((id) => String(id || "").trim()).filter(Boolean));
  return {
    rows: rows.filter((row) => {
      const id = String(idSelector(row) || "");
      return filter.allowedThreadIds.has(id) || desktopVisibleIds.has(id) || preserved.has(id);
    }),
    accountFiltered: true,
    accountEmail: filter.currentEmail
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
  const normalized = {
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
  const hasUsefulUsage =
    Boolean(normalized.planType) ||
    Boolean(normalized.primary) ||
    Boolean(normalized.secondary) ||
    Boolean(normalized.credits?.hasCredits) ||
    Boolean(normalized.credits?.unlimited);
  return hasUsefulUsage ? normalized : null;
}

async function latestRolloutPaths(limit = 8) {
  const { stateDb } = codexPaths((await refreshCodexHomeContext()).home);
  if (!existsSync(stateDb)) return [];
  const rows = await runSqlJson(`
    SELECT id, rollout_path AS rolloutPath
    FROM threads
    WHERE rollout_path IS NOT NULL
    ORDER BY updated_at_ms DESC, updated_at DESC
    LIMIT 200;
  `);
  const filtered = await filterRowsForCurrentAccount(rows);
  return filtered.rows
    .slice(0, Number(limit) || 8)
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

async function readSessionIndexTitleMap() {
  const { sessionIndex } = codexPaths((await refreshCodexHomeContext()).home);
  if (!existsSync(sessionIndex)) return new Map();
  const content = await fs.readFile(sessionIndex, "utf8");
  const titles = new Map();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const id = String(row.id || "");
      const title = String(row.thread_name || row.title || "").trim();
      if (id && title) titles.set(id, title);
    } catch {
      // Ignore malformed historical index lines.
    }
  }
  return titles;
}

function displayThreadTitle(row, sessionIndexTitles) {
  const indexedTitle = sessionIndexTitles?.get(String(row.id || ""));
  return indexedTitle || row.title || "Untitled";
}

async function getAccountInfo() {
  const now = Date.now();
  if (accountCache && now - accountCache.cachedAt < 15000) return accountCache.value;

  const profile = await readAuthProfile();
  const usage = await readLatestRateLimits();
  const plan = usage?.planType || profile.tokenPlan || "";
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

async function getThreads({ preserveIds = [] } = {}) {
  const { stateDb, sessionIndex } = codexPaths((await refreshCodexHomeContext()).home);
  const appendRecentIpcRows = (rows) => {
    const seen = new Set(rows.map((row) => String(row.id || "")));
    const recentRows = codexIpcClient?.getDesktopConversationRows?.() || codexIpcClient?.getRecentConversationRows?.() || [];
    return [...rows, ...recentRows.filter((row) => !seen.has(String(row.id || "")))].sort((a, b) => {
      const updatedA = Number(a.updatedAtMs) || 0;
      const updatedB = Number(b.updatedAtMs) || 0;
      return updatedB - updatedA;
    });
  };
  if (existsSync(stateDb)) {
    const sessionIndexTitles = await readSessionIndexTitleMap();
    const rows = await runSqlJson(`
      SELECT id, title, rollout_path AS rolloutPath, created_at_ms AS createdAtMs,
             updated_at_ms AS updatedAtMs, archived, preview, cwd, model
      FROM threads
      ORDER BY updated_at_ms DESC, updated_at DESC
      LIMIT 500;
    `);
    const filtered = await filterRowsForCurrentAccount(rows, (row) => row.id, preserveIds);
    return appendRecentIpcRows(filtered.rows.map((row) => ({
      id: row.id,
      title: displayThreadTitle(row, sessionIndexTitles),
      rolloutPath: row.rolloutPath,
      createdAtMs: row.createdAtMs,
      updatedAtMs: row.updatedAtMs,
      archived: Boolean(row.archived),
      preview: row.preview || "",
      cwd: row.cwd || "",
      model: row.model || ""
    })));
  }

  const content = await fs.readFile(sessionIndex, "utf8");
  const rows = content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .reverse();
  const filtered = await filterRowsForCurrentAccount(rows, (row) => row.id, preserveIds);
  return appendRecentIpcRows(filtered.rows.map((row) => ({
      id: row.id,
      title: row.thread_name || "Untitled",
      rolloutPath: null,
      updatedAtMs: Date.parse(row.updated_at)
    })));
}

async function findThread(id) {
  const filtered = await filterRowsForCurrentAccount([{ id }], (row) => row.id, [id]);
  const recentIpcThread =
    (codexIpcClient?.getDesktopConversationRows?.() || codexIpcClient?.getRecentConversationRows?.() || []).find((row) => row.id === String(id)) ||
    null;
  if (filtered.accountFiltered && !filtered.rows.length && !recentIpcThread) return null;
  const sessionIndexTitles = await readSessionIndexTitleMap();
  const rows = await runSqlJson(`
    SELECT id, title, rollout_path AS rolloutPath, updated_at_ms AS updatedAtMs
    FROM threads
    WHERE id = '${sqlString(id)}'
    LIMIT 1;
  `);
  if (!rows[0]) {
    return recentIpcThread;
  }
  return { ...rows[0], title: displayThreadTitle(rows[0], sessionIndexTitles) };
}

function resolveRolloutPath(rolloutPath) {
  if (!rolloutPath) return null;
  const { home } = codexPaths();
  const absolute = path.isAbsolute(rolloutPath) ? rolloutPath : path.join(home, rolloutPath);
  const normalized = path.normalize(absolute);
  if (!normalized.startsWith(path.normalize(home + path.sep))) {
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

function parseMaybeJsonObject(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
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
  if (isApprovalDecisionPayload(payload)) return false;
  const toolArguments = parseMaybeJsonObject(payload?.arguments);
  const params = payload?.params || payload?.payload || {};
  if (
    toolArguments?.sandbox_permissions === "require_escalated" ||
    params?.sandbox_permissions === "require_escalated" ||
    params?.sandboxPermissions === "require_escalated" ||
    payload?.sandbox_permissions === "require_escalated" ||
    payload?.sandboxPermissions === "require_escalated"
  ) {
    return true;
  }
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

function isApprovalDecisionPayload(payload) {
  const method = String(payload?.method || payload?.name || payload?.type || "").toLowerCase();
  const params = payload?.params || payload?.payload || {};
  return (
    payload?.direction === "outgoing-request" ||
    method.includes("approval-decision") ||
    method.includes("approval_decision") ||
    method.includes("approval-response") ||
    method.includes("approval_response") ||
    ((params?.decision || params?.response) && method.includes("approval"))
  );
}

function interactionTitle(payload) {
  const toolArguments = parseMaybeJsonObject(payload?.arguments);
  if (toolArguments?.sandbox_permissions === "require_escalated") return "Command approval requested";
  const type = String(payload?.type || payload?.method || payload?.name || payload?.kind || "").toLowerCase();
  if (type.includes("command") || type.includes("exec")) return "Command approval requested";
  if (type.includes("apply_patch")) return "Patch approval requested";
  if (type.includes("file")) return "File approval requested";
  if (type.includes("permission")) return "Permission requested";
  if (type.includes("elicitation")) return "Additional information requested";
  if (type.includes("user_input")) return "User input requested";
  if (type.includes("terminal")) return "Terminal interaction requested";
  if (type.includes("tool")) return "Tool interaction requested";
  return "Codex interaction requested";
}

function approvalKindFromPayload(payload) {
  const toolArguments = parseMaybeJsonObject(payload?.arguments);
  const params = payload?.params || payload?.payload || {};
  const type = String(payload?.type || payload?.method || payload?.name || payload?.kind || "").toLowerCase();
  if (
    toolArguments?.sandbox_permissions === "require_escalated" ||
    params?.sandbox_permissions === "require_escalated" ||
    params?.sandboxPermissions === "require_escalated" ||
    payload?.sandbox_permissions === "require_escalated" ||
    payload?.sandboxPermissions === "require_escalated"
  ) {
    return "command";
  }
  if (type.includes("apply_patch") || type.includes("filechange") || type.includes("file_change") || type.includes("file")) return "file";
  if (type.includes("permission")) return "permission";
  if (type.includes("command") || type.includes("exec") || type.includes("terminal")) return "command";
  return "";
}

function interactionContent(payload) {
  const toolArguments = parseMaybeJsonObject(payload?.arguments);
  const params = payload?.params || payload?.payload || toolArguments || {};
  const request = payload?.request || params?.request || {};
  const toolCall = payload?.tool_call || params?.tool_call || params?.toolCall || {};
  const command = firstString(
    payload?.command,
    params?.command,
    toolArguments?.cmd,
    toolArguments?.command,
    request?.command,
    payload?.cmd,
    params?.cmd,
    payload?.program,
    params?.program,
    payload?.execve,
    params?.execve,
    toolCall?.command,
    toolCall?.name
  );
  const pathValue = firstString(
    payload?.path,
    params?.path,
    request?.path,
    payload?.file_path,
    params?.file_path,
    request?.file_path,
    payload?.grant_root,
    params?.grant_root
  );
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
    toolArguments?.justification,
    params?.justification,
    request?.reason
  );
  const choices = Array.isArray(payload?.available_decisions)
    ? payload.available_decisions
    : Array.isArray(params?.available_decisions)
      ? params.available_decisions
      : Array.isArray(payload?.options)
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
    firstString(toolArguments?.workdir, params?.workdir, params?.cwd) ? `Workdir: ${firstString(toolArguments?.workdir, params?.workdir, params?.cwd)}` : "",
    choices.length ? `Options: ${choices.map((option) => firstString(option?.label, option?.title, option?.id, option)).filter(Boolean).join(", ")}` : ""
  ].filter(Boolean);
  if (lines.length) return lines.join("\n\n");
  return compact(redactLargePayloads(payload), 2400);
}

function interactionRequestId(payload) {
  const params = payload?.params || payload?.payload || {};
  const request = payload?.request || params?.request || {};
  return (
    payload?.request_id ||
    payload?.requestId ||
    payload?.approval_id ||
    payload?.approvalId ||
    payload?.id ||
    payload?.call_id ||
    payload?.callId ||
    params?.request_id ||
    params?.requestId ||
    params?.approval_id ||
    params?.approvalId ||
    params?.id ||
    request?.request_id ||
    request?.requestId ||
    request?.approval_id ||
    request?.approvalId ||
    request?.id ||
    null
  );
}

function collectInteractionPayloads(value, depth = 0, seen = new Set(), results = []) {
  if (!value || typeof value !== "object" || depth > 12 || seen.has(value)) return results;
  seen.add(value);
  if (isInteractionPayload(value) && interactionRequestId(value)) results.push(value);
  if (Array.isArray(value)) {
    for (const item of value) collectInteractionPayloads(item, depth + 1, seen, results);
    return results;
  }
  for (const child of Object.values(value)) collectInteractionPayloads(child, depth + 1, seen, results);
  return results;
}

function interactionPayloadsFromIpcMessage(message) {
  const payloads = collectInteractionPayloads(message);
  const seen = new Set();
  const unique = payloads.filter((payload) => {
    const key = `${interactionRequestId(payload) || ""}:${payload?.method || payload?.type || payload?.name || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const bestPriority = Math.min(...unique.map(interactionPayloadPriority));
  return unique
    .filter((payload) => interactionPayloadPriority(payload) === bestPriority || bestPriority > 1)
    .sort((a, b) => interactionPayloadPriority(a) - interactionPayloadPriority(b));
}

function interactionPayloadPriority(payload) {
  const method = String(payload?.method || payload?.type || payload?.name || payload?.kind || "").toLowerCase();
  if (method.includes("requestapproval")) return 0;
  if (method.includes("approval") || method.includes("permission")) return 1;
  return 2;
}

function messageFromInteractionEvent(timestamp, payload, meta = {}) {
  if (!isInteractionPayload(payload)) return null;
  const approvalKind = approvalKindFromPayload(payload);
  return {
    role: "interaction",
    kind: payload?.type || payload?.method || payload?.name || "interaction",
    timestamp,
    ...meta,
    title: interactionTitle(payload),
    requestId: interactionRequestId(payload),
    approvalKind,
    canApprove: Boolean(approvalKind),
    content: interactionContent(payload),
    requiresDesktopAction: true
  };
}

function normalizeApprovalCommandForKey(command) {
  const text = String(command || "").trim();
  const shellMatch = text.match(/^\/bin\/(?:zsh|bash|sh)\s+-lc\s+["']([\s\S]+)["']$/);
  if (!shellMatch) return text.replace(/\s+/g, " ");
  return shellMatch[1].replace(/\\"/g, "\"").replace(/\\'/g, "'").replace(/\s+/g, " ").trim();
}

function interactionContentField(content, label) {
  const match = String(content || "").match(new RegExp(`(?:^|\\n)${label}:\\s*([^\\n]+)`, "i"));
  return match?.[1]?.trim() || "";
}

function interactionDedupeKey(message) {
  if (message?.role !== "interaction") return "";
  const prompt = interactionContentField(message.content, "Prompt");
  const command = normalizeApprovalCommandForKey(interactionContentField(message.content, "Command"));
  const workdir = interactionContentField(message.content, "Workdir");
  const pathValue = interactionContentField(message.content, "Path");
  const content = String(message.content || "").replace(/\s+/g, " ").trim();
  return [message.approvalKind || "", prompt || content, command, pathValue, workdir].join("\n");
}

function preferredInteractionMessage(existing, candidate) {
  const existingIsLive = existing?.source === "desktop-ipc";
  const candidateIsLive = candidate?.source === "desktop-ipc";
  const display = String(candidate?.content || "").length < String(existing?.content || "").length ? candidate : existing;
  const live = candidateIsLive ? candidate : existingIsLive ? existing : null;
  if (!live) return display;
  return {
    ...display,
    source: live.source,
    requestId: live.requestId || display.requestId,
    approvalKind: live.approvalKind || display.approvalKind,
    canApprove: live.canApprove || display.canApprove,
    requiresDesktopAction: Boolean(live.requiresDesktopAction || display.requiresDesktopAction),
    lineNumber: Math.min(existing.lineNumber || candidate.lineNumber || 0, candidate.lineNumber || existing.lineNumber || 0),
    timestamp: display.timestamp || live.timestamp
  };
}

function dedupeInteractionMessages(messages) {
  const byKey = new Map();
  const result = [];
  for (const message of messages) {
    const key = interactionDedupeKey(message);
    if (!key) {
      result.push(message);
      continue;
    }
    const existingIndex = byKey.get(key);
    if (existingIndex === undefined) {
      byKey.set(key, result.length);
      result.push(message);
      continue;
    }
    result[existingIndex] = preferredInteractionMessage(result[existingIndex], message);
  }
  return result;
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
  const output = String(payload?.output || "");
  if (payload?.type === "function_call_output" && /Rejected\(|rejected by user|require_escalated/i.test(output)) return true;
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
  if (payload?.type === "function_call_output" && /Rejected\(|rejected by user/i.test(String(payload?.output || ""))) return "warning";
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
  if (payload?.type === "function_call_output" && /Rejected\(|rejected by user/i.test(String(payload?.output || ""))) return "Approval dismissed";
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
  if (payload?.type === "function_call_output" && payload?.output) return String(payload.output);
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
  const nowMs = Date.now();
  const cachedAgeMs = nowMs - (cached?.cachedAtMs || 0);
  if (cached?.signature === signature && (!cached.result?.status?.thinking || cachedAgeMs < ACTIVE_STATUS_CACHE_MS)) return cached.result;

  const eventMessages = [];
  const fallbackMessages = [];
  const toolMessages = [];
  const interactionMessages = [];
  const noticeMessages = [];
  let meta = {};
  let lineNumber = 0;
  let activeTurn = null;
  let lastEntryAtMs = Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : nowMs;
  const assistantMessagesByTurn = new Map();

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    lineNumber += 1;
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const entryAtMs = Date.parse(entry.timestamp);
      if (Number.isFinite(entryAtMs)) lastEntryAtMs = entryAtMs;
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
        const messageMeta = {
          turnId: activeTurn?.turnId || null,
          turnStartedAtMs: activeTurn?.startedAtMs || null
        };
        const interaction = messageFromInteractionEvent(entry.timestamp, entry.payload, messageMeta);
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
  const activeTurnLastUpdatedAtMs = activeTurn
    ? Math.max(activeTurn.startedAtMs || 0, lastEntryAtMs || 0, Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0)
    : null;
  const activeTurnStale = Boolean(activeTurn && nowMs - activeTurnLastUpdatedAtMs > ACTIVE_TURN_STALE_MS);
  const visibleActiveTurn = activeTurnStale ? null : activeTurn;
  for (const message of interactionMessages) {
    message.requiresDesktopAction = Boolean(visibleActiveTurn && (!message.turnId || message.turnId === visibleActiveTurn.turnId));
  }
  const pendingInteractions = interactionMessages.filter((message) => message.requiresDesktopAction);
  const activeTurnWaitMs = visibleActiveTurn?.startedAtMs ? nowMs - visibleActiveTurn.startedAtMs : 0;
  const result = {
    meta,
    file: filePath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    status: {
      thinking: Boolean(visibleActiveTurn),
      turnId: visibleActiveTurn?.turnId || null,
      startedAtMs: visibleActiveTurn?.startedAtMs || null,
      interactionRequired: pendingInteractions.length > 0,
      possibleDesktopAttention: Boolean(visibleActiveTurn && pendingInteractions.length === 0 && activeTurnWaitMs > 45_000),
      staleTurn: activeTurnStale,
      staleTurnId: activeTurnStale ? activeTurn?.turnId || null : null,
      staleTurnLastUpdatedAtMs: activeTurnStale ? activeTurnLastUpdatedAtMs : null
    },
    messages: dedupeInteractionMessages([...chatMessages, ...pendingInteractions, ...noticeMessages, ...toolMessages]).sort((a, b) => {
      if (a.timestamp && b.timestamp) return String(a.timestamp).localeCompare(String(b.timestamp));
      return a.lineNumber - b.lineNumber;
    })
  };

  messageCache.set(filePath, { signature, result, cachedAtMs: nowMs });
  return result;
}

async function getMessages(id) {
  keepIpcWarm();
  const thread = await findThread(id);
  if (!thread) {
    const err = new Error("Thread not found");
    err.status = 404;
    throw err;
  }
  const ipcInteractions = codexIpcClient?.getRecentInteractionMessages(id) || [];
  const ipcNotices = codexIpcClient?.getRecentNoticeMessages(id) || [];
  const serverNotices = getRecentNoticeMessages(id);
  const liveMessages = [...ipcInteractions, ...ipcNotices, ...serverNotices];
  const rolloutPath = resolveRolloutPath(thread.rolloutPath);
  if (!rolloutPath || !existsSync(rolloutPath)) {
    return {
      thread,
      meta: {},
      file: null,
      size: 0,
      mtimeMs: 0,
      status: {
        thinking: false,
        turnId: null,
        startedAtMs: null,
        interactionRequired: ipcInteractions.some((message) => message.requiresDesktopAction),
        possibleDesktopAttention: false
      },
      messages: dedupeInteractionMessages(liveMessages).sort((a, b) => {
        if (a.timestamp && b.timestamp) return String(a.timestamp).localeCompare(String(b.timestamp));
        return a.lineNumber - b.lineNumber;
      })
    };
  }
  const parsed = await parseRollout(rolloutPath);
  if (!liveMessages.length) return { thread, ...parsed };
  return {
    thread,
    ...parsed,
    status: {
      ...parsed.status,
      interactionRequired: parsed.status?.interactionRequired || ipcInteractions.some((message) => message.requiresDesktopAction)
    },
    messages: dedupeInteractionMessages([...parsed.messages, ...liveMessages]).sort((a, b) => {
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

async function sendToCodex(text, threadId, images = [], { newThread = false } = {}) {
  await refreshCodexHomeContext({ source: "send" });
  if (!ALLOW_WRITE) {
    const err = new Error("Read-only mode is enabled. Restart without --readonly to send messages to Codex Desktop.");
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
  if (newThread) {
    if (normalizedImages.length) {
      const err = new Error("Starting a new Codex conversation with images from the web is not supported yet. Create the conversation with text first, then send images in the new thread.");
      err.status = 409;
      throw err;
    }
    const result = await startNewCodexThread(trimmed);
    if (result.threadId) {
      await notifyCodexDesktopThreadCreated(result.threadId);
    }
    return {
      ok: true,
      mode: result.source || "desktop-ipc",
      threadId: result.threadId,
      images: [],
      turnId: result.turnId,
      fallbackReason: result.fallbackReason || null,
      sent: true,
      sentAt: new Date().toISOString()
    };
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
    if (isNoOpenOwnerError(error)) {
      try {
        const openedAt = Date.now();
        await openCodexUrl(`codex://threads/${encodeURIComponent(targetThreadId)}`);
        await getCodexIpcClient().waitForConversationEvent(targetThreadId, { sinceMs: openedAt, timeoutMs: 6000 });
        await sleep(500);
        result = await getCodexIpcClient().startTurn(targetThreadId, trimmed, normalizedImages);
      } catch (retryError) {
        const retryMessage = retryError?.message ? ` Last IPC error: ${retryError.message}.` : "";
        const err = new Error(`Codex Desktop has no open owner for this thread. I tried opening the target conversation; wait for it to finish opening in Codex Desktop, then send again.${retryMessage}`);
        err.status = 409;
        recordNotice(targetThreadId, {
          severity: "error",
          title: "Send failed",
          content: err.message,
          source: "send"
        });
        throw err;
      }
    } else {
      recordNotice(targetThreadId, {
        severity: noticeSeverity(error?.ipcMessage || { type: "error", message: noticeMessage }, "error"),
        title: noticeTitle(error?.ipcMessage || { type: "error", message: noticeMessage }, "error"),
        content: noticeMessage,
        source: "send"
      });
      throw error;
    }
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

function conversationIdFromStartConversation(response) {
  const result = response?.result;
  if (typeof result === "string" && result) return result;
  return firstString(result?.conversationId, result?.threadId, result?.id, response?.conversationId, response?.threadId, response?.id);
}

function turnIdFromStartConversation(response) {
  const result = response?.result;
  return firstString(result?.turn?.id, result?.turnId, result?.turn_id, response?.turnId, response?.turn_id);
}

async function startNewCodexThread(text) {
  try {
    const response = await getCodexIpcClient().startConversation(text);
    const threadId = conversationIdFromStartConversation(response);
    if (!threadId) throw new Error(`Codex Desktop did not return a conversation id. ${compact(response, 1200)}`);
    return {
      threadId,
      turnId: turnIdFromStartConversation(response),
      source: "desktop-ipc"
    };
  } catch (error) {
    const fallback = await startNewCodexThreadViaAppServer(text);
    return {
      ...fallback,
      source: "app-server-fallback",
      fallbackReason: error.message || String(error)
    };
  }
}

function startNewCodexThreadViaAppServer(text) {
  return new Promise((resolve, reject) => {
    const { home } = codexPaths();
    const child = spawn(CODEX_CLI, ["debug", "app-server", "send-message-v2", text], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CODEX_HOME: home
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let threadId = "";
    let turnId = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      const err = new Error("Timed out starting a new Codex conversation.");
      err.status = 504;
      reject(err);
    }, 45000);

    const maybeResolve = () => {
      threadId ||= firstRegexGroup(stdout, /"thread"[\s\S]*?"id"\s*:\s*"([^"]+)"/);
      turnId ||= firstRegexGroup(stdout, /"turn"[\s\S]*?"id"\s*:\s*"([^"]+)"/);
      if (!settled && threadId && turnId) {
        settled = true;
        clearTimeout(timer);
        resolve({ threadId, turnId });
      }
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 2_000_000) stdout = stdout.slice(-1_000_000);
      maybeResolve();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      maybeResolve();
      if (settled) return;
      const detail = firstString(stderr, stdout, `codex app-server exited with code ${code}`);
      const err = new Error(`Failed to start a new Codex conversation. ${compact(detail, 1200)}`);
      err.status = 502;
      reject(err);
    });
  });
}

async function notifyCodexDesktopThreadCreated(threadId) {
  const id = String(threadId || "").trim();
  if (!id) return;
  const client = getCodexIpcClient();
  const failures = [];
  try {
    await client.refreshRecentConversations("local");
  } catch (error) {
    failures.push(`refresh: ${error.message || error}`);
  }
  try {
    await client.setActiveConversation(id, true, "local");
  } catch (error) {
    failures.push(`set active: ${error.message || error}`);
  }
  try {
    await openCodexUrl(`codex://threads/${encodeURIComponent(id)}`);
  } catch (error) {
    failures.push(`open: ${error.message || error}`);
  }
  if (failures.length) {
    recordNotice(id, {
      severity: "warning",
      title: "Desktop refresh delayed",
      content: `The conversation was created, but Codex Desktop may need a moment to refresh.\n\n${failures.join("\n")}`,
      source: "new-thread"
    });
  }
}

function firstRegexGroup(text, regex) {
  const match = String(text || "").match(regex);
  return match?.[1] || "";
}

async function openCodexUrl(url) {
  await new Promise((resolve, reject) => {
    const args = String(url || "").startsWith("codex://") ? ["-b", "com.openai.codex", url] : [url];
    execFile("open", args, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function isNoOpenOwnerError(error) {
  const message = String(error?.message || "");
  return message === "no-client-found" || message.includes("thread-role-timeout");
}

async function interruptCodex(threadId) {
  if (!ALLOW_WRITE) {
    const err = new Error("Read-only mode is enabled. Restart without --readonly to control Codex Desktop.");
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
    if (isNoOpenOwnerError(error)) {
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

function normalizeApprovalDecision(value) {
  const text = String(value || "").trim();
  if (["accept", "approve", "yes", "true"].includes(text)) return "accept";
  if (["acceptForSession", "approve-for-session", "always", "session"].includes(text)) return "acceptForSession";
  if (["decline", "deny", "no", "false"].includes(text)) return "decline";
  const err = new Error("Unknown approval decision");
  err.status = 400;
  throw err;
}

function approvalDecisionCandidates(value) {
  const normalized = normalizeApprovalDecision(value);
  if (normalized === "accept") return ["accept", "approve"];
  if (normalized === "acceptForSession") return ["acceptForSession", "approve_for_session", "approveForSession", "accept_for_session"];
  if (normalized === "decline") return ["decline", "deny"];
  return [normalized];
}

function approvalDecisionCandidatesForRequest(value, liveRequest) {
  const normalized = normalizeApprovalDecision(value);
  const options = Array.isArray(liveRequest?.availableDecisions) ? liveRequest.availableDecisions : [];
  const matches = options
    .map((option) => (typeof option === "string" ? option : firstString(option?.id, option?.value, option?.action, option?.label, option?.title)))
    .filter(Boolean)
    .filter((option) => {
      try {
        return normalizeApprovalDecision(option) === normalized;
      } catch {
        return false;
      }
    });
  return [...new Set([...matches, ...approvalDecisionCandidates(value)])];
}

function approvalKindFromMethod(method) {
  const text = String(method || "").toLowerCase();
  if (text.includes("file")) return "file";
  if (text.includes("permission")) return "permission";
  if (text.includes("command") || text.includes("execution") || text.includes("exec") || text.includes("terminal")) return "command";
  return "";
}

function approvalMethodForKind(kind) {
  if (kind === "file") return "thread-follower-file-approval-decision";
  if (kind === "permission") return "thread-follower-permissions-request-approval-response";
  return "thread-follower-command-approval-decision";
}

function approvalMethodCandidatesForKind(kind) {
  if (kind === "file") {
    return [
      { method: "thread-follower-file-approval-decision", mode: "follower" },
      { method: "reply-with-file-change-approval-decision", mode: "direct" }
    ];
  }
  if (kind === "permission") {
    return [
      { method: "thread-follower-permissions-request-approval-response", mode: "follower" },
      { method: "reply-with-permissions-request-approval-response", mode: "direct" }
    ];
  }
  return [
    { method: "thread-follower-command-approval-decision", mode: "follower" },
    { method: "reply-with-command-execution-approval-decision", mode: "direct" }
  ];
}

function approvalAvailableDecisions(payload) {
  const params = payload?.params || payload?.payload || {};
  const request = payload?.request || params?.request || {};
  return (
    (Array.isArray(payload?.available_decisions) && payload.available_decisions) ||
    (Array.isArray(payload?.availableDecisions) && payload.availableDecisions) ||
    (Array.isArray(params?.available_decisions) && params.available_decisions) ||
    (Array.isArray(params?.availableDecisions) && params.availableDecisions) ||
    (Array.isArray(request?.available_decisions) && request.available_decisions) ||
    (Array.isArray(request?.availableDecisions) && request.availableDecisions) ||
    (Array.isArray(payload?.options) && payload.options) ||
    (Array.isArray(params?.options) && params.options) ||
    (Array.isArray(request?.options) && request.options) ||
    []
  );
}

function visitObjects(value, visitor, depth = 0, seen = new Set()) {
  if (!value || typeof value !== "object" || depth > 10 || seen.has(value)) return null;
  seen.add(value);
  const result = visitor(value);
  if (result) return result;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = visitObjects(item, visitor, depth + 1, seen);
      if (found) return found;
    }
    return null;
  }
  for (const child of Object.values(value)) {
    const found = visitObjects(child, visitor, depth + 1, seen);
    if (found) return found;
  }
  return null;
}

function findLiveApprovalRequest(threadId, fallbackRequestId) {
  const selectedThreadId = String(threadId || "");
  const fallback = String(fallbackRequestId || "");
  const events = codexIpcClient?.events || [];
  const candidates = [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
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
    if (messageThreadId && selectedThreadId && String(messageThreadId) !== selectedThreadId) continue;
    const found = interactionPayloadsFromIpcMessage(event.message)
      .map((object) => {
        const methodText = String(object.method || object.type || object.name || "");
        const id = interactionRequestId(object);
        const kind = approvalKindFromPayload(object) || approvalKindFromMethod(methodText);
        if (!id || !kind) return null;
        return {
          requestId: id,
          kind,
          method: methodText,
          availableDecisions: approvalAvailableDecisions(object),
          priority: interactionPayloadPriority(object)
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.priority - b.priority);
    candidates.push(...found);
  }
  return candidates.find((candidate) => fallback && candidate.requestId === fallback) || candidates[0] || null;
}

async function respondToApproval({ threadId, requestId, decision, approvalKind } = {}) {
  if (!ALLOW_WRITE) {
    const err = new Error("Read-only mode is enabled. Restart without --readonly to control Codex Desktop.");
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
  const normalizedDecision = normalizeApprovalDecision(decision);
  const liveRequest = findLiveApprovalRequest(targetThreadId, requestId);
  const decisionCandidates = approvalDecisionCandidatesForRequest(decision, liveRequest);
  const resolvedRequestId = liveRequest?.requestId || String(requestId || "");
  const resolvedKind = liveRequest?.kind || String(approvalKind || "command");
  if (!resolvedRequestId) {
    const err = new Error("No approval request id found");
    err.status = 400;
    throw err;
  }

  const methodCandidates = approvalMethodCandidatesForKind(resolvedKind);
  const paramsForDecision = (candidate, mode) => {
    const base =
      resolvedKind === "permission"
        ? { conversationId: targetThreadId, requestId: resolvedRequestId, response: candidate }
        : { conversationId: targetThreadId, requestId: resolvedRequestId, decision: candidate };
    return mode === "follower" ? { hostId: "local", ...base } : base;
  };
  try {
    let lastError = null;
    for (const { method, mode } of methodCandidates) {
      for (const candidate of decisionCandidates) {
        try {
          await getCodexIpcClient().request(method, paramsForDecision(candidate, mode));
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!lastError) break;
    }
    if (lastError) throw lastError;
  } catch (error) {
    recordNotice(targetThreadId, {
      severity: "error",
      title: "Approval failed",
      content: `${error.message || "Codex Desktop rejected the approval decision."}\n\nMethods: ${methodCandidates.map((item) => item.method).join(", ")}\n\nRequest: ${resolvedRequestId}\n\nTried: ${decisionCandidates.join(", ")}`,
      source: "approval"
    });
    throw error;
  }
  return {
    ok: true,
    mode: "desktop-ipc",
    threadId: targetThreadId,
    requestId: resolvedRequestId,
    decision: normalizedDecision,
    approvalKind: resolvedKind,
    decidedAt: new Date().toISOString()
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
      keepIpcWarm();
      const homeState = await refreshCodexHomeContext({ force: true, source: "health" });
      sendJson(res, 200, {
        ok: true,
        codexHome: homeState.home,
        codexHomeVersion: homeState.version,
        codexHomeSource: homeState.source,
        codexHomeFixed: homeState.fixed,
        codexHomeChangedAt: homeState.changedAt,
        codexIpcSocket: CODEX_IPC_SOCKET,
        authRequired: AUTH_REQUIRED,
        allowWrite: ALLOW_WRITE,
        now: new Date().toISOString()
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/debug/events") {
      if (!requireAuthorized(req, res, url)) return;
      keepIpcWarm();
      const homeState = await refreshCodexHomeContext({ force: true, source: "debug" });
      sendJson(res, 200, {
        ok: true,
        codexHome: homeState.home,
        codexHomeVersion: homeState.version,
        codexHomeSource: homeState.source,
        ipcConnected: Boolean(codexIpcClient?.socket?.writable),
        clientId: codexIpcClient?.clientId || null,
        eventCount: codexIpcClient?.events?.length || 0,
        events: codexIpcClient?.rawEvents(url.searchParams.get("limit")) || []
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/send") {
      if (!requireAuthorized(req, res, url)) return;
      const body = await readJsonBody(req, MAX_SEND_BODY_BYTES);
      sendJson(res, 200, await sendToCodex(body.message, body.threadId, body.images, { newThread: Boolean(body.newThread) }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/new-thread") {
      if (!requireAuthorized(req, res, url)) return;
      sendJson(res, 200, {
        ok: true,
        mode: "local-draft",
        draft: true,
        createdAt: new Date().toISOString()
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/interrupt") {
      if (!requireAuthorized(req, res, url)) return;
      const body = await readJsonBody(req);
      sendJson(res, 200, await interruptCodex(body.threadId));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/approval") {
      if (!requireAuthorized(req, res, url)) return;
      const body = await readJsonBody(req);
      sendJson(res, 200, await respondToApproval(body));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/account") {
      if (!requireAuthorized(req, res, url)) return;
      const homeState = await refreshCodexHomeContext({ source: "account" });
      sendJson(res, 200, { ...(await getAccountInfo()), codexHome: homeState.home, codexHomeVersion: homeState.version });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/plugins") {
      if (!requireAuthorized(req, res, url)) return;
      sendJson(res, 200, await getPlugins());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/skills") {
      if (!requireAuthorized(req, res, url)) return;
      sendJson(res, 200, await getSkills());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/threads") {
      if (!requireAuthorized(req, res, url)) return;
      const homeState = await refreshCodexHomeContext({ source: "threads" });
      sendJson(res, 200, {
        threads: await getThreads({ preserveIds: [url.searchParams.get("selectedId")] }),
        codexHome: homeState.home,
        codexHomeVersion: homeState.version
      });
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
  const printQr = () => {
    console.log("");
    if (AUTH_REQUIRED) console.log("QR:     opens the LAN page and signs in automatically");
    else console.log("QR:     opens the LAN page");
    qrcode.generate(loginUrlFor(primaryUrl), { small: true });
  };

  console.log("Codex LAN Companion is running");
  console.log(`Local:  ${localUrl}`);
  for (const lanUrl of lanUrls) console.log(`LAN:    ${lanUrl}`);
  if (AUTH_REQUIRED) console.log(`Access code: ${ACCESS_TOKEN}`);
  console.log(
    `Mode:   ${ALLOW_WRITE ? "write enabled" : "read-only"}${
      AUTH_REQUIRED ? " · access-code protected" : " · auth disabled"
    }`
  );
  console.log(`Data:   ${codexHomeState.home}${codexHomeState.fixed ? " (fixed)" : " (dynamic)"}`);
  if (process.stdin.isTTY) console.log("Type:   qr, no-auth, auth, or help + Enter for runtime commands");
  printQr();

  if (process.stdin.isTTY) {
    const terminal = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "" });
    terminal.on("line", (line) => {
      const command = line.trim().toLowerCase();
      if (command === "qr") printQr();
      else if (command === "no-auth") {
        AUTH_REQUIRED = false;
        console.log("Access-code auth disabled. Existing and new browser sessions can access the LAN page without a code.");
        console.log("Type auth + Enter to enable access-code auth again.");
      } else if (command === "auth") {
        AUTH_REQUIRED = true;
        console.log("Access-code auth enabled.");
        console.log(`Access code: ${ACCESS_TOKEN}`);
        printQr();
      } else if (command === "url") {
        console.log(`Local:  ${localUrl}`);
        for (const lanUrl of lanUrls) console.log(`LAN:    ${lanUrl}`);
      } else if (command === "code") {
        console.log(`Access code: ${ACCESS_TOKEN}`);
        if (!AUTH_REQUIRED) console.log("Access-code auth is currently disabled.");
      } else if (command === "help" || command === "?") {
        console.log("Commands: qr, url, code, no-auth, auth, help");
      } else if (command) {
        console.log("Unknown command. Type help for available commands.");
      }
    });
  }
});
