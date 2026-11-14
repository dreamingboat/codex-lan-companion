import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

const serverPath = fileURLToPath(new URL("../server.js", import.meta.url));
async function listener(host, port = 0) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return server;
}
const close = (server) => new Promise((resolve) => server.close(resolve));
async function freePort() {
  const server = await listener("127.0.0.1");
  const port = server.address().port;
  await close(server);
  return port;
}
function request(host, port, token) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host, port, path: "/api/health", agent: false, headers: token ? { "x-access-token": token } : {} }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    });
    req.setTimeout(3000, () => req.destroy(new Error("Request timeout")));
    req.on("error", reject);
  });
}
async function launch(hosts, port) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "clc-listen-test-"));
  const args = [serverPath, "--port", String(port), "--password", "listen-test", "--readonly", "--codex-home", home];
  if (hosts !== undefined) args.push("--host", hosts);
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let exited = false;
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => { exited = true; resolve({ code, signal }); });
  });
  return {
    child, completion, output: () => output,
    async ready() {
      for (let i = 0; i < 250; i += 1) {
        if (output.includes("Codex LAN Companion is running")) return;
        if (exited) throw new Error(output);
        await delay(20);
      }
      throw new Error(`Startup timeout: ${output}`);
    },
    async cleanup() {
      if (!exited) child.kill("SIGTERM");
      try {
        return await Promise.race([completion, delay(7000, undefined, { ref: false }).then(() => { throw new Error(`Exit timeout: ${output}`); })]);
      } finally {
        if (!exited) child.kill("SIGKILL");
        await fs.rm(home, { recursive: true, force: true });
      }
    }
  };
}

test("two hosts share the API and authentication, deduplicate addresses, and both close", { timeout: 15000 }, async () => {
  const port = await freePort();
  const app = await launch("127.0.0.1, ::1,127.0.0.1", port);
  try {
    await app.ready();
    const simultaneous = await Promise.all([request("127.0.0.1", port, "listen-test"), request("::1", port, "listen-test")]);
    assert.equal(simultaneous.every((response) => response.status === 200), true);
    for (const host of ["127.0.0.1", "::1"]) {
      const health = await request(host, port, "listen-test");
      assert.equal(health.status, 200);
      assert.equal(health.body.ok, true);
      assert.equal(health.body.allowWrite, false);
      assert.equal((await request(host, port)).status, 401);
    }
  } finally {
    assert.equal((await app.cleanup()).code, 0);
  }
  for (const host of ["127.0.0.1", "::1"]) await close(await listener(host, port));
});

test("a second-host port conflict fails the entire startup and releases the first host", { timeout: 15000 }, async () => {
  const blocker = await listener("::1");
  const port = blocker.address().port;
  const app = await launch("127.0.0.1,::1", port);
  try {
    const result = await Promise.race([app.completion, delay(5000, undefined, { ref: false }).then(() => { throw new Error("Conflict did not stop startup"); })]);
    assert.equal(result.code, 1);
    assert.match(app.output(), /already in use/);
    assert.doesNotMatch(app.output(), /Codex LAN Companion is running/);
    await close(await listener("127.0.0.1", port));
  } finally {
    await app.cleanup();
    await close(blocker);
  }
});

test("an empty host list is rejected before listening", { timeout: 15000 }, async () => {
  const app = await launch(" , ", await freePort());
  try {
    assert.equal((await app.completion).code, 1);
    assert.match(app.output(), /non-empty --host/);
  } finally {
    await app.cleanup();
  }
});

test("single-host and default wildcard startup still work and SIGINT releases the port", { timeout: 15000 }, async () => {
  for (const host of ["127.0.0.1", undefined]) {
    const port = await freePort();
    const app = await launch(host, port);
    try {
      await app.ready();
      assert.equal((await request("127.0.0.1", port, "listen-test")).status, 200);
      app.child.kill("SIGINT");
      assert.equal((await app.completion).code, 0);
    } finally {
      await app.cleanup();
    }
    await close(await listener("127.0.0.1", port));
  }
});
