#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const serverPath = path.join(projectRoot, "server.js");
const label = "com.openclaw.codex-lan-companion";
const home = os.homedir();
const launchAgentsDir = path.join(home, "Library", "LaunchAgents");
const logDir = path.join(home, "Library", "Logs", "CodexLanCompanion");
const plistPath = path.join(launchAgentsDir, `${label}.plist`);
const userDomain = `gui/${process.getuid()}`;
const serviceArgs = process.argv.slice(2);
const maxLogBytes = 1024 * 1024;
const maxRotatedLogs = 5;

function usage() {
  console.log(`Install Codex LAN Companion as a macOS LaunchAgent.

Usage:
  codex-lan-companion-install-service [server options]

Examples:
  codex-lan-companion-install-service
  codex-lan-companion-install-service --no-auth
  codex-lan-companion-install-service --readonly --port 8790
  codex-lan-companion-install-service --password home-only

The options after this command are passed to codex-lan-companion.`);
}

if (serviceArgs.includes("--help") || serviceArgs.includes("-h")) {
  usage();
  process.exit(0);
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: options.stdio || "pipe", encoding: "utf8" });
}

function runQuiet(command, args) {
  try {
    return run(command, args);
  } catch {
    return "";
  }
}

function normalizeServiceArgs(args) {
  const flagsWithValues = new Set(["--host", "--port", "--password", "--token", "--codex-home", "--ipc-socket"]);
  const booleanFlags = new Set(["--readonly", "--no-auth"]);
  const normalized = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inlineValue] = arg.split("=", 2);
    if (arg === "--write") {
      console.warn("Ignoring deprecated --write; write mode is enabled by default. Use --readonly to disable writes.");
      continue;
    }
    if (arg === "--dev-any-code") {
      throw new Error("Unsupported service option --dev-any-code. This internal test flag must not be installed.");
    }
    if (booleanFlags.has(flag)) {
      if (inlineValue !== undefined) throw new Error(`${flag} does not accept a value.`);
      normalized.push(arg);
      continue;
    }
    if (flagsWithValues.has(flag)) {
      const value = inlineValue ?? args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
      normalized.push(inlineValue === undefined ? flag : `${flag}=${value}`);
      if (inlineValue === undefined) {
        normalized.push(value);
        index += 1;
      }
      continue;
    }
    throw new Error(`Unknown service option: ${arg}`);
  }
  return normalized;
}

function rotateLogFile(filePath) {
  if (!existsSync(filePath)) return;
  const size = statSync(filePath).size;
  if (size < maxLogBytes) return;
  rmSync(`${filePath}.${maxRotatedLogs}`, { force: true });
  for (let index = maxRotatedLogs - 1; index >= 1; index -= 1) {
    const from = `${filePath}.${index}`;
    const to = `${filePath}.${index + 1}`;
    if (existsSync(from)) renameSync(from, to);
  }
  renameSync(filePath, `${filePath}.1`);
}

if (!existsSync(serverPath)) {
  console.error(`Cannot find server.js at ${serverPath}`);
  process.exit(1);
}

let normalizedServiceArgs;
try {
  normalizedServiceArgs = normalizeServiceArgs(serviceArgs);
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}

mkdirSync(launchAgentsDir, { recursive: true });
mkdirSync(logDir, { recursive: true });

const programArgs = [process.execPath, serverPath, ...normalizedServiceArgs]
  .map((arg) => `\t\t<string>${xmlEscape(arg)}</string>`)
  .join("\n");
const pathEnv = [
  path.dirname(process.execPath),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin"
].join(":");

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${xmlEscape(label)}</string>
\t<key>ProgramArguments</key>
\t<array>
${programArgs}
\t</array>
\t<key>WorkingDirectory</key>
\t<string>${xmlEscape(projectRoot)}</string>
\t<key>EnvironmentVariables</key>
\t<dict>
\t\t<key>PATH</key>
\t\t<string>${xmlEscape(pathEnv)}</string>
\t</dict>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>KeepAlive</key>
\t<true/>
\t<key>StandardOutPath</key>
\t<string>${xmlEscape(path.join(logDir, "out.log"))}</string>
\t<key>StandardErrorPath</key>
\t<string>${xmlEscape(path.join(logDir, "error.log"))}</string>
</dict>
</plist>
`;

runQuiet("launchctl", ["bootout", userDomain, plistPath]);
runQuiet("launchctl", ["enable", `${userDomain}/${label}`]);
rotateLogFile(path.join(logDir, "out.log"));
rotateLogFile(path.join(logDir, "error.log"));
writeFileSync(plistPath, plist, "utf8");
run("plutil", ["-lint", plistPath]);
run("launchctl", ["bootstrap", userDomain, plistPath]);
run("launchctl", ["enable", `${userDomain}/${label}`]);
run("launchctl", ["kickstart", "-k", `${userDomain}/${label}`]);

console.log("Codex LAN Companion LaunchAgent installed and started.");
console.log(`Service: ${label}`);
console.log(`Plist:   ${plistPath}`);
console.log(`Logs:    ${logDir}`);
console.log(`Args:    ${normalizedServiceArgs.length ? normalizedServiceArgs.join(" ") : "(none)"}`);
console.log("");
console.log("Status:");
console.log(runQuiet("launchctl", ["print", `${userDomain}/${label}`]).split("\n").slice(0, 18).join("\n"));
