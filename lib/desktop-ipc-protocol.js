import { promises as fs } from "node:fs";

// Read the JSON version table from the installed bundle without executing app code.
export async function readDesktopIpcVersions(archivePath) {
  const handle = await fs.open(archivePath, "r");
  try {
    const prefix = Buffer.alloc(16);
    if ((await handle.read(prefix, 0, prefix.length, 0)).bytesRead !== prefix.length) return null;
    const headerSize = prefix.readUInt32LE(4);
    const jsonSize = prefix.readUInt32LE(12);
    if (jsonSize < 2 || jsonSize > 32 * 1024 * 1024 || headerSize < jsonSize + 8) return null;
    const header = Buffer.alloc(jsonSize);
    if ((await handle.read(header, 0, jsonSize, 16)).bytesRead !== jsonSize) return null;
    const entries = JSON.parse(header.toString("utf8"))?.files?.[".vite"]?.files?.build?.files || {};
    const files = Object.entries(entries)
      .filter(([name, entry]) => name.endsWith(".js") && !entry.unpacked && Number(entry.size) <= 8 * 1024 * 1024)
      .sort(([a], [b]) => Number(!a.startsWith("src-")) - Number(!b.startsWith("src-")));
    for (const [, entry] of files) {
      const size = Number(entry.size);
      const offset = Number(entry.offset);
      if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(offset) || offset < 0) continue;
      const buffer = Buffer.alloc(size);
      if ((await handle.read(buffer, 0, size, 8 + headerSize + offset)).bytesRead !== size) continue;
      const table = buffer.toString("utf8").match(/\{[^{}]{0,16000}"thread-follower-start-turn"\s*:\s*\d+[^{}]{0,16000}\}/)?.[0];
      if (!table) continue;
      try {
        const versions = JSON.parse(table);
        if (!Object.values(versions).every((value) => Number.isSafeInteger(value) && value >= 0)) continue;
        return versions;
      } catch {
        // A non-JSON object near the method name is not the version table.
      }
    }
    return null;
  } finally {
    await handle.close();
  }
}

export function desktopRequestEnvelope(protocol, method, params) {
  const hostId = params?.hostId;
  // Local Desktop omits the top-level host; setting it selects the remote protocol.
  const routedHostId = protocol.detected && hostId === "local" ? undefined : hostId;
  let version = protocol.versions[method] ?? 0;
  if (protocol.detected && routedHostId != null && method.startsWith("thread-follower-")) version += 1;
  if (protocol.detected && method === "thread-follower-interrupt-turn" && routedHostId == null && version >= 4 && params.expectedTurnId == null) version = 3;
  return { ...(routedHostId ? { hostId: routedHostId } : {}), version };
}

export function desktopStartTurnParams(protocol, threadId, input, clientUserMessageId) {
  if ((protocol.versions["thread-follower-start-turn"] ?? 1) >= 2) {
    return {
      conversationId: threadId,
      hostId: "local",
      turnStart: {
        request: { threadId, input, clientUserMessageId },
        context: { attachments: [], inheritThreadSettings: true }
      }
    };
  }
  return { conversationId: threadId, hostId: "local", turnStartParams: { input, attachments: [] } };
}
