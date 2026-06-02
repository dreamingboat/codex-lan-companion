const state = {
  threads: [],
  selectedId: null,
  draftThread: null,
  messagesSignature: "",
  filter: "",
  showTools: false,
  expandedNotices: {},
  sidebarCollapsed: false,
  loadingMessages: false,
  account: null,
  accountExpanded: false,
  config: null,
  codexHome: "",
  codexHomeVersion: null,
  draftStartedAt: 0,
  authToken: "",
  threadStatus: null,
  composerBusy: false,
  imageAttachments: [],
  pendingMessages: [],
  approvalSubmissions: {},
  lastMessagesData: null,
  plugins: [],
  pluginsLoaded: false,
  pluginsLoading: false,
  pluginMenuOpen: false,
  pluginQuery: "",
  pluginTriggerStart: -1,
  pluginActiveIndex: 0,
  selectedPlugins: []
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
  newThreadButton: document.querySelector("#newThreadButton"),
  toolToggle: document.querySelector("#toolToggle"),
  lockButton: document.querySelector("#lockButton"),
  composerForm: document.querySelector("#composerForm"),
  composerInput: document.querySelector("#composerInput"),
  pluginMentionTray: document.querySelector("#pluginMentionTray"),
  pluginMentionMenu: document.querySelector("#pluginMentionMenu"),
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
    newConversation: "新对话",
    newConversationDraft: "新对话",
    newConversationReady: "输入消息开始新对话。",
    newConversationFailed: "新建对话失败：{message}",
    threadList: "对话列表",
    selectThread: "选择一个对话",
    syncEvery: "每 3 秒自动同步",
    pickThread: "从左侧选择一个 Codex 对话。",
    tool: "工具",
    roleTool: "工具",
    roleInteraction: "交互",
    roleNotice: "提示",
    expandNotice: "展开",
    collapseNotice: "收起",
    interactionRequired: "需要处理",
    interactionDesktopAction: "请在桌面 Codex 处理",
    approvalYes: "是",
    approvalNo: "否",
    approvalAlways: "一直是",
    approvalSending: "正在提交审批...",
    approvalDone: "审批已提交",
    approvalFailed: "审批提交失败：{message}",
    desktopMayNeedAttention: "可能需要桌面处理",
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
    busyCannotSend: "Codex 正在处理。请先停止当前任务，再发送这条消息。",
    pluginPickerTitle: "引用插件",
    pluginPickerLoading: "正在加载插件...",
    pluginPickerEmpty: "没有找到匹配插件",
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
    newConversation: "New chat",
    newConversationDraft: "New chat",
    newConversationReady: "Type a message to start a new chat.",
    newConversationFailed: "Could not start a new chat: {message}",
    threadList: "Conversation list",
    selectThread: "Select a conversation",
    syncEvery: "Auto-syncs every 3 seconds",
    pickThread: "Select a Codex conversation from the left.",
    tool: "Tools",
    roleTool: "Tool",
    roleInteraction: "Interaction",
    roleNotice: "Notice",
    expandNotice: "Expand",
    collapseNotice: "Collapse",
    interactionRequired: "Action required",
    interactionDesktopAction: "Handle this in Codex desktop",
    approvalYes: "Yes",
    approvalNo: "No",
    approvalAlways: "Always",
    approvalSending: "Submitting approval...",
    approvalDone: "Approval submitted",
    approvalFailed: "Approval failed: {message}",
    desktopMayNeedAttention: "Desktop may need attention",
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
    busyCannotSend: "Codex is still processing. Stop the current task before sending this message.",
    pluginPickerTitle: "Mention plugin",
    pluginPickerLoading: "Loading plugins...",
    pluginPickerEmpty: "No matching plugins",
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
const DRAFT_THREAD_ID = "__new_thread__";
const DRAFT_LOCK_MS = 10 * 60 * 1000;

function hasActiveDraft() {
  return state.selectedId === DRAFT_THREAD_ID && state.draftThread && Date.now() - state.draftStartedAt < DRAFT_LOCK_MS;
}

function clearDraftThread() {
  state.draftThread = null;
  state.draftStartedAt = 0;
}

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
  els.refreshButton.setAttribute("aria-label", t("refresh"));
  els.sidebarCloseButton?.setAttribute("title", t("hideThreads"));
  els.sidebarCloseButton?.setAttribute("aria-label", t("hideThreads"));
  els.searchInput.placeholder = t("searchThreads");
  document.querySelector("#newThreadLabel").textContent = t("newConversation");
  els.threadList.setAttribute("aria-label", t("threadList"));
  els.threadTitle.textContent = t("selectThread");
  els.threadMeta.textContent = t("syncEvery");
  document.querySelector("#toolToggleLabel").textContent = "🔧";
  document.querySelector(".toggle").setAttribute("title", t("tool"));
  document.querySelector(".toggle").setAttribute("aria-label", t("tool"));
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

function renderApprovalActions(message) {
  if (message.role !== "interaction" || !message.canApprove || !message.requestId) return "";
  const submission = state.approvalSubmissions[approvalSubmissionKey(state.selectedId, message.requestId)];
  if (submission?.status === "submitted") {
    return `<div class="approval-result">${escapeHtml(t("approvalDone"))}</div>`;
  }
  if (submission?.status === "submitting") {
    return `<div class="approval-result pending">${escapeHtml(t("approvalSending"))}</div>`;
  }
  const requestId = escapeHtml(String(message.requestId));
  const approvalKind = escapeHtml(String(message.approvalKind || "command"));
  const buttons = [
    ["accept", "approvalYes", "primary"],
    ["decline", "approvalNo", "secondary"],
    ["acceptForSession", "approvalAlways", "primary"]
  ];
  return `
    <div class="approval-actions" data-request-id="${requestId}" data-approval-kind="${approvalKind}">
      ${buttons
        .map(
          ([decision, labelKey, tone]) =>
            `<button class="approval-action ${tone}" type="button" data-decision="${escapeHtml(decision)}">${escapeHtml(t(labelKey))}</button>`
        )
        .join("")}
    </div>
  `;
}

function approvalSubmissionKey(threadId, requestId) {
  return `${threadId || ""}:${requestId || ""}`;
}

function isImportantNotice(message) {
  if (message.role !== "notice") return false;
  const kind = String(message.kind || "").toLowerCase();
  const title = String(message.title || "").toLowerCase();
  const content = String(message.content || "").toLowerCase();
  if (kind === "info" || title === "notice") return false;
  if (title.includes("approval dismissed") || content.includes("rejected by user")) return false;
  if (kind === "error") return true;
  const text = [title, content].filter(Boolean).join(" ");
  return (
    text.includes("limit") ||
    text.includes("quota") ||
    text.includes("usage_limit") ||
    text.includes("usage limit") ||
    text.includes("rate_limit") ||
    text.includes("rate limit") ||
    text.includes("plan_limit") ||
    text.includes("plan limit")
  );
}

function noticeCollapseKey(message) {
  return String(message.lineNumber || message.id || `${message.timestamp || ""}:${message.title || ""}:${message.content || ""}`);
}

function renderNoticeTitle(message, collapsed, noticeKey) {
  return `
    <div class="notice-title-row">
      <div class="notice-title">${escapeHtml(message.title || t("roleNotice"))}</div>
      ${
        isImportantNotice(message)
          ? ""
          : `<button class="notice-collapse-button" type="button" data-notice-key="${escapeHtml(noticeKey)}">${escapeHtml(
              collapsed ? t("expandNotice") : t("collapseNotice")
            )}</button>`
      }
    </div>
  `;
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

function pluginDisplayNameFromUri(uri) {
  const name = String(uri || "")
    .replace(/^plugin:\/\//, "")
    .split("@")[0]
    .trim();
  if (!name) return "Plugin";
  const plugin = state.plugins.find((item) => item.uri === uri || item.name === name);
  return plugin?.displayName || name;
}

function pluginIconHtml(plugin, className = "plugin-chip-icon") {
  if (plugin?.iconDataUrl) {
    return `<img class="${className}" src="${escapeHtml(plugin.iconDataUrl)}" alt="" />`;
  }
  const label = String(plugin?.displayName || plugin?.name || "P").trim().slice(0, 1).toUpperCase() || "P";
  return `<span class="${className} fallback" aria-hidden="true">${escapeHtml(label)}</span>`;
}

function pluginMentionMarkdown(plugin) {
  if (!plugin?.uri) return "";
  return `[@${plugin.displayName || plugin.name}](${plugin.uri})`;
}

function renderInlinePluginRefs(html) {
  return html.replace(/\[@([^\]\n]+)\]\((plugin:\/\/[^)\s]+)\)/g, (_match, label, uri) => {
    const plugin = state.plugins.find((item) => item.uri === uri);
    const displayName = plugin?.displayName || label || pluginDisplayNameFromUri(uri);
    return `<span class="message-plugin-ref">${pluginIconHtml(plugin || { displayName }, "message-plugin-icon")}${escapeHtml(displayName)}</span>`;
  });
}

function renderMarkdownLite(text) {
  const escaped = escapeHtml(text || "");
  const withPluginRefs = renderInlinePluginRefs(escaped);
  const withCodeBlocks = withPluginRefs.replace(/```([\s\S]*?)```/g, (_match, code) => `<pre><code>${code.trim()}</code></pre>`);
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
  const threads = state.draftThread ? [state.draftThread, ...state.threads] : state.threads;
  if (!query) return threads;
  return threads.filter((thread) => {
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
        <button class="thread-item${active}${thread.id === DRAFT_THREAD_ID ? " draft" : ""}" data-id="${thread.id}">
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
  if (message.role === "notice") return t("roleNotice");
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
  if (message.role === "notice") {
    return `
      <svg class="role-icon-svg notice-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9"></circle>
        <path d="M12 8h.01"></path>
        <path d="M11 12h1v4h1"></path>
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
  if (message.role === "notice") return message.kind || t("roleNotice");
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
    const pendingText = normalizedMessageContent(pendingMessage.sentContent || pendingMessage.content);
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
      thread: state.selectedId === DRAFT_THREAD_ID ? state.draftThread : state.threads.find((thread) => thread.id === state.selectedId) || null,
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
    sentContent: content,
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
  const selected = state.selectedId === DRAFT_THREAD_ID ? state.draftThread : state.threads.find((thread) => thread.id === state.selectedId);
  els.threadTitle.textContent = selected?.title || data.thread?.title || t("untitled");
  const displayMessages = mergePendingMessages(data);
  const statusText = data.status?.interactionRequired
    ? `${t("separator")}${t("interactionRequired")}`
    : data.status?.possibleDesktopAttention
      ? `${t("separator")}${t("desktopMayNeedAttention")}`
      : data.status?.thinking
        ? `${t("separator")}${t("thinking")}`
        : "";
  els.threadMeta.textContent = `${t("contents", { count: displayMessages.length })}${statusText}`;

  if (!displayMessages.length && !data.status?.thinking) {
    els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(state.selectedId === DRAFT_THREAD_ID ? t("newConversationReady") : t("emptyThread"))}</div>`;
    return;
  }

  let previousUserMessage = null;
  const messageHtml = displayMessages
    .map((message) => {
      const isTool = message.role === "tool";
      const isInteraction = message.role === "interaction";
      const isNotice = message.role === "notice";
      const noticeKey = isNotice ? noticeCollapseKey(message) : "";
      const noticeCollapsed = isNotice && !isImportantNotice(message) && !state.expandedNotices[noticeKey];
      const hidden = isTool && !state.showTools ? " hidden" : "";
      const title =
        isNotice
          ? renderNoticeTitle(message, noticeCollapsed, noticeKey)
          : isTool || isInteraction
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
            ${message.content && !noticeCollapsed ? renderMarkdownLite(message.content) : ""}
            ${!noticeCollapsed ? renderMessageImages(message) : ""}
            ${renderApprovalActions(message)}
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
          <p>${escapeHtml((data.status?.possibleDesktopAttention ? t("desktopMayNeedAttention") : t("thinking").replace("...", "")))}<span class="thinking-dots" aria-hidden="true"></span></p>
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
    applyHomeContext(state.account);
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

async function loadPlugins() {
  if (state.pluginsLoaded || state.pluginsLoading) return;
  state.pluginsLoading = true;
  renderPluginMentionMenu();
  try {
    const data = await fetchJson("/api/plugins");
    applyHomeContext(data);
    state.plugins = Array.isArray(data.plugins) ? data.plugins : [];
    state.pluginsLoaded = true;
  } catch {
    state.plugins = [];
  } finally {
    state.pluginsLoading = false;
    renderPluginMentionMenu();
  }
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

function pluginMentionMatch() {
  const input = els.composerInput;
  const cursor = input.selectionStart ?? 0;
  const before = input.value.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  const prefix = before.slice(Math.max(0, at - 1), at);
  if (prefix && !/\s/.test(prefix)) return null;
  const query = before.slice(at + 1);
  if (/[\n\r()[\]{}<>]/.test(query) || query.length > 48) return null;
  return { start: at, end: cursor, query };
}

function filteredPlugins() {
  const query = state.pluginQuery.trim().toLowerCase();
  const plugins = state.plugins || [];
  if (!query) return plugins.slice(0, 12);
  return plugins
    .map((plugin) => {
      const displayName = String(plugin.displayName || "").toLowerCase();
      const name = String(plugin.name || "").toLowerCase();
      const marketplace = String(plugin.marketplace || "").toLowerCase();
      const description = String(plugin.description || "").toLowerCase();
      let score = 0;
      if (displayName === query || name === query) score = 100;
      else if (displayName.startsWith(query) || name.startsWith(query)) score = 80;
      else if (displayName.includes(query) || name.includes(query)) score = 60;
      else if (marketplace.includes(query)) score = 30;
      else if (description.includes(query)) score = 10;
      return { plugin, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (a.plugin.displayName || a.plugin.name).localeCompare(b.plugin.displayName || b.plugin.name, undefined, { sensitivity: "base" }))
    .map((item) => item.plugin)
    .slice(0, 12);
}

function closePluginMentionMenu() {
  state.pluginMenuOpen = false;
  state.pluginQuery = "";
  state.pluginTriggerStart = -1;
  state.pluginActiveIndex = 0;
  if (els.pluginMentionMenu) {
    els.pluginMentionMenu.hidden = true;
    els.pluginMentionMenu.innerHTML = "";
  }
}

function renderSelectedPlugins() {
  if (!els.pluginMentionTray) return;
  els.pluginMentionTray.hidden = state.selectedPlugins.length === 0;
  els.pluginMentionTray.innerHTML = state.selectedPlugins
    .map(
      (plugin) => `
        <button class="plugin-chip" type="button" data-plugin-uri="${escapeHtml(plugin.uri)}" title="${escapeHtml(plugin.displayName || plugin.name)}">
          ${pluginIconHtml(plugin)}
          <span>${escapeHtml(plugin.displayName || plugin.name)}</span>
          <small aria-hidden="true">×</small>
        </button>
      `
    )
    .join("");
}

function clearSelectedPlugins() {
  state.selectedPlugins = [];
  renderSelectedPlugins();
}

function selectedPluginMarkdown() {
  return state.selectedPlugins.map((plugin) => pluginMentionMarkdown(plugin)).filter(Boolean).join(" ");
}

function composerSendMessage(message) {
  return [selectedPluginMarkdown(), message.trim()].filter(Boolean).join("\n\n").trim();
}

function renderPluginMentionMenu() {
  if (!els.pluginMentionMenu || !state.pluginMenuOpen) return;
  if (state.pluginsLoading) {
    els.pluginMentionMenu.hidden = false;
    els.pluginMentionMenu.innerHTML = `<div class="plugin-mention-state">${escapeHtml(t("pluginPickerLoading"))}</div>`;
    return;
  }
  const plugins = filteredPlugins();
  state.pluginActiveIndex = Math.max(0, Math.min(state.pluginActiveIndex, Math.max(plugins.length - 1, 0)));
  els.pluginMentionMenu.hidden = false;
  if (!plugins.length) {
    els.pluginMentionMenu.innerHTML = `<div class="plugin-mention-state">${escapeHtml(t("pluginPickerEmpty"))}</div>`;
    return;
  }
  els.pluginMentionMenu.innerHTML = `
    <div class="plugin-mention-heading">${escapeHtml(t("pluginPickerTitle"))}</div>
    ${plugins
      .map((plugin, index) => {
        const active = index === state.pluginActiveIndex ? " active" : "";
        const description = plugin.description ? `<span>${escapeHtml(plugin.description)}</span>` : `<span>${escapeHtml(plugin.uri || "")}</span>`;
        return `
          <button
            class="plugin-mention-item${active}"
            type="button"
            role="option"
            aria-selected="${index === state.pluginActiveIndex ? "true" : "false"}"
            data-plugin-index="${index}"
          >
            ${pluginIconHtml(plugin, "plugin-mention-icon")}
            <strong>${escapeHtml(plugin.displayName || plugin.name)}</strong>
            ${description}
          </button>
        `;
      })
      .join("")}
  `;
}

function updatePluginMentionMenu() {
  if (els.composerInput.disabled) {
    closePluginMentionMenu();
    return;
  }
  const match = pluginMentionMatch();
  if (!match) {
    closePluginMentionMenu();
    return;
  }
  state.pluginMenuOpen = true;
  state.pluginQuery = match.query;
  state.pluginTriggerStart = match.start;
  renderPluginMentionMenu();
  loadPlugins().catch(() => {});
}

function insertPluginMention(plugin) {
  if (!plugin?.uri) return;
  const input = els.composerInput;
  const cursor = input.selectionStart ?? input.value.length;
  const start = state.pluginTriggerStart >= 0 ? state.pluginTriggerStart : cursor;
  const separator = input.value.slice(cursor).startsWith(" ") || cursor === input.value.length ? "" : " ";
  const nextValue = `${input.value.slice(0, start)}${separator}${input.value.slice(cursor)}`;
  const nextCursor = start + separator.length;
  input.value = nextValue;
  input.setSelectionRange(nextCursor, nextCursor);
  if (!state.selectedPlugins.some((item) => item.uri === plugin.uri)) {
    state.selectedPlugins.push(plugin);
    renderSelectedPlugins();
  }
  closePluginMentionMenu();
  input.focus();
}

function selectActivePluginMention() {
  if (!state.pluginMenuOpen || state.pluginsLoading) return false;
  const plugin = filteredPlugins()[state.pluginActiveIndex];
  if (!plugin) return false;
  insertPluginMention(plugin);
  return true;
}

function renderComposerMode() {
  const allowWrite = Boolean(state.config?.allowWrite);
  const thinking = Boolean(state.threadStatus?.thinking);
  const hasTarget = Boolean(state.selectedId);
  els.composerInput.disabled = !allowWrite || state.composerBusy || !hasTarget;
  els.attachButton.disabled = !allowWrite || state.composerBusy || !hasTarget;
  els.sendButton.disabled = !allowWrite || state.composerBusy || !hasTarget;
  els.sendButton.classList.toggle("stop-mode", allowWrite && thinking);
  els.sendButton.textContent = allowWrite && thinking ? "■" : t("send");
  els.sendButton.setAttribute("aria-label", allowWrite && thinking ? t("stopCurrentTask") : t("send"));
  els.sendButton.setAttribute("title", allowWrite && thinking ? t("stopCurrentTask") : t("send"));
  els.composerInput.placeholder = allowWrite ? (state.selectedId === DRAFT_THREAD_ID ? t("newConversationReady") : t("sendToCodex")) : t("readonlyPlaceholder");
  if (!allowWrite) els.sendStatus.textContent = t("readonly");
  else if (els.sendStatus.textContent === t("readonly")) els.sendStatus.textContent = "";
  if (els.composerInput.disabled) closePluginMentionMenu();
}

async function loadConfig() {
  state.config = await fetchJson("/api/health");
  applyHomeContext(state.config);
  hideAuthGate();
  renderComposerMode();
}

function applyHomeContext(data) {
  if (!data || data.codexHomeVersion == null) return false;
  const version = Number(data.codexHomeVersion);
  const changed = state.codexHomeVersion != null && Number.isFinite(version) && version !== state.codexHomeVersion;
  state.codexHome = data.codexHome || state.codexHome;
  state.codexHomeVersion = Number.isFinite(version) ? version : state.codexHomeVersion;
  if (!changed) return false;
  if (!hasActiveDraft()) clearDraftThread();
  state.messagesSignature = "";
  state.threadStatus = null;
  state.pendingMessages = [];
  state.approvalSubmissions = {};
  state.expandedNotices = {};
  state.lastMessagesData = null;
  state.plugins = [];
  state.pluginsLoaded = false;
  state.pluginsLoading = false;
  clearSelectedPlugins();
  closePluginMentionMenu();
  els.messageList.innerHTML = `<div class="empty-state">${escapeHtml(t("loading"))}</div>`;
  return true;
}

async function loadThreads() {
  const query = state.selectedId ? `?selectedId=${encodeURIComponent(state.selectedId)}` : "";
  const data = await fetchJson(`/api/threads${query}`);
  const homeChanged = applyHomeContext(data);
  if (homeChanged) loadAccount().catch(() => {});
  state.threads = data.threads || [];
  const isDraftSelected = hasActiveDraft();
  if (!isDraftSelected && (homeChanged || !state.threads.some((thread) => thread.id === state.selectedId)) && state.threads[0]) {
    state.selectedId = state.threads[0].id;
  }
  if (!state.threads.length && !isDraftSelected) {
    state.selectedId = null;
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
  if (state.selectedId === DRAFT_THREAD_ID) {
    state.lastMessagesData = {
      thread: state.draftThread,
      messages: [],
      status: { thinking: false }
    };
    state.threadStatus = state.lastMessagesData.status;
    renderComposerMode();
    renderMessages(state.lastMessagesData);
    return;
  }
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
  if (state.selectedId !== DRAFT_THREAD_ID) clearDraftThread();
  clearSelectedPlugins();
  state.messagesSignature = "";
  state.threadStatus = null;
  state.lastMessagesData = null;
  els.sendStatus.textContent = "";
  renderComposerMode();
  renderThreads();
  loadMessages(true);
  closeSidebarOnCompact();
});

els.newThreadButton.addEventListener("click", () => {
  if (!state.config?.allowWrite || els.newThreadButton.disabled) return;
  els.sendStatus.textContent = "";
  clearSelectedPlugins();
  state.draftThread = {
    id: DRAFT_THREAD_ID,
    title: t("newConversationDraft"),
    preview: "",
    cwd: ""
  };
  state.draftStartedAt = Date.now();
  state.selectedId = DRAFT_THREAD_ID;
  state.messagesSignature = "";
  state.threadStatus = { thinking: false };
  state.lastMessagesData = {
    thread: state.draftThread,
    messages: [],
    status: state.threadStatus
  };
  renderThreads();
  renderCurrentMessages(true);
  renderComposerMode();
  closeSidebarOnCompact();
  if (shouldRefocusComposer()) els.composerInput.focus();
});

els.refreshButton.addEventListener("click", () => refresh(true));

els.sidebarCloseButton?.addEventListener("click", () => {
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

els.messageList.addEventListener("click", async (event) => {
  const noticeButton = event.target.closest(".notice-collapse-button");
  if (noticeButton) {
    event.preventDefault();
    event.stopPropagation();
    const key = noticeButton.dataset.noticeKey || "";
    if (!key) return;
    state.expandedNotices[key] = !state.expandedNotices[key];
    renderCurrentMessages(false);
    return;
  }

  const button = event.target.closest(".approval-action");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  if (!state.config?.allowWrite || button.disabled) return;
  const container = button.closest(".approval-actions");
  const requestId = container?.dataset.requestId || "";
  const approvalKind = container?.dataset.approvalKind || "command";
  const decision = button.dataset.decision || "";
  if (!requestId || !decision) return;
  const submissionKey = approvalSubmissionKey(state.selectedId, requestId);
  const buttons = [...container.querySelectorAll(".approval-action")];
  buttons.forEach((item) => {
    item.disabled = true;
  });
  state.approvalSubmissions[submissionKey] = { status: "submitting", decision };
  container.outerHTML = `<div class="approval-result pending">${escapeHtml(t("approvalSending"))}</div>`;
  try {
    await postJson("/api/approval", {
      threadId: state.selectedId,
      requestId,
      approvalKind,
      decision
    });
    state.approvalSubmissions[submissionKey] = { status: "submitted", decision };
    state.messagesSignature = "";
    if (els.sendStatus.textContent === t("approvalSending") || els.sendStatus.textContent === t("approvalDone")) {
      els.sendStatus.textContent = "";
    }
    renderCurrentMessages(false);
    refreshSoon(700);
  } catch (error) {
    delete state.approvalSubmissions[submissionKey];
    buttons.forEach((item) => {
      item.disabled = false;
    });
    els.sendStatus.textContent = t("approvalFailed", { message: error.message });
    state.messagesSignature = "";
    refreshSoon(700);
  }
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
  if (state.pluginMenuOpen) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = filteredPlugins().length;
      if (count) {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        state.pluginActiveIndex = (state.pluginActiveIndex + delta + count) % count;
        renderPluginMentionMenu();
      }
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      if (selectActivePluginMention()) {
        event.preventDefault();
        return;
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closePluginMentionMenu();
      return;
    }
  }
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    els.composerForm.requestSubmit();
  }
});

els.composerInput.addEventListener("input", () => {
  state.pluginActiveIndex = 0;
  updatePluginMentionMenu();
});

els.composerInput.addEventListener("click", () => {
  updatePluginMentionMenu();
});

els.composerInput.addEventListener("blur", () => {
  window.setTimeout(() => {
    if (!els.pluginMentionMenu?.contains(document.activeElement)) closePluginMentionMenu();
  }, 120);
});

els.pluginMentionMenu?.addEventListener("mousedown", (event) => {
  event.preventDefault();
});

els.pluginMentionMenu?.addEventListener("click", (event) => {
  const button = event.target.closest(".plugin-mention-item");
  if (!button) return;
  const plugin = filteredPlugins()[Number(button.dataset.pluginIndex)];
  insertPluginMention(plugin);
});

els.pluginMentionTray?.addEventListener("click", (event) => {
  const button = event.target.closest(".plugin-chip");
  if (!button) return;
  state.selectedPlugins = state.selectedPlugins.filter((plugin) => plugin.uri !== button.dataset.pluginUri);
  renderSelectedPlugins();
  els.composerInput.focus();
});

els.attachButton.addEventListener("click", () => {
  if (els.attachButton.disabled) return;
  closePluginMentionMenu();
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
  closePluginMentionMenu();
  if (!state.config?.allowWrite) return;
  if (state.composerBusy) return;
  const thinking = Boolean(state.threadStatus?.thinking);
  const isDraftThread = state.selectedId === DRAFT_THREAD_ID;
  const message = els.composerInput.value.trim();
  const sendMessage = composerSendMessage(message);
  const images = [...state.imageAttachments];
  if (!thinking && !sendMessage && !images.length) return;
  if (thinking && (sendMessage || images.length)) {
    els.sendStatus.textContent = t("busyCannotSend");
    return;
  }
  const pendingMessageId = thinking || isDraftThread ? null : addPendingUserMessage(state.selectedId, sendMessage, images);
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
        message: sendMessage,
        threadId: isDraftThread ? null : state.selectedId,
        newThread: isDraftThread,
        images: images.map(({ name, mimeType, data }) => ({ name, mimeType, data }))
      });
      els.composerInput.value = "";
      clearSelectedPlugins();
      state.imageAttachments = [];
      renderImageAttachments();
      if (isDraftThread && result.threadId) {
        clearDraftThread();
        state.selectedId = result.threadId;
        state.pendingMessages = state.pendingMessages.filter((pending) => pending.id !== pendingMessageId);
        await loadThreads();
      }
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
