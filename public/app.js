const state = {
  threads: [],
  selectedId: null,
  messagesSignature: "",
  filter: "",
  showTools: false,
  sidebarCollapsed: false,
  loadingMessages: false
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
  composerForm: document.querySelector("#composerForm"),
  composerInput: document.querySelector("#composerInput"),
  sendButton: document.querySelector("#sendButton"),
  sendStatus: document.querySelector("#sendStatus")
};

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
  if (message.role === "user") return "User";
  if (message.role === "assistant") return "Codex";
  if (message.role === "tool") return "Tool";
  return message.role || "System";
}

function renderMessages(data) {
  const selected = state.threads.find((thread) => thread.id === state.selectedId);
  els.threadTitle.textContent = selected?.title || data.thread?.title || "Untitled";
  els.threadMeta.textContent = `${data.messages.length} 条内容 · ${formatDate(data.thread?.updatedAtMs)} · ${data.meta?.cwd || data.thread?.cwd || ""}`;

  if (!data.messages.length) {
    els.messageList.innerHTML = `<div class="empty-state">这个对话暂时没有可展示内容。</div>`;
    return;
  }

  els.messageList.innerHTML = data.messages
    .map((message) => {
      const isTool = message.role === "tool";
      const hidden = isTool && !state.showTools ? " hidden" : "";
      const title = isTool ? `<div class="tool-title">${escapeHtml(message.kind)} · ${escapeHtml(message.title || "")}</div>` : "";
      return `
        <article class="message ${escapeHtml(message.role)}${hidden}">
          <div class="role">${roleLabel(message)}</div>
          <div class="bubble">
            ${title}
            ${renderMarkdownLite(message.content || "")}
          </div>
        </article>
      `;
    })
    .join("");
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
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
    const signature = `${data.thread?.updatedAtMs || ""}:${data.size || ""}:${data.mtimeMs || ""}:${state.showTools}`;
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
    await loadThreads();
    await loadMessages(forceMessages);
  } catch (error) {
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

els.composerInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    els.composerForm.requestSubmit();
  }
});

els.composerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = els.composerInput.value.trim();
  if (!message) return;
  els.sendButton.disabled = true;
  els.composerInput.disabled = true;
  els.sendStatus.textContent = "正在发送到 Codex...";
  try {
    await postJson("/api/send", { message, threadId: state.selectedId });
    els.composerInput.value = "";
    els.sendStatus.textContent = "已发送到 Codex 桌面端，等待对话同步";
    setTimeout(() => refresh(true), 1200);
  } catch (error) {
    els.sendStatus.textContent = `发送失败：${error.message}`;
  } finally {
    els.sendButton.disabled = false;
    els.composerInput.disabled = false;
    els.composerInput.focus();
  }
});

renderSidebarState();
refresh(true);
setInterval(() => refresh(false), 3000);
