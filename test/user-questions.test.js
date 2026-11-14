import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = await fs.readFile(new URL("../server.js", import.meta.url), "utf8");
const client = await fs.readFile(new URL("../public/app.js", import.meta.url), "utf8");
const section = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));
const questionId = JSON.stringify(["request_user_input_async", "call-question", 0]);
const payload = {
  type: "function_call", id: "fc-not-the-question-id", status: "completed",
  name: "request_user_input_async", call_id: "call-question",
  arguments: JSON.stringify({ questions: [{ title: "Choose a voice", options: ["Local voice", "My recording"] }] })
};
const helpers = vm.runInNewContext([
  section(source, "function compact(", "function messageSortCompare("),
  section(source, "function messageSortCompare(", "const NOTICE_TYPE_PATTERNS"),
  "({messageFromInteractionEvent, interactionDedupeKey, dedupeInteractionMessages, resolveUserQuestionMessages, questionAnswersFromText, limitMessagesForClient})"
].join("\n"), { DEFAULT_MESSAGE_LIMIT: 80, MAX_MESSAGE_LIMIT: 1000 });

test("async questions use call IDs and remain pending after the tool call completes", () => {
  const message = helpers.messageFromInteractionEvent(null, payload, { turnId: "turn" });
  assert.equal(message.kind, "user_question");
  assert.equal(message.questions[0].id, questionId);
  assert.equal(message.questions[0].title, "Choose a voice");
  assert.equal(message.questions[0].options[0], "Local voice");
  assert.equal(message.questions[0].status, "pending");
  assert.equal(message.canApprove, false);
  assert.equal(message.requiresDesktopAction, false);
  assert.doesNotMatch(message.content, /function_call|fc-not/);
});

test("the native completed-item event and tool record deduplicate into one question card", () => {
  const tool = helpers.messageFromInteractionEvent("time", payload);
  const event = helpers.messageFromInteractionEvent("time", { type: "item_completed", item: {
    type: "AgentMessage", id: "call-question", questions: [{ title: "Choose a voice", options: ["Local voice", "My recording"] }]
  } });
  assert.equal(event.questions[0].id, questionId);
  assert.equal(helpers.dedupeInteractionMessages([tool, event]).length, 1);
});

test("malformed questions never become fake approval cards, while real approvals remain actionable", () => {
  for (const argumentsValue of ["bad JSON", "{}", '{"questions":[]}', '{"questions":[{"title":"","options":[]}]}', '{"questions":[{"title":"Q","options":[{}]}]}']) {
    assert.equal(helpers.messageFromInteractionEvent(null, { ...payload, arguments: argumentsValue }), null);
  }
  const approval = helpers.messageFromInteractionEvent(null, { type: "function_call", name: "exec_command", call_id: "approval", arguments: JSON.stringify({ cmd: "test", sandbox_permissions: "require_escalated" }) });
  assert.equal(approval.canApprove, true);
  assert.equal(approval.approvalKind, "command");
});

test("question IDs include the question index and allow free-text-only questions", () => {
  const message = helpers.messageFromInteractionEvent(null, { ...payload, arguments: JSON.stringify({ questions: [{ title: "First" }, { title: "Second", options: [] }] }) });
  assert.equal(message.questions.length, 2);
  assert.equal(message.questions[0].options.length, 0);
  assert.equal(message.questions[1].id, JSON.stringify(["request_user_input_async", "call-question", 1]));
});

test("native replies mark only the matching question answered and display friendly user text", () => {
  const question = helpers.messageFromInteractionEvent(null, payload);
  const reply = { role: "user", content: `<send_user_message_question_reply>\n${JSON.stringify([{ questionItemId: questionId, question: "Choose a voice", answer: "Local voice" }])}\n</send_user_message_question_reply>` };
  const messages = helpers.resolveUserQuestionMessages([question, reply]);
  assert.equal(messages[0].questions[0].status, "answered");
  assert.equal(messages[0].questions[0].answer, "Local voice");
  assert.equal(messages[1].content, "Choose a voice\nLocal voice");
  assert.equal(question.questions[0].status, "pending");
  assert.equal(helpers.questionAnswersFromText("Discuss <send_user_message_question_reply> literally").length, 0);
});

test("history, active-turn steering, submitted cache and answer retention have distinct states", () => {
  const question = helpers.messageFromInteractionEvent(null, payload, { turnId: "first" });
  assert.equal(helpers.resolveUserQuestionMessages([question, { role: "user", turnId: "second", content: "Next topic" }])[0].questions[0].status, "expired");
  assert.equal(helpers.resolveUserQuestionMessages([question, { role: "user", turnId: "first", content: "More guidance" }])[0].questions[0].status, "pending");
  assert.equal(helpers.resolveUserQuestionMessages([question], new Map([[questionId, "Accepted"]]))[0].questions[0].status, "answered");
  const visible = helpers.limitMessagesForClient([question, ...Array.from({ length: 90 }, (_, index) => ({ role: "assistant", lineNumber: index + 1, content: "text" }))]);
  assert.equal(visible.messages.some((message) => message.kind === "user_question"), true);
});

function endpoint(overrides = {}) {
  const submissions = new Map();
  const calls = [];
  const question = { id: questionId, title: "Choose a voice", options: ["Local voice"], status: "pending" };
  const context = {
    ALLOW_WRITE: true, userQuestionSubmissions: submissions,
    codexHomeState: { home: "/codex", version: 1 },
    refreshCodexHomeContext: async () => {},
    getMessages: async () => ({ status: { thinking: false }, messages: [{ kind: "user_question", questions: [question] }] }),
    sendToCodex: async (...args) => { calls.push(args); return { ok: true, mode: "desktop-ipc" }; },
    steerCodexTurn: async (args) => { calls.push(args); return { ok: true, mode: "desktop-ipc" }; },
    ...overrides
  };
  const answer = vm.runInNewContext(`${section(source, "async function answerUserQuestions(", "function normalizeApprovalDecision(")}\nanswerUserQuestions`, context);
  return { answer, calls, submissions, question, context };
}
const request = { threadId: "thread", answers: [{ questionItemId: questionId, answer: "Local voice" }] };

test("answers use Desktop's exact reply envelope and server-side question text", async () => {
  const api = endpoint();
  const result = await api.answer(request);
  assert.equal(result.ok, true);
  assert.equal(api.calls.length, 1);
  const [text, threadId] = api.calls[0];
  assert.equal(threadId, "thread");
  assert.equal(api.calls[0][3].allowAppServerFallback, false);
  const replies = helpers.questionAnswersFromText(text);
  assert.equal(replies[0].questionItemId, questionId);
  assert.equal(replies[0].question, "Choose a voice");
  assert.equal(replies[0].answer, "Local voice");
  assert.equal(api.submissions.get(questionId).status, "submitted");
  assert.equal((await api.answer(request)).alreadyAnswered, true);
  assert.equal(api.calls.length, 1);
});

test("during an active task the same reply goes through Desktop steering", async () => {
  const api = endpoint({ getMessages: async () => ({ status: { thinking: true, turnId: "active" }, messages: [{ kind: "user_question", questions: [{ id: questionId, title: "Q", status: "pending" }] }] }) });
  await api.answer(request);
  assert.equal(api.calls[0].turnId, "active");
  assert.equal(helpers.questionAnswersFromText(api.calls[0].message)[0].answer, "Local voice");
});

test("invalid, expired, cross-conversation and readonly answers do not send anything", async () => {
  const api = endpoint();
  for (const invalid of [undefined, {}, { threadId: "thread", answers: [] }, { threadId: "thread", answers: [{ questionItemId: questionId, answer: "  " }] }, { ...request, answers: [request.answers[0], request.answers[0]] }, { ...request, answers: [{ questionItemId: "other-question", answer: "yes" }] }]) {
    await assert.rejects(api.answer(invalid), (error) => [400, 409].includes(error.status));
  }
  api.question.status = "expired";
  await assert.rejects(api.answer(request), (error) => error.status === 409);
  assert.equal(api.calls.length, 0);
  const readonly = endpoint({ ALLOW_WRITE: false });
  await assert.rejects(readonly.answer(request), (error) => error.status === 403);
  assert.equal(readonly.calls.length, 0);
});

test("a duplicate in-flight answer is rejected and only one Desktop send occurs", async () => {
  let release;
  let started;
  const began = new Promise((resolve) => { started = resolve; });
  let count = 0;
  const api = endpoint({ sendToCodex: async () => { count += 1; started(); return new Promise((resolve) => { release = resolve; }); } });
  const first = api.answer(request);
  await began;
  await assert.rejects(api.answer(request), (error) => error.status === 409);
  release({ ok: true });
  await first;
  assert.equal(count, 1);
});

test("IPC failure leaves no successful submission and permits retry", async () => {
  let count = 0;
  const api = endpoint({ sendToCodex: async () => { if (count++ === 0) throw new Error("IPC disconnected"); return { ok: true }; } });
  await assert.rejects(api.answer(request), /IPC disconnected/);
  assert.equal(api.submissions.size, 0);
  assert.equal((await api.answer(request)).ok, true);
  await assert.rejects(api.answer({ ...request, answers: [{ questionItemId: questionId, answer: "Different" }] }), (error) => error.status === 409);
});

test("account changes before submission prevent Desktop delivery", async () => {
  const home = { home: "/codex", version: 1 };
  const api = endpoint({ codexHomeState: home, getMessages: async () => { home.version += 1; return { messages: [] }; } });
  await assert.rejects(api.answer(request), (error) => error.status === 409);
  assert.equal(api.calls.length, 0);
});

test("batch validation is atomic and rejects oversized answers before delivery", async () => {
  const api = endpoint();
  await assert.rejects(api.answer({ ...request, answers: [request.answers[0], { questionItemId: "missing", answer: "yes" }] }), (error) => error.status === 409);
  await assert.rejects(api.answer({ ...request, answers: [{ questionItemId: questionId, answer: "x".repeat(4001) }] }), (error) => error.status === 400);
  assert.equal(api.calls.length, 0);
  assert.equal(api.submissions.size, 0);
});

test("another conversation cannot reuse a cached question ID", async () => {
  const api = endpoint();
  api.submissions.set(questionId, { threadId: "another-thread", status: "submitted", answer: "Local voice" });
  await assert.rejects(api.answer(request), (error) => error.status === 409);
  assert.equal(api.calls.length, 0);
});

test("an unacknowledged Desktop response is never reported as submitted", async () => {
  const api = endpoint({ sendToCodex: async () => ({ ok: false }) });
  await assert.rejects(api.answer(request), /did not acknowledge/);
  assert.equal(api.submissions.size, 0);
});

function frontend(overrides = {}) {
  const state = { selectedId: "thread", codexHomeVersion: 1, config: { allowWrite: true }, questionSubmissions: {}, messagesSignature: "" };
  const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  const context = { state, escapeHtml, t: (key, values) => values ? `${key}: ${values.message}` : key,
    approvalSubmissionKey: (thread, id) => `${thread}:${id}`,
    renderCurrentMessages: () => {}, refreshSoon: () => {}, postJson: async () => ({ ok: true }), ...overrides };
  const api = vm.runInNewContext(`${section(client, "function renderUserQuestions(", "function renderApprovalActions(")}\n({renderUserQuestions, submitUserQuestion})`, context);
  return { ...api, state };
}

test("question controls escape content, support free text and disappear after success", async () => {
  const ui = frontend();
  const message = { kind: "user_question", questions: [{ id: questionId, title: "<img onerror=bad>", options: ["<script>bad</script>"], status: "pending" }] };
  const html = ui.renderUserQuestions(message);
  assert.match(html, /question-option/);
  assert.match(html, /textarea/);
  assert.doesNotMatch(html, /<script>|<img onerror/);
  await ui.submitUserQuestion(questionId, "My custom answer");
  const submitted = ui.renderUserQuestions(message);
  assert.doesNotMatch(submitted, /<form|<textarea|<button/);
  assert.match(submitted, /My custom answer/);
});

test("failed question submission retains typed text and shows retry controls", async () => {
  const ui = frontend({ postJson: async () => { throw new Error("Network unavailable"); } });
  await ui.submitUserQuestion(questionId, "Keep my draft");
  const html = ui.renderUserQuestions({ kind: "user_question", questions: [{ id: questionId, title: "Q", options: [], status: "pending" }] });
  assert.match(html, /Keep my draft/);
  assert.match(html, /Network unavailable/);
  assert.match(html, /<form/);
  const readonly = frontend();
  readonly.state.config.allowWrite = false;
  assert.match(readonly.renderUserQuestions({ kind: "user_question", questions: [{ id: questionId, title: "Q", options: ["A"], status: "pending" }] }), /disabled/);
});
