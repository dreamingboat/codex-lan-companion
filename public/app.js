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
  authToken: "",
  threadStatus: null,
  composerBusy: false,
  imageAttachments: [],
  pendingMessages: [],
  lastMessagesData: null
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
  drawerOverlay: document.querySelector("#drawerOverlay"),
  sidebarCloseButton: document.querySelector("#sidebarCloseButton"),
  searchInput: document.querySelector("#searchInput"),
  toolToggle: document.querySelector("#toolToggle"),
  lockButton: document.querySelector("#lockButton"),
  composerForm: document.querySelector("#composerForm"),
  composerInput: document.querySelector("#composerInput"),
  imageInput: document.querySelector("#imageInput"),
  attachmentTray: document.querySelector("#attachmentTray"),
  attachButton: document.querySelector("#attachButton"),
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

const I18N = {
  zh: {
    documentTitle: "Codex LAN Viewer",
    authTitle: "Codex LAN Companion",
    authHelp: "输入启动终端里显示的访问码。",
    accessCode: "访问码",
    showAccessCode: "显示访问码",
    hideAccessCode: "隐藏访问码",
    rememberDevice: "记住这台设备",
    enter: "进入",
    verifying: "验证中",
    showThreads: "显示对话列表",
    closeThreads: "关闭对话列表",
    hideThreads: "隐藏对话列表",
    refresh: "刷新",
    loading: "加载中",
    searchThreads: "搜索对话",
    threadList: "对话列表",
    selectThread: "选择一个对话",
    syncEvery: "每 3 秒自动同步",
    pickThread: "从左侧选择一个 Codex 对话。",
    tool: "工具",
    roleTool: "工具",
    roleInteraction: "交互",
    interactionRequired: "需要处理",
    interactionDesktopAction: "请在桌面 Codex 处理",
    showUsage: "显示套餐用量",
    send: "发送",
    stop: "停止",
    stopCurrentTask: "停止当前任务",
    addImage: "添加图片",
    removeImage: "移除图片",
    imageTooLarge: "图片过大，单张不能超过 {size} MB。",
    imageUnsupported: "不支持此图片格式，请换 JPEG、PNG 或 WebP。",
    imageDimensionsInvalid: "图片尺寸不支持，宽高需在 {min}-{max}px 之间。",
    tooManyImages: "最多只能添加 {count} 张图片。",
    sendToCodex: "发送到当前 Codex 窗口",
    readonlyPlaceholder: "只读模式：启动时加 --write 才能发送",
    readonly: "只读模式",
    needAccessCode: "需要访问码",
    enterAccessCode: "请输入访问码。",
    accessCodeWrong: "访问码不正确，请重新输入。",
    lockedAgain: "已锁定，请重新输入访问码。",
    locked: "已锁定",
    unlocked: "当前已解锁，点击锁定",
    syncFailed: "同步失败",
    syncTemporaryFailed: "同步暂时失败",
    emptyThread: "这个对话暂时没有可展示内容。",
    contents: "{count} 条内容",
    thinking: "思考中...",
    processing: "正在处理",
    sent: "已发送",
    processed: "已处理",
    primaryUsage: "主要用量",
    longTermUsage: "长期用量",
    credit: "额度",
    unlimitedCredit: "额度无限",
    balance: "余额 {balance}",
    noExtraCredit: "无额外额度",
    updated: "更新 {time}",
    latestLocalRecord: "本地最近记录",
    noUsage: "还没有读取到本地套餐用量记录。",
    conversationsCount: "{count} 个对话",
    window: "窗口",
    weekWindow: "{count} 周窗口",
    dayWindow: "{count} 天窗口",
    hourWindow: "{count} 小时窗口",
    minuteWindow: "{count} 分钟窗口",
    resetAt: "重置 {time}",
    sendFailed: "发送失败：{message}",
    interruptFailed: "停止失败：{message}",
    untitled: "Untitled",
    separator: " · "
  },
  en: {
    documentTitle: "Codex LAN Viewer",
    authTitle: "Codex LAN Companion",
    authHelp: "Enter the access code shown in the terminal.",
    accessCode: "Access code",
    showAccessCode: "Show access code",
    hideAccessCode: "Hide access code",
    rememberDevice: "Remember this device",
    enter: "Enter",
    verifying: "Verifying",
    showThreads: "Show conversations",
    closeThreads: "Close conversations",
    hideThreads: "Hide conversations",
    refresh: "Refresh",
    loading: "Loading",
    searchThreads: "Search conversations",
    threadList: "Conversation list",
    selectThread: "Select a conversation",
    syncEvery: "Auto-syncs every 3 seconds",
    pickThread: "Select a Codex conversation from the left.",
    tool: "Tools",
    roleTool: "Tool",
    roleInteraction: "Interaction",
    interactionRequired: "Action required",
    interactionDesktopAction: "Handle this in Codex desktop",
    showUsage: "Show plan usage",
    send: "Send",
    stop: "Stop",
    stopCurrentTask: "Stop current task",
    addImage: "Add image",
    removeImage: "Remove image",
    imageTooLarge: "Image is too large. Each image must be under {size} MB.",
    imageUnsupported: "Unsupported image format. Use JPEG, PNG, or WebP.",
    imageDimensionsInvalid: "Unsupported image dimensions. Width and height must be {min}-{max}px.",
    tooManyImages: "You can attach up to {count} images.",
    sendToCodex: "Send to current Codex window",
    readonlyPlaceholder: "Read-only: restart with --write to send",
    readonly: "Read-only",
    needAccessCode: "Access code required",
    enterAccessCode: "Enter the access code.",
    accessCodeWrong: "Incorrect access code. Try again.",
    lockedAgain: "Locked. Enter the access code again.",
    locked: "Locked",
    unlocked: "Unlocked. Click to lock",
    syncFailed: "Sync failed",
    syncTemporaryFailed: "Sync temporarily failed",
    emptyThread: "This conversation has no displayable content yet.",
    contents: "{count} items",
    thinking: "Thinking...",
    processing: "Processing",
    sent: "Sent",
    processed: "Processed",
    primaryUsage: "Primary usage",
    longTermUsage: "Long-term usage",
    credit: "Credit",
    unlimitedCredit: "Unlimited",
    balance: "Balance {balance}",
    noExtraCredit: "No extra credit",
    updated: "Updated {time}",
    latestLocalRecord: "Latest local record",
    noUsage: "No local plan usage record found yet.",
    conversationsCount: "{count} conversations",
    window: "Window",
    weekWindow: "{count} week window",
    dayWindow: "{count} day window",
    hourWindow: "{count} hour window",
    minuteWindow: "{count} minute window",
    resetAt: "resets {time}",
    sendFailed: "Send failed: {message}",
    interruptFailed: "Stop failed: {message}",
    untitled: "Untitled",
    separator: " · "
  }
};

function detectLocale() {
  return (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
}

state.locale = detectLocale();
const dateFormatter = new Intl.DateTimeFormat(state.locale === "zh" ? "zh-CN" : "en-US", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});
const MAX_IMAGE_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2000;
const MIN_IMAGE_EDGE = 16;
const IMAGE_JPEG_QUALITY = 0.86;

function t(key, values = {}) {
  const text = I18N[state.locale][key] || I18N.en[key] || key;
  return text.replace(/\{(\w+)\}/g, (_match, name) => values[name] ?? "");
}

function applyStaticText() {
  document.documentElement.lang = state.locale === "zh" ? "zh-CN" : "en";
  document.title = t("documentTitle");
  document.querySelector(".auth-card h2").textContent = t("authTitle");
  document.querySelector(".auth-card p").textContent = t("authHelp");
  els.authInput.placeholder = t("accessCode");
  els.authReveal.setAttribute("title", t("showAccessCode"));
  els.authReveal.setAttribute("aria-label", t("showAccessCode"));
  document.querySelector(".remember-toggle span").textContent = t("rememberDevice");
  els.authButton.textContent = t("enter");
  els.sidebarToggle.setAttribute("title", t("showThreads"));
  els.sidebarToggle.setAttribute("aria-label", t("showThreads"));
  els.drawerOverlay.setAttribute("title", t("closeThreads"));
  els.drawerOverlay.setAttribute("aria-label", t("closeThreads"));
  els.threadCount.textContent = t("loading");
  els.refreshButton.setAttribute("title", t("refresh"));
  els.sidebarCloseButton.setAttribute("title", t("hideThreads"));
  els.sidebarCloseButton.setAttribute("aria-label", t("hideThreads"));
  els.searchInput.placeholder = t("searchThreads");
  els.threadList.setAttribute("aria-label", t("threadList"));
  els.threadTitle.textContent = t("selectThread");
  els.threadMeta.textContent = t("syncEvery");
  document.querySelector(".toggle span").textContent = t("tool");
  els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(t("pickThread"))}</div>`;
  els.accountToggle.setAttribute("title", t("showUsage"));
  els.accountToggle.setAttribute("aria-label", t("showUsage"));
  els.attachButton.setAttribute("title", t("addImage"));
  els.attachButton.setAttribute("aria-label", t("addImage"));
  els.sendButton.textContent = t("send");
  els.composerInput.placeholder = t("sendToCodex");
}

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
    url.searchParams.delete("token");
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }
  safeStorageRemove(sessionStorage, "codexLanToken");
  state.authToken = token || safeStorageGet(localStorage, "codexLanToken");
  els.rememberDevice.checked = Boolean(safeStorageGet(localStorage, "codexLanToken"));
}

function authHeaders(extra = {}) {
  return state.authToken ? { ...extra, "x-access-token": state.authToken } : extra;
}

function showAuthGate(message = "") {
  els.authGate.hidden = false;
  els.authError.textContent = message;
  renderLockState(false);
  window.setTimeout(() => els.authInput.focus(), 0);
}

function hideAuthGate() {
  els.authGate.hidden = true;
  els.authError.textContent = "";
  renderLockState(true);
}

function renderLockState(unlocked) {
  els.lockButton.textContent = unlocked ? "🔓" : "🔒";
  els.lockButton.setAttribute("aria-label", unlocked ? t("unlocked") : t("locked"));
  els.lockButton.setAttribute("title", unlocked ? t("unlocked") : t("locked"));
}

function lockApp(message = "") {
  safeStorageRemove(sessionStorage, "codexLanToken");
  safeStorageRemove(localStorage, "codexLanToken");
  state.authToken = "";
  state.config = null;
  state.messagesSignature = "";
  state.pendingMessages = [];
  state.lastMessagesData = null;
  els.rememberDevice.checked = false;
  els.authInput.value = "";
  els.threadCount.textContent = t("needAccessCode");
  els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(t("enterAccessCode"))}</div>`;
  showAuthGate(message);
}

function formatDate(ms) {
  if (!ms) return "";
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) return "";
  return dateFormatter.format(date);
}

function formatMessageDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return dateFormatter.format(date);
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
  return dateFormatter.format(date);
}

function formatWindow(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return t("window");
  if (value % 10080 === 0) return t("weekWindow", { count: value / 10080 });
  if (value % 1440 === 0) return t("dayWindow", { count: value / 1440 });
  if (value % 60 === 0) return t("hourWindow", { count: value / 60 });
  return t("minuteWindow", { count: value });
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

function imageNameFromPath(value) {
  return String(value || "").split(/[\\/]/).filter(Boolean).pop() || "image";
}

function renderMessageImages(message) {
  const inlineImages = Array.isArray(message.images) ? message.images : [];
  const localImages = Array.isArray(message.localImages) ? message.localImages : [];
  if (!inlineImages.length && !localImages.length) return "";
  const inlineHtml = inlineImages
    .map((src) => {
      if (typeof src !== "string" || !src.startsWith("data:image/")) return "";
      return `<img class="message-image" src="${escapeHtml(src)}" alt="" loading="lazy" />`;
    })
    .join("");
  const localHtml = localImages
    .map((imagePath) => `<span class="message-image-pill">${escapeHtml(imageNameFromPath(imagePath))}</span>`)
    .join("");
  return `<div class="message-images">${inlineHtml}${localHtml}</div>`;
}

function mimeTypeForFile(file) {
  if (file.type) return file.type;
  const name = String(file.name || "").toLowerCase();
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  return "";
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t("imageUnsupported")));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Invalid image data"))), type, quality);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(reader.error || new Error("Could not read image")));
    reader.readAsDataURL(blob);
  });
}

async function fileToImageAttachment(file) {
  const mimeType = mimeTypeForFile(file);
  if (!mimeType.startsWith("image/")) return null;

  const image = await loadImageFromFile(file);
  const naturalWidth = image.naturalWidth || 0;
  const naturalHeight = image.naturalHeight || 0;
  if (
    naturalWidth < MIN_IMAGE_EDGE ||
    naturalHeight < MIN_IMAGE_EDGE ||
    naturalWidth > 12000 ||
    naturalHeight > 12000 ||
    naturalWidth * naturalHeight > 60_000_000
  ) {
    throw new Error(t("imageDimensionsInvalid", { min: MIN_IMAGE_EDGE, max: 12000 }));
  }
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  const width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Invalid image data");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const blob = await canvasToBlob(canvas, "image/jpeg", IMAGE_JPEG_QUALITY);
  if (blob.size < 512 || blob.size > MAX_IMAGE_BYTES) {
    throw new Error(t("imageTooLarge", { size: Math.round(MAX_IMAGE_BYTES / 1024 / 1024) }));
  }
  const dataUrl = await blobToDataUrl(blob);
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid image data");
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: (file.name || "image").replace(/\.[^.]*$/, "") + ".jpg",
    mimeType: "image/jpeg",
    size: blob.size,
    dataUrl,
    data: match[2]
  };
}

function renderImageAttachments() {
  els.attachmentTray.hidden = state.imageAttachments.length === 0;
  els.attachmentTray.innerHTML = state.imageAttachments
    .map(
      (image) => `
        <div class="attachment-item">
          <img src="${escapeHtml(image.dataUrl)}" alt="" />
          <span title="${escapeHtml(image.name)}">${escapeHtml(image.name)}</span>
          <button type="button" data-attachment-id="${escapeHtml(image.id)}" aria-label="${escapeHtml(t("removeImage"))}" title="${escapeHtml(t("removeImage"))}">×</button>
        </div>
      `
    )
    .join("");
}

async function addImageFiles(files) {
  const incoming = Array.from(files || []);
  if (!incoming.length) return;
  if (state.imageAttachments.length + incoming.length > MAX_IMAGE_ATTACHMENTS) {
    els.sendStatus.textContent = t("tooManyImages", { count: MAX_IMAGE_ATTACHMENTS });
    return;
  }
  try {
    const attachments = (await Promise.all(incoming.map((file) => fileToImageAttachment(file)))).filter(Boolean);
    state.imageAttachments.push(...attachments);
    els.sendStatus.textContent = "";
    renderImageAttachments();
    renderComposerMode();
  } catch (error) {
    els.sendStatus.textContent = error.message;
  }
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
  els.threadCount.textContent = t("conversationsCount", { count: state.threads.length });
  els.threadList.innerHTML = threads
    .map((thread) => {
      const active = thread.id === state.selectedId ? " active" : "";
      const title = escapeHtml(thread.title || t("untitled"));
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

function isCompactPortrait() {
  return window.matchMedia("(max-width: 760px) and (orientation: portrait)").matches;
}

function closeSidebarOnCompact() {
  if (!isCompactPortrait()) return;
  state.sidebarCollapsed = true;
  renderSidebarState();
}

function initResponsiveSidebar() {
  state.sidebarCollapsed = false;
  renderSidebarState();
}

function roleLabel(message) {
  if (message.role === "assistant") return "Codex";
  if (message.role === "user") return "User";
  if (message.role === "tool") return t("roleTool");
  if (message.role === "interaction") return t("roleInteraction");
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
  if (message.role === "interaction") {
    return `
      <svg class="role-icon-svg interaction-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 9v4"></path>
        <path d="M12 17h.01"></path>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
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
  if (message.role === "user") return t("sent");
  if (message.role === "assistant") {
    const inferredDuration =
      message.durationMs ||
      (previousUserMessage?.timestamp && message.timestamp
        ? new Date(message.timestamp).getTime() - new Date(previousUserMessage.timestamp).getTime()
        : 0);
    const duration = formatDuration(inferredDuration);
    return duration ? `${t("processed")} ${duration}` : t("processed");
  }
  if (message.role === "tool") return message.kind || t("tool");
  if (message.role === "interaction") return message.requiresDesktopAction ? t("interactionRequired") : message.kind || t("roleInteraction");
  return message.kind || "";
}

function normalizedMessageContent(content) {
  return String(content || "").replace(/\r\n/g, "\n").trim();
}

function messageImageCount(message) {
  return (Array.isArray(message.images) ? message.images.length : 0) + (Array.isArray(message.localImages) ? message.localImages.length : 0);
}

function pendingSignature() {
  return state.pendingMessages.map((message) => `${message.id}:${messageImageCount(message)}`).join(",");
}

function pendingMessagesForThread(threadId) {
  return state.pendingMessages.filter((message) => message.threadId === threadId);
}

function mergePendingMessages(data) {
  const threadId = data.thread?.id || state.selectedId;
  const pending = pendingMessagesForThread(threadId);
  if (!pending.length) return data.messages;

  const realUsers = data.messages.filter((message) => message.role === "user");
  const stillPending = pending.filter((pendingMessage) => {
    const pendingText = normalizedMessageContent(pendingMessage.content);
    const pendingImages = messageImageCount(pendingMessage);
    return !realUsers.some((message) => {
      if (normalizedMessageContent(message.content) !== pendingText) return false;
      return messageImageCount(message) >= pendingImages;
    });
  });
  if (stillPending.length !== pending.length) {
    const stillPendingIds = new Set(stillPending.map((message) => message.id));
    state.pendingMessages = state.pendingMessages.filter((message) => message.threadId !== threadId || stillPendingIds.has(message.id));
  }
  return [...data.messages, ...stillPending];
}

function renderCurrentMessages(scrollToBottom = true) {
  const data =
    state.lastMessagesData || {
      thread: state.threads.find((thread) => thread.id === state.selectedId) || null,
      messages: [],
      status: state.threadStatus || { thinking: false }
    };
  renderMessages(data);
  if (scrollToBottom) {
    els.messageList.scrollTop = els.messageList.scrollHeight;
  }
}

function addPendingUserMessage(threadId, content, images = []) {
  const pending = {
    id: `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    threadId,
    role: "user",
    kind: "pending",
    timestamp: new Date().toISOString(),
    content,
    images: images.map((image) => image.dataUrl)
  };
  state.pendingMessages.push(pending);
  state.messagesSignature = "";
  renderCurrentMessages(true);
  return pending.id;
}

function removePendingMessage(id) {
  const previousLength = state.pendingMessages.length;
  state.pendingMessages = state.pendingMessages.filter((message) => message.id !== id);
  if (state.pendingMessages.length !== previousLength) {
    state.messagesSignature = "";
    renderCurrentMessages(true);
  }
}

function renderMessages(data) {
  const selected = state.threads.find((thread) => thread.id === state.selectedId);
  els.threadTitle.textContent = selected?.title || data.thread?.title || t("untitled");
  const displayMessages = mergePendingMessages(data);
  const statusText = data.status?.interactionRequired
    ? `${t("separator")}${t("interactionRequired")}`
    : data.status?.thinking
      ? `${t("separator")}${t("thinking")}`
      : "";
  els.threadMeta.textContent = `${t("contents", { count: displayMessages.length })}${statusText}`;

  if (!displayMessages.length && !data.status?.thinking) {
    els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(t("emptyThread"))}</div>`;
    return;
  }

  let previousUserMessage = null;
  const messageHtml = displayMessages
    .map((message) => {
      const isTool = message.role === "tool";
      const isInteraction = message.role === "interaction";
      const hidden = isTool && !state.showTools ? " hidden" : "";
      const title =
        isTool || isInteraction
          ? `<div class="${isInteraction ? "interaction-title" : "tool-title"}">${escapeHtml(
              isInteraction ? t("interactionDesktopAction") : message.kind
            )}${isTool ? `${t("separator")}${escapeHtml(message.title || "")}` : ""}</div>`
          : "";
      const metaTop = messageMetaTop(message, previousUserMessage);
      const metaBottom = formatMessageDate(message.completedAtMs || message.timestamp);
      if (message.role === "user") previousUserMessage = message;
      return `
        <article class="message ${escapeHtml(message.role)}${message.kind === "pending" ? " pending" : ""}${hidden}">
          <div class="role">${roleBadge(message)}</div>
          <div class="bubble">
            ${metaTop ? `<div class="message-meta message-meta-top">${escapeHtml(metaTop)}</div>` : ""}
            ${title}
            ${message.content ? renderMarkdownLite(message.content) : ""}
            ${renderMessageImages(message)}
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
          <div class="message-meta message-meta-top">${escapeHtml(t("processing"))}</div>
          <p>${escapeHtml(t("thinking").replace("...", ""))}<span class="thinking-dots" aria-hidden="true"></span></p>
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
      <small>${escapeHtml(formatWindow(window.windowMinutes))}${reset ? `${t("separator")}${escapeHtml(t("resetAt", { time: reset }))}` : ""}</small>
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
    ? t("unlimitedCredit")
    : credits?.hasCredits
      ? t("balance", { balance: credits.balance ?? "-" })
      : t("noExtraCredit");
  const updatedAt = formatResetTime(usage?.updatedAt);
  els.accountPanel.innerHTML = usage
    ? `
      <div class="usage-grid">
        ${usageLine(t("primaryUsage"), usage.primary)}
        ${usageLine(t("longTermUsage"), usage.secondary)}
        <div class="usage-row">
          <span>${escapeHtml(t("credit"))}</span>
          <strong>${escapeHtml(creditText)}</strong>
          <small>${updatedAt ? escapeHtml(t("updated", { time: updatedAt })) : escapeHtml(t("latestLocalRecord"))}</small>
        </div>
      </div>
    `
    : `<div class="usage-empty">${escapeHtml(t("noUsage"))}</div>`;
}

function closeAccountPanel() {
  if (!state.accountExpanded) return;
  state.accountExpanded = false;
  renderAccount();
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
  const thinking = Boolean(state.threadStatus?.thinking);
  els.composerInput.disabled = !allowWrite || state.composerBusy;
  els.attachButton.disabled = !allowWrite || state.composerBusy;
  els.sendButton.disabled = !allowWrite || state.composerBusy;
  els.sendButton.classList.toggle("stop-mode", allowWrite && thinking);
  els.sendButton.textContent = allowWrite && thinking ? "■" : t("send");
  els.sendButton.setAttribute("aria-label", allowWrite && thinking ? t("stopCurrentTask") : t("send"));
  els.sendButton.setAttribute("title", allowWrite && thinking ? t("stopCurrentTask") : t("send"));
  els.composerInput.placeholder = allowWrite ? t("sendToCodex") : t("readonlyPlaceholder");
  if (!allowWrite) els.sendStatus.textContent = t("readonly");
  else if (els.sendStatus.textContent === t("readonly")) els.sendStatus.textContent = "";
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

function renderTransientSyncError(error) {
  const selected = state.threads.find((thread) => thread.id === state.selectedId);
  const title = selected?.title || els.threadTitle.textContent || t("selectThread");
  els.threadTitle.textContent = title;
  els.threadMeta.textContent = `${t("syncTemporaryFailed")}${t("separator")}${error.message}`;
}

async function loadMessages(force = false) {
  if (!state.selectedId || state.loadingMessages) return;
  state.loadingMessages = true;
  try {
    const data = await fetchJson(`/api/threads/${state.selectedId}/messages`);
    state.lastMessagesData = data;
    state.threadStatus = data.status || null;
    renderComposerMode();
    const signature = `${data.thread?.updatedAtMs || ""}:${data.size || ""}:${data.mtimeMs || ""}:${state.showTools}:${data.status?.thinking ? "thinking" : "idle"}:${data.status?.interactionRequired ? "interaction" : "clear"}:${data.status?.turnId || ""}:${pendingSignature()}`;
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
    if (error.status === 401) throw error;
    if (state.messagesSignature) {
      renderTransientSyncError(error);
    } else {
      els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
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
      lockApp(state.authToken ? t("accessCodeWrong") : t("enterAccessCode"));
      return;
    }
    els.threadCount.textContent = t("syncFailed");
    if (state.threads.length || state.messagesSignature) {
      renderTransientSyncError(error);
    } else {
      els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  }
}

function refreshSoon(delayMs = 700) {
  setTimeout(() => refresh(true), delayMs);
}

function shouldRefocusComposer() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

els.threadList.addEventListener("click", (event) => {
  const button = event.target.closest(".thread-item");
  if (!button) return;
  state.selectedId = button.dataset.id;
  state.messagesSignature = "";
  state.threadStatus = null;
  state.lastMessagesData = null;
  renderComposerMode();
  renderThreads();
  loadMessages(true);
  closeSidebarOnCompact();
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

els.drawerOverlay.addEventListener("click", () => {
  state.sidebarCollapsed = true;
  renderSidebarState();
});

els.messageList.addEventListener("pointerdown", () => {
  closeSidebarOnCompact();
});

window.addEventListener("resize", () => {
  if (!isCompactPortrait()) {
    state.sidebarCollapsed = false;
    renderSidebarState();
  }
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
  lockApp(t("lockedAgain"));
});

els.accountToggle.addEventListener("click", () => {
  state.accountExpanded = !state.accountExpanded;
  renderAccount();
  if (state.accountExpanded) loadAccount();
});

document.addEventListener("click", (event) => {
  if (!state.accountExpanded) return;
  if (els.accountPanel.contains(event.target) || els.accountToggle.contains(event.target)) return;
  closeAccountPanel();
});

els.authReveal.addEventListener("click", () => {
  const revealed = els.authInput.type === "text";
  els.authInput.type = revealed ? "password" : "text";
  els.authReveal.setAttribute("aria-pressed", String(!revealed));
  els.authReveal.setAttribute("aria-label", revealed ? t("showAccessCode") : t("hideAccessCode"));
  els.authReveal.setAttribute("title", revealed ? t("showAccessCode") : t("hideAccessCode"));
  els.authInput.focus();
});

els.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = els.authInput.value.trim();
  if (!token) {
    showAuthGate(t("enterAccessCode"));
    return;
  }
  state.authToken = token;
  safeStorageRemove(sessionStorage, "codexLanToken");
  if (els.rememberDevice.checked) safeStorageSet(localStorage, "codexLanToken", token);
  else safeStorageRemove(localStorage, "codexLanToken");
  els.authError.textContent = "";
  els.authButton.disabled = true;
  els.authButton.textContent = t("verifying");
  try {
    await loadConfig();
    await refresh(true);
    await loadAccount();
  } catch (error) {
    if (error.status === 401) {
      lockApp(t("accessCodeWrong"));
      return;
    }
    showAuthGate(error.message);
  } finally {
    els.authButton.disabled = false;
    els.authButton.textContent = t("enter");
  }
});

els.composerInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    els.composerForm.requestSubmit();
  }
});

els.attachButton.addEventListener("click", () => {
  if (els.attachButton.disabled) return;
  els.imageInput.click();
});

els.imageInput.addEventListener("change", async (event) => {
  await addImageFiles(event.target.files);
  event.target.value = "";
});

els.attachmentTray.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-attachment-id]");
  if (!button) return;
  state.imageAttachments = state.imageAttachments.filter((image) => image.id !== button.dataset.attachmentId);
  renderImageAttachments();
  renderComposerMode();
});

els.composerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.config?.allowWrite) return;
  if (state.composerBusy) return;
  const thinking = Boolean(state.threadStatus?.thinking);
  const message = els.composerInput.value.trim();
  const images = [...state.imageAttachments];
  if (!thinking && !message && !images.length) return;
  const pendingMessageId = thinking ? null : addPendingUserMessage(state.selectedId, message, images);
  state.composerBusy = true;
  renderComposerMode();
  els.sendStatus.textContent = "";
  try {
    if (thinking) {
      await postJson("/api/interrupt", { threadId: state.selectedId });
      state.threadStatus = { ...(state.threadStatus || {}), thinking: false };
      state.messagesSignature = "";
      renderComposerMode();
      refreshSoon();
    } else {
      const result = await postJson("/api/send", {
        message,
        threadId: state.selectedId,
        images: images.map(({ name, mimeType, data }) => ({ name, mimeType, data }))
      });
      els.composerInput.value = "";
      state.imageAttachments = [];
      renderImageAttachments();
      state.threadStatus = { ...(state.threadStatus || {}), thinking: true, turnId: result.turnId || state.threadStatus?.turnId || null };
      renderComposerMode();
      refreshSoon(1200);
    }
  } catch (error) {
    if (pendingMessageId) removePendingMessage(pendingMessageId);
    if (!thinking && /image/i.test(error.message || "")) {
      state.imageAttachments = [];
      els.imageInput.value = "";
      renderImageAttachments();
    }
    els.sendStatus.textContent = t(thinking ? "interruptFailed" : "sendFailed", { message: error.message });
  } finally {
    state.composerBusy = false;
    renderComposerMode();
    if (!thinking && shouldRefocusComposer()) els.composerInput.focus();
  }
});

applyStaticText();
initAuthToken();
initResponsiveSidebar();
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
