import { execFile } from "node:child_process";
import { createReadStream, existsSync, promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 8787);
const STATE_DB = path.join(CODEX_HOME, "state_5.sqlite");
const SESSION_INDEX = path.join(CODEX_HOME, "session_index.jsonl");
const PUBLIC_DIR = path.join(__dirname, "public");

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const messageCache = new Map();

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

function messageFromEvent(timestamp, payload) {
  if (payload?.type === "user_message") {
    return { role: "user", kind: "message", timestamp, content: stripCodexDirectives(payload.message) };
  }
  if (payload?.type === "agent_message") {
    return {
      role: "assistant",
      kind: "message",
      timestamp,
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
        const msg = messageFromEvent(entry.timestamp, entry.payload);
        if (msg?.content) eventMessages.push({ ...msg, lineNumber });
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
      sendJson(res, 200, { ok: true, codexHome: CODEX_HOME, now: new Date().toISOString() });
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
