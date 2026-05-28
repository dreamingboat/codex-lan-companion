const state = {
  threads: [],
  selectedId: null,
  messagesSignature: "",
  filter: "",
  showTools: false,
  sidebarCollapsed: false,
  loadingMessages: false,
  account: null,
  accountExpanded: false,
  config: null,
  authToken: ""
};

const els = {
  shell: document.querySelector("#shell"),
  threadCount: document.querySelector("#threadCount"),
  threadList: document.querySelector("#threadList"),
  threadTitle: document.querySelector("#threadTitle"),
  threadMeta: document.querySelector("#threadMeta"),
  messageList: document.querySelector("#messageList"),
  refreshButton: document.querySelector("#refreshButton"),
  sidebarToggle: document.querySelector("#sidebarToggle"),
  sidebarCloseButton: document.querySelector("#sidebarCloseButton"),
  searchInput: document.querySelector("#searchInput"),
  toolToggle: document.querySelector("#toolToggle"),
  lockButton: document.querySelector("#lockButton"),
  composerForm: document.querySelector("#composerForm"),
  composerInput: document.querySelector("#composerInput"),
  sendButton: document.querySelector("#sendButton"),
  sendStatus: document.querySelector("#sendStatus"),
  accountSummary: document.querySelector("#accountSummary"),
  accountName: document.querySelector("#accountName"),
  accountPlan: document.querySelector("#accountPlan"),
  accountToggle: document.querySelector("#accountToggle"),
  accountPanel: document.querySelector("#accountPanel"),
  authGate: document.querySelector("#authGate"),
  authForm: document.querySelector("#authForm"),
  authInput: document.querySelector("#authInput"),
  authButton: document.querySelector("#authButton"),
  authReveal: document.querySelector("#authReveal"),
  rememberDevice: document.querySelector("#rememberDevice"),
  authError: document.querySelector("#authError")
};

function safeStorageGet(storage, key) {
  try {
    return storage.getItem(key) || "";
  } catch {
    return "";
  }
}

function safeStorageSet(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch {
    // Storage can be unavailable in some mobile privacy modes.
  }
}

function safeStorageRemove(storage, key) {
  try {
    storage.removeItem(key);
  } catch {
    // Storage can be unavailable in some mobile privacy modes.
  }
}

function initAuthToken() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("token");
  if (token) {
    safeStorageSet(sessionStorage, "codexLanToken", token);
    url.searchParams.delete("token");
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }
  state.authToken = token || safeStorageGet(sessionStorage, "codexLanToken") || safeStorageGet(localStorage, "codexLanToken");
  els.rememberDevice.checked = Boolean(safeStorageGet(localStorage, "codexLanToken"));
}

function authHeaders(extra = {}) {
  return state.authToken ? { ...extra, "x-access-token": state.authToken } : extra;
}

function showAuthGate(message = "") {
  els.authGate.hidden = false;
  els.authError.textContent = message;
  window.setTimeout(() => els.authInput.focus(), 0);
}

function hideAuthGate() {
  els.authGate.hidden = true;
  els.authError.textContent = "";
}

function lockApp(message = "") {
  safeStorageRemove(sessionStorage, "codexLanToken");
  safeStorageRemove(localStorage, "codexLanToken");
  state.authToken = "";
  state.config = null;
  state.messagesSignature = "";
  els.rememberDevice.checked = false;
  els.authInput.value = "";
  els.threadCount.textContent = "需要访问码";
  els.messageList.innerHTML = `<div class="empty-state">请输入访问码后继续。</div>`;
  showAuthGate(message);
}

function formatDate(ms) {
  if (!ms) return "";
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatMessageDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m${seconds}s`;
}

function formatResetTime(ms) {
  if (!ms) return "";
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatWindow(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return "窗口";
  if (value % 10080 === 0) return `${value / 10080} 周窗口`;
  if (value % 1440 === 0) return `${value / 1440} 天窗口`;
  if (value % 60 === 0) return `${value / 60} 小时窗口`;
  return `${value} 分钟窗口`;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderMarkdownLite(text) {
  const escaped = escapeHtml(text || "");
  const withCodeBlocks = escaped.replace(/```([\s\S]*?)```/g, (_match, code) => `<pre><code>${code.trim()}</code></pre>`);
  return withCodeBlocks
    .split(/\n{2,}/)
    .map((part) => {
      if (part.startsWith("<pre>")) return part;
      return `<p>${part.replaceAll("\n", "<br>")}</p>`;
    })
    .join("");
}

function visibleThreads() {
  const query = state.filter.trim().toLowerCase();
  if (!query) return state.threads;
  return state.threads.filter((thread) => {
    return `${thread.title || ""} ${thread.preview || ""} ${thread.cwd || ""}`.toLowerCase().includes(query);
  });
}

function renderThreads() {
  const threads = visibleThreads();
  els.threadCount.textContent = `${state.threads.length} 个对话`;
  els.threadList.innerHTML = threads
    .map((thread) => {
      const active = thread.id === state.selectedId ? " active" : "";
      const title = escapeHtml(thread.title || "Untitled");
      return `
        <button class="thread-item${active}" data-id="${thread.id}">
          <span class="thread-title">${title}</span>
        </button>
      `;
    })
    .join("");
}

function renderSidebarState() {
  els.shell.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  els.sidebarToggle.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
}

function roleLabel(message) {
  if (message.role === "assistant") return "Codex";
  if (message.role === "user") return "User";
  if (message.role === "tool") return "Tool";
  return message.role || "System";
}

function roleIcon(message) {
  if (message.role === "assistant") {
    return `<img class="role-icon-image" src="/assets/companion-mark.svg" alt="" />`;
  }
  if (message.role === "user") {
    return `
      <svg class="role-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="7" y="2.75" width="10" height="18.5" rx="2.25"></rect>
        <path d="M10.25 5.25h3.5M11 18.25h2"></path>
      </svg>
    `;
  }
  if (message.role === "tool") {
    return `
      <svg class="role-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.5 5.5 18.5 9.5M16.5 3.5l4 4-11 11H5.5v-4z"></path>
      </svg>
    `;
  }
  return `<span class="role-icon-fallback">${escapeHtml(message.role || "System")}</span>`;
}

function roleBadge(message) {
  return `
    <div class="role-badge" aria-label="${escapeHtml(roleLabel(message))}">
      ${roleIcon(message)}
      <span class="role-text">${escapeHtml(roleLabel(message))}</span>
    </div>
  `;
}

function messageMetaTop(message, previousUserMessage) {
  if (message.role === "user") return "已发送";
  if (message.role === "assistant") {
    const inferredDuration =
      message.durationMs ||
      (previousUserMessage?.timestamp && message.timestamp
        ? new Date(message.timestamp).getTime() - new Date(previousUserMessage.timestamp).getTime()
        : 0);
    const duration = formatDuration(inferredDuration);
    return duration ? `已处理 ${duration}` : "已处理";
  }
  if (message.role === "tool") return message.kind || "工具";
  return message.kind || "";
}

function renderMessages(data) {
  const selected = state.threads.find((thread) => thread.id === state.selectedId);
  els.threadTitle.textContent = selected?.title || data.thread?.title || "Untitled";
  const statusText = data.status?.thinking ? " · 思考中..." : "";
  els.threadMeta.textContent = `${data.messages.length} 条内容${statusText} · ${formatDate(data.thread?.updatedAtMs)} · ${data.meta?.cwd || data.thread?.cwd || ""}`;

  if (!data.messages.length && !data.status?.thinking) {
    els.messageList.innerHTML = `<div class="empty-state">这个对话暂时没有可展示内容。</div>`;
    return;
  }

  let previousUserMessage = null;
  const messageHtml = data.messages
    .map((message) => {
      const isTool = message.role === "tool";
      const hidden = isTool && !state.showTools ? " hidden" : "";
      const title = isTool ? `<div class="tool-title">${escapeHtml(message.kind)} · ${escapeHtml(message.title || "")}</div>` : "";
      const metaTop = messageMetaTop(message, previousUserMessage);
      const metaBottom = formatMessageDate(message.completedAtMs || message.timestamp);
      if (message.role === "user") previousUserMessage = message;
      return `
        <article class="message ${escapeHtml(message.role)}${hidden}">
          <div class="role">${roleBadge(message)}</div>
          <div class="bubble">
            ${metaTop ? `<div class="message-meta message-meta-top">${escapeHtml(metaTop)}</div>` : ""}
            ${title}
            ${renderMarkdownLite(message.content || "")}
            ${metaBottom ? `<div class="message-meta message-meta-bottom">${escapeHtml(metaBottom)}</div>` : ""}
          </div>
        </article>
      `;
    })
    .join("");
  const thinkingHtml = data.status?.thinking
    ? `
      <article class="message assistant thinking-message">
        <div class="role">${roleBadge({ role: "assistant" })}</div>
        <div class="bubble thinking-bubble">
          <div class="message-meta message-meta-top">正在处理</div>
          <p>思考中<span class="thinking-dots" aria-hidden="true"></span></p>
        </div>
      </article>
    `
    : "";
  els.messageList.innerHTML = `${messageHtml}${thinkingHtml}`;
}

function usageLine(label, window) {
  if (!window) return "";
  const used = Number.isFinite(Number(window.usedPercent)) ? `${Math.round(Number(window.usedPercent))}%` : "-";
  const reset = formatResetTime(window.resetsAtMs);
  return `
    <div class="usage-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(used)}</strong>
      <small>${escapeHtml(formatWindow(window.windowMinutes))}${reset ? ` · 重置 ${escapeHtml(reset)}` : ""}</small>
    </div>
  `;
}

function renderAccount() {
  const account = state.account;
  const label = account?.user?.label || "Codex";
  const plan = account?.plan?.label || "-";
  els.accountName.textContent = label;
  els.accountPlan.textContent = plan;
  els.accountSummary.title = account?.user?.email || label;
  els.accountToggle.setAttribute("aria-expanded", String(state.accountExpanded));
  els.accountToggle.classList.toggle("expanded", state.accountExpanded);
  els.accountPanel.hidden = !state.accountExpanded;

  if (!state.accountExpanded) return;
  const usage = account?.usage;
  const credits = usage?.credits;
  const creditText = credits?.unlimited
    ? "额度无限"
    : credits?.hasCredits
      ? `余额 ${credits.balance ?? "-"}`
      : "无额外额度";
  const updatedAt = formatResetTime(usage?.updatedAt);
  els.accountPanel.innerHTML = usage
    ? `
      <div class="usage-grid">
        ${usageLine("主要用量", usage.primary)}
        ${usageLine("长期用量", usage.secondary)}
        <div class="usage-row">
          <span>额度</span>
          <strong>${escapeHtml(creditText)}</strong>
          <small>${updatedAt ? `更新 ${escapeHtml(updatedAt)}` : "本地最近记录"}</small>
        </div>
      </div>
    `
    : `<div class="usage-empty">还没有读取到本地套餐用量记录。</div>`;
}

async function loadAccount() {
  try {
    state.account = await fetchJson("/api/account");
    renderAccount();
  } catch {
    state.account = null;
    renderAccount();
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store", headers: authHeaders() });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || response.statusText);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || response.statusText);
    error.status = response.status;
    throw error;
  }
  return data;
}

function renderComposerMode() {
  const allowWrite = Boolean(state.config?.allowWrite);
  els.composerInput.disabled = !allowWrite;
  els.sendButton.disabled = !allowWrite;
  els.composerInput.placeholder = allowWrite ? "发送到当前 Codex 窗口" : "只读模式：启动时加 --write 才能发送";
  if (!allowWrite) els.sendStatus.textContent = "只读模式";
  else if (els.sendStatus.textContent === "只读模式") els.sendStatus.textContent = "";
}

async function loadConfig() {
  state.config = await fetchJson("/api/health");
  hideAuthGate();
  renderComposerMode();
}

async function loadThreads() {
  const data = await fetchJson("/api/threads");
  state.threads = data.threads || [];
  if (!state.selectedId && state.threads[0]) {
    state.selectedId = state.threads[0].id;
  }
  renderThreads();
}

async function loadMessages(force = false) {
  if (!state.selectedId || state.loadingMessages) return;
  state.loadingMessages = true;
  try {
    const data = await fetchJson(`/api/threads/${state.selectedId}/messages`);
    const signature = `${data.thread?.updatedAtMs || ""}:${data.size || ""}:${data.mtimeMs || ""}:${state.showTools}:${data.status?.thinking ? "thinking" : "idle"}:${data.status?.turnId || ""}`;
    if (force || signature !== state.messagesSignature) {
      const wasNearBottom =
        els.messageList.scrollHeight - els.messageList.scrollTop - els.messageList.clientHeight < 120;
      state.messagesSignature = signature;
      renderMessages(data);
      if (wasNearBottom || force) {
        els.messageList.scrollTop = els.messageList.scrollHeight;
      }
    }
  } catch (error) {
    els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  } finally {
    state.loadingMessages = false;
  }
}

async function refresh(forceMessages = false) {
  try {
    if (!state.config) await loadConfig();
    await loadThreads();
    await loadMessages(forceMessages);
  } catch (error) {
    if (error.status === 401) {
      lockApp("访问码不正确，请重新输入。");
      return;
    }
    els.threadCount.textContent = "同步失败";
    els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

els.threadList.addEventListener("click", (event) => {
  const button = event.target.closest(".thread-item");
  if (!button) return;
  state.selectedId = button.dataset.id;
  state.messagesSignature = "";
  renderThreads();
  loadMessages(true);
});

els.refreshButton.addEventListener("click", () => refresh(true));

els.sidebarCloseButton.addEventListener("click", () => {
  state.sidebarCollapsed = true;
  renderSidebarState();
});

els.sidebarToggle.addEventListener("click", () => {
  state.sidebarCollapsed = false;
  renderSidebarState();
});

els.searchInput.addEventListener("input", (event) => {
  state.filter = event.target.value;
  renderThreads();
});

els.toolToggle.addEventListener("change", (event) => {
  state.showTools = event.target.checked;
  state.messagesSignature = "";
  loadMessages(true);
});

els.lockButton.addEventListener("click", () => {
  lockApp("已锁定，请重新输入访问码。");
});

els.accountToggle.addEventListener("click", () => {
  state.accountExpanded = !state.accountExpanded;
  renderAccount();
  if (state.accountExpanded) loadAccount();
});

els.authReveal.addEventListener("click", () => {
  const revealed = els.authInput.type === "text";
  els.authInput.type = revealed ? "password" : "text";
  els.authReveal.setAttribute("aria-pressed", String(!revealed));
  els.authReveal.setAttribute("aria-label", revealed ? "显示访问码" : "隐藏访问码");
  els.authReveal.setAttribute("title", revealed ? "显示访问码" : "隐藏访问码");
  els.authInput.focus();
});

els.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = els.authInput.value.trim();
  if (!token) {
    showAuthGate("请输入访问码。");
    return;
  }
  state.authToken = token;
  safeStorageSet(sessionStorage, "codexLanToken", token);
  if (els.rememberDevice.checked) safeStorageSet(localStorage, "codexLanToken", token);
  else safeStorageRemove(localStorage, "codexLanToken");
  els.authError.textContent = "";
  els.authButton.disabled = true;
  els.authButton.textContent = "验证中";
  try {
    await loadConfig();
    await refresh(true);
    await loadAccount();
  } catch (error) {
    if (error.status === 401) {
      lockApp("访问码不正确，请重新输入。");
      return;
    }
    showAuthGate(error.message);
  } finally {
    els.authButton.disabled = false;
    els.authButton.textContent = "进入";
  }
});

els.composerInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    els.composerForm.requestSubmit();
  }
});

els.composerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.config?.allowWrite) return;
  const message = els.composerInput.value.trim();
  if (!message) return;
  els.sendButton.disabled = true;
  els.composerInput.disabled = true;
  els.sendStatus.textContent = "";
  try {
    await postJson("/api/send", { message, threadId: state.selectedId });
    els.composerInput.value = "";
    setTimeout(() => refresh(true), 1200);
  } catch (error) {
    els.sendStatus.textContent = `发送失败：${error.message}`;
  } finally {
    els.sendButton.disabled = false;
    els.composerInput.disabled = false;
    renderComposerMode();
    els.composerInput.focus();
  }
});

initAuthToken();
renderSidebarState();
refresh(true);
loadAccount();
setInterval(() => {
  if (state.config) loadThreads().catch(() => {});
}, 3000);
setInterval(() => {
  if (state.config) loadMessages(false).catch(() => {});
}, 1000);
setInterval(() => {
  if (state.config) loadAccount().catch(() => {});
}, 30000);
