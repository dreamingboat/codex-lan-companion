#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const label = "com.openclaw.codex-lan-companion";
const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
const userDomain = `gui/${process.getuid()}`;

function runQuiet(command, args) {
  try {
    return execFileSync(command, args, { stdio: "pipe", encoding: "utf8" });
  } catch {
    return "";
  }
}

runQuiet("launchctl", ["bootout", userDomain, plistPath]);

if (existsSync(plistPath)) {
  unlinkSync(plistPath);
}

console.log("Codex LAN Companion LaunchAgent uninstalled.");
console.log(`Service: ${label}`);
console.log(`Removed: ${plistPath}`);
console.log("Logs were kept under ~/Library/Logs/CodexLanCompanion.");
