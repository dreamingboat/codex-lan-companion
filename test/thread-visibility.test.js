import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = await fs.readFile(new URL("../server.js", import.meta.url), "utf8");
const helpers = source.slice(source.indexOf("function isArchivedThread("), source.indexOf("\nasync function getAccountInfo("));
const loader = source.slice(source.indexOf("async function loadThreadsUncached("), source.indexOf("\nasync function findThread("));
const guardian = JSON.stringify({ subagent: { other: "guardian" } });

test("Guardian detection uses source metadata and never the conversation title", () => {
  const isGuardianThread = vm.runInNewContext(`${helpers}\nisGuardianThread`);
  assert.equal(isGuardianThread({ threadSource: guardian }), true);
  assert.equal(isGuardianThread({ source: { subagent: { other: "guardian" } } }), true);
  assert.equal(isGuardianThread({ threadSource: "guardian_review" }), true);
  assert.equal(isGuardianThread({ title: "Guardian review", threadSource: "user" }), false);
  assert.equal(isGuardianThread({ threadSource: '{"subagent":{"other":"explorer"}}' }), false);
  assert.equal(isGuardianThread({ threadSource: "malformed metadata" }), false);
});

function fixture({ database = true, stateRows = [], indexRows = [], ipcRows = [], guardianIds = [] } = {}) {
  const context = {
    Date, Set, Map, Number, String,
    threadsCache: null,
    SLOW_POLL_REQUEST_MS: 5000,
    THREADS_STALE_CACHE_MS: 60000,
    refreshCodexHomeContext: async () => ({ home: "/test" }),
    codexPaths: () => ({ stateDb: "/test/state.sqlite", sessionIndex: "/test/index" }),
    existsSync: () => database,
    readSessionIndexTitleMap: async () => new Map(),
    readSessionIndexRows: async () => indexRows,
    runSqlJson: async (sql) => sql.includes("json_valid(source)") ? guardianIds.map((id) => ({ id })) : stateRows,
    filterRowsForCurrentAccount: async (rows) => ({ rows }),
    displayThreadTitle: (row) => row.title,
    codexIpcClient: { getDesktopConversationRows: () => ipcRows },
    logInfo: () => {},
    logError: () => {}
  };
  return vm.runInNewContext(`${helpers}\n${loader}\nloadThreadsUncached`, context);
}

test("internal threads stay excluded across state, index, IPC and preserved selections", async () => {
  const load = fixture({
    stateRows: [
      { id: "user", title: "Guardian review", threadSource: "user" },
      { id: "guardian", title: "Review", threadSource: guardian },
      { id: "archived", archived: 1 }
    ],
    indexRows: [{ id: "old-guardian" }, { id: "guardian" }, { id: "archived" }, { id: "indexed-user" }],
    ipcRows: [
      { id: "old-guardian", rolloutPath: "/test/old.jsonl" },
      { id: "ipc-guardian", threadSource: "guardian_review", rolloutPath: "/test/guardian.jsonl" },
      { id: "ipc-user", rolloutPath: "/test/user.jsonl" }
    ],
    guardianIds: ["guardian", "old-guardian"]
  });
  const rows = await load({ preserveIds: ["guardian", "old-guardian"] });
  assert.deepEqual(Array.from(rows, (row) => row.id).sort(), ["indexed-user", "ipc-user", "user"]);
});

test("index fallback hides explicit Guardian source markers while keeping other subagents", async () => {
  const load = fixture({ database: false, indexRows: [
    { id: "guardian", threadSource: guardian },
    { id: "explorer", threadSource: { subagent: { other: "explorer" } } },
    { id: "user", title: "Guardian review" }
  ] });
  const rows = await load();
  assert.deepEqual(Array.from(rows, (row) => row.id).sort(), ["explorer", "user"]);
});
