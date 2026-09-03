/**
 * ArmaraOS Lite — consumer workspace UI.
 * Talks to the local ArmaraOS daemon via same-origin /api proxy.
 */

import {
  MAX_UPLOAD_BYTES,
  MAX_PENDING_FILES,
  attachmentAllowed,
  isImageAttachment,
  sanitizeSessionLabel,
  sessionDisplayName,
  composeUserMessage,
  stripFileTags,
  filterModels,
  mergePendingApprovals,
  sessionDeleteConfirmMessage,
  shouldIgnoreSessionDeleteClick,
  readStreamChunk,
  STREAM_IDLE_MS,
  dropPathBlocked,
  displayAttachmentName,
  CRON_PRESETS,
  isAgentTurnJob,
  isSystemJob,
  visibleJobs,
  describeCron,
  jobTimingLine,
  latestCronResult,
  jobScheduleTimeZone,
  timeZoneLabel,
  timeZoneOptions,
  cronSchedulePayload,
  defaultTimeZone,
  approvalCardText,
  pendingApprovalsForAgent,
  formatJobWhen,
  approvePayload,
  approvalActions,
  consumerActivityEntries,
  mergeActivitySources,
  activityJump,
  activityPreview,
  auditActionLabel,
} from "./lite-lib.js";

const CONSUMER_TEMPLATES = [
  {
    id: "assistant",
    name: "Armara",
    description: "Everyday tasks, answers, research, and getting things done.",
    profile: "automation",
    system_prompt:
      "You are Armara, a personal assistant in ArmaraOS Lite. Be helpful, clear, and concise. Ask clarifying questions when needed. Prefer action over ceremony.",
  },
  {
    id: "coder",
    name: "Code Helper",
    description: "Writes, reviews, and debugs code across languages.",
    profile: "coding",
    system_prompt:
      "You are an expert programmer. Help users write clean, efficient code. Explain your reasoning. Follow best practices.",
  },
  {
    id: "researcher",
    name: "Researcher",
    description: "Breaks down topics and synthesizes cited summaries.",
    profile: "research",
    system_prompt:
      "You are a research analyst. Break down complex topics into clear explanations. Provide structured analysis with key findings.",
  },
  {
    id: "writer",
    name: "Writer",
    description: "Drafts, edits, and polishes written content.",
    profile: "full",
    system_prompt:
      "You are a skilled writer and editor. Help users create polished content. Adapt tone to the audience.",
  },
];

const HOME_EXAMPLES = [
  { label: "Research something", prompt: "Research the latest developments in personal AI assistants and summarize the key takeaways." },
  { label: "Draft content", prompt: "Draft a short, friendly email introducing ArmaraOS Lite as a personal AI workspace." },
  { label: "Organize files", prompt: "Help me invent a simple folder structure for personal projects and notes." },
  { label: "Recurring task", prompt: "Set up a recurring task: every weekday morning, remind me to review my top three priorities." },
];

const ADVANCED_LINKS = [
  { id: "remember", title: "What I remember", desc: "Graph-native facts the daemon stored", path: "/api/graph-memory?limit=40", needsAgent: true },
  { id: "graph-memory", title: "Graph Memory", desc: "Full knowledge graph", path: "/api/graph-memory?limit=80", needsAgent: true },
  { id: "missions", title: "Missions", desc: "DAG missions per agent", path: "/api/missions", needsAgent: true },
  { id: "trajectories", title: "Trajectories", desc: "Recorded run traces", path: "/api/trajectories", needsAgent: true },
  { id: "failures", title: "Failures", desc: "Typed failure nodes", path: "/api/graph-memory/failures/recent", needsAgent: true },
  { id: "proposals", title: "Proposals", desc: "Improvement proposals", path: "/api/graph-memory/improvement-proposals", needsAgent: true },
  { id: "suggestions", title: "Suggestions", desc: "Daemon pulse suggestions", path: "/api/suggestions" },
  { id: "orchestration", title: "Orchestration", desc: "Multi-agent traces", path: "/api/orchestration/traces" },
  { id: "skills", title: "Skills / MCP", desc: "Skills and MCP servers", path: "/api/skills" },
  { id: "ainl", title: "AINL library", desc: "Native language programs", path: "/api/ainl/library" },
  { id: "runtime", title: "Runtime", desc: "Daemon resources", path: "/api/system/daemon-resources" },
  { id: "logs", title: "Logs", desc: "Recent daemon logs", path: "/api/logs/daemon/recent" },
  { id: "channels", title: "Channels", desc: "Messaging adapters", path: "/api/channels" },
];

const PROVIDER_DEFAULTS = {
  armara: "armara",
  openrouter: "nvidia/nemotron-3-super-120b-a12b:free",
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-5",
};

const ARMARA_SIGNUP_URL = "https://armaraos.com/sign-up";
const ARMARA_KEY_URL = "https://armaraos.com/account#api-key";

function armaraKeyHelpHtml() {
  return `<p class="muted key-signup">No Armara key yet? <a href="${ARMARA_SIGNUP_URL}" target="_blank" rel="noopener">Sign up free on armaraos.com</a>, then copy your <span class="mono">ix_*</span> key from <a href="${ARMARA_KEY_URL}" target="_blank" rel="noopener">Account</a>.</p>`;
}

const SETUP_PROVIDERS = ["armara", "openrouter", "openai", "anthropic"];

/** @type {{ prefs: any, daemonBaseUrl: string, page: string, agents: any[], providers: any[], setupStep: number, selectedProvider: string, selectedTemplate: number, apiKey: string, chat: { messages: any[], streaming: boolean }, activity: any[], approvals: any[], jobs: any[], advancedDetail: any }} */
const state = {
  prefs: { setupComplete: false, defaultAssistantId: null, lastPage: "home", advancedOpen: false, homeHeadOpen: true, statusOpen: true, hideSystemJobs: true, sessionByAgent: {} },
  daemonBaseUrl: "",
  page: "home",
  agents: [],
  providers: [],
  setupStep: 1,
  selectedProvider: "armara",
  selectedTemplate: 0,
  apiKey: "",
  settingsKeyDraft: "",
  providerSaveNotice: "",
  chat: {
    messages: [],
    streaming: false,
    streamingFor: null,
    loadedFor: null,
    sessionId: null,
    sessions: [],
    draft: "",
    abort: null,
    stopRequested: false,
    files: [],
    renamingSession: false,
    queue: null,
    deletingId: null,
  },
  modelsCatalog: [],
  modelsByProvider: {},
  assistantUi: {
    editId: null,
    name: "",
    description: "",
    prompt: "",
    modelId: null,
    modelQuery: "",
  },
  daemon: { facts: [], suggestions: [], mission: null, goal: null },
  activity: [],
  approvals: [],
  jobs: [],
  jobRuns: [],
  auditEntries: [],
  health: null,
  pendingHomeAgentId: null,
  highlightJobId: null,
  activityLive: false,
  automationUi: {
    editId: null,
    name: "",
    message: "",
    expr: "",
    tz: "",
    agentId: "",
    createName: "",
    createMessage: "",
    createExpr: "",
    createTz: "",
    createAgentId: "",
    resultId: null,
  },
  approvalDrafts: {},
  advancedDetail: null,
};

function $(sel) {
  return document.querySelector(sel);
}

function toast(msg, isError) {
  const el = $("#toast");
  el.hidden = false;
  el.textContent = msg;
  el.classList.toggle("error", !!isError);
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 4000);
}

function markLiteOffline() {
  const el = $("#conn-status");
  if (!el) return;
  el.textContent = "Lite workspace offline — restart with armaraos-lite";
  el.className = "conn bad";
}

async function api(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  let res;
  try {
    res = await fetch(path, opts);
  } catch (e) {
    markLiteOffline();
    const err = new Error(
      "Can't reach the Lite workspace (connection refused). Keep armaraos-lite running, then retry.",
    );
    err.cause = e;
    throw err;
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const MSG_KICKERS = {
  error: "Error",
  system: "System",
  tool: "Tool",
  approval: "Approval",
};

const PATH_TOKEN_RE =
  /(?:~\/|\/(?:Users|home|opt|var|tmp|usr|etc)\/|\.\/|\.\.\/)[^\s`'<>")\]]+/g;
const FILE_TOKEN_RE =
  /(^|[^./\w])([\w.-]+\.(?:py|js|ts|tsx|mjs|cjs|json|md|sh|ainl|txt|csv|rs|go|toml|ya?ml|html|css))\b/g;

function stripPathPunct(s) {
  return String(s || "").replace(/[.,;:]+$/g, "");
}

function classifyReply(text) {
  const t = String(text || "").trim();
  if (!t) return "reply";
  if (/^\(?Error\b/i.test(t) || /^Stream failed\b/i.test(t) || /^Traceback\b/i.test(t)) {
    return "error";
  }
  if (/\b(ENOENT|ECONNREFUSED|EADDRINUSE|failed to fetch)\b/i.test(t) && t.length < 900) {
    return "error";
  }
  if (
    /that reply got tangled/i.test(t) ||
    /^\(No reply/i.test(t) ||
    /try sending the message again/i.test(t)
  ) {
    return "system";
  }
  return "reply";
}

const FENCE_LANG_RE =
  /^(python3?|py|javascript|typescript|js|ts|tsx|bash|shell|zsh|sh|json|html|css|go|rust|rs|toml|ya?ml|markdown|md|ainl|text|txt|sql|ruby|rb|php|c|cpp|java|swift|kotlin|xml|diff)\b/i;

function splitFences(text) {
  const parts = [];
  const tokens = String(text || "").split("```");
  for (let i = 0; i < tokens.length; i++) {
    const chunk = tokens[i];
    if (i % 2 === 0) {
      if (chunk) parts.push({ type: "prose", text: chunk });
      continue;
    }
    const peeled = peelFenceLang(chunk);
    parts.push({ type: "code", lang: peeled.lang, text: peeled.body.replace(/\n$/, "") });
  }
  return parts.length ? parts : [{ type: "prose", text: "" }];
}

function peelFenceLang(chunk) {
  const raw = String(chunk || "");
  const nl = raw.search(/\r?\n/);
  if (nl === -1) {
    const only = raw.trim();
    if (/^[a-zA-Z0-9_+-]+$/.test(only)) return { lang: only, body: "" };
    const sameLine = raw.match(/^\s*([a-zA-Z0-9_+-]+)\s+/);
    if (sameLine && FENCE_LANG_RE.test(sameLine[1])) {
      return { lang: sameLine[1], body: raw.slice(sameLine[0].length) };
    }
    return { lang: "", body: raw };
  }
  const first = raw.slice(0, nl).trim();
  if (/^[a-zA-Z0-9_+-]*$/.test(first)) {
    return { lang: first, body: raw.slice(nl).replace(/^\r?\n/, "") };
  }
  const sameLine = first.match(/^([a-zA-Z0-9_+-]+)\s+(.*)$/);
  if (sameLine && FENCE_LANG_RE.test(sameLine[1])) {
    return { lang: sameLine[1], body: sameLine[2] + raw.slice(nl) };
  }
  return { lang: "", body: raw };
}

function safeHref(href) {
  try {
    const u = new URL(String(href || "").trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

function formatPlainRich(text) {
  const src = String(text || "");
  const marks = [];
  const push = (start, end, kind, value) => {
    if (marks.some((x) => start < x.end && end > x.start)) return;
    marks.push({ start, end, kind, value });
  };
  let m;
  const paths = new RegExp(PATH_TOKEN_RE.source, "g");
  while ((m = paths.exec(src))) {
    const raw = stripPathPunct(m[0]);
    push(m.index, m.index + raw.length, "path", raw);
  }
  const files = new RegExp(FILE_TOKEN_RE.source, "g");
  while ((m = files.exec(src))) {
    const prefix = m[1] || "";
    push(m.index + prefix.length, m.index + m[0].length, "file", m[2]);
  }
  marks.sort((a, b) => a.start - b.start || b.end - a.end);
  let html = "";
  let last = 0;
  for (const mark of marks) {
    if (mark.start < last) continue;
    html += escapeHtml(src.slice(last, mark.start));
    if (mark.kind === "path") {
      html += `<code class="msg-path">${escapeHtml(mark.value)}</code>`;
    } else {
      html += `<code class="msg-file">${escapeHtml(mark.value)}</code>`;
    }
    last = mark.end;
  }
  html += escapeHtml(src.slice(last));
  return html;
}

function formatInline(text) {
  const src = String(text || "");
  const tokenRe = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*\n]+)\*|~~([^~]+)~~|(https?:\/\/[^\s<]+)/g;
  let html = "";
  let last = 0;
  let m;
  while ((m = tokenRe.exec(src))) {
    html += formatPlainRich(src.slice(last, m.index));
    if (m[1] != null) {
      html += `<code class="msg-inline">${escapeHtml(m[1])}</code>`;
    } else if (m[2] != null) {
      const href = safeHref(m[3]);
      html += href
        ? `<a class="msg-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(m[2])}</a>`
        : formatPlainRich(m[2]);
    } else if (m[4] != null) {
      html += `<strong>${formatPlainRich(m[4])}</strong>`;
    } else if (m[5] != null) {
      html += `<em>${formatPlainRich(m[5])}</em>`;
    } else if (m[6] != null) {
      html += `<s>${formatPlainRich(m[6])}</s>`;
    } else {
      const raw = m[7];
      const trimmed = raw.replace(/[).,;:]+$/g, "");
      const trail = raw.slice(trimmed.length);
      const href = safeHref(trimmed);
      html += href
        ? `<a class="msg-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(trimmed)}</a>${escapeHtml(trail)}`
        : formatPlainRich(raw);
    }
    last = m.index + m[0].length;
  }
  html += formatPlainRich(src.slice(last));
  return html;
}

function listItem(line) {
  const m = String(line || "").match(/^(\s*)(?:([-*•])|(\d+)[.)])\s+(.*)$/);
  if (!m) return null;
  return {
    indent: m[1].replace(/\t/g, "  ").length,
    kind: m[3] ? "ol" : "ul",
    text: m[4],
  };
}

function renderList(items) {
  if (!items.length) return "";
  const min = Math.min(...items.map((it) => it.indent));
  let html = "";
  let i = 0;
  while (i < items.length) {
    if (items[i].indent > min) {
      i += 1;
      continue;
    }
    const kind = items[i].kind;
    const lis = [];
    while (i < items.length && !(items[i].indent <= min && items[i].kind !== kind)) {
      if (items[i].indent > min) {
        i += 1;
        continue;
      }
      const kids = [];
      let j = i + 1;
      while (j < items.length && items[j].indent > items[i].indent) {
        kids.push(items[j]);
        j += 1;
      }
      lis.push(`<li>${formatInline(items[i].text)}${kids.length ? renderList(kids) : ""}</li>`);
      i = j;
    }
    const tag = kind === "ol" ? "ol" : "ul";
    html += `<${tag}>${lis.join("")}</${tag}>`;
  }
  return html;
}

function consumeList(lines, start) {
  const items = [];
  let i = start;
  while (i < lines.length) {
    if (/^\s*$/.test(lines[i])) {
      if (i + 1 < lines.length && listItem(lines[i + 1])) {
        i += 1;
        continue;
      }
      break;
    }
    const item = listItem(lines[i]);
    if (!item) break;
    items.push(item);
    i += 1;
    while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !listItem(lines[i])) {
      items[items.length - 1].text += " " + lines[i].trim();
      i += 1;
    }
  }
  return { html: renderList(items), next: i };
}

function splitCells(line) {
  return String(line || "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isTableRow(line) {
  return /^\s*\|.+\|\s*$/.test(line);
}

function isTableSep(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function consumeTable(lines, start) {
  const rows = [];
  let i = start;
  while (i < lines.length && (isTableRow(lines[i]) || isTableSep(lines[i]))) {
    if (!isTableSep(lines[i])) rows.push(splitCells(lines[i]));
    i += 1;
  }
  if (!rows.length) return { html: "", next: start + 1 };
  const head = rows[0];
  const body = rows.slice(1);
  const thead = `<tr>${head.map((c) => `<th>${formatInline(c)}</th>`).join("")}</tr>`;
  const tbody = body.map((r) => `<tr>${r.map((c) => `<td>${formatInline(c)}</td>`).join("")}</tr>`).join("");
  return {
    html: `<div class="msg-table-wrap"><table>${thead}${tbody}</table></div>`,
    next: i,
  };
}

function splitInlineOrderedList(line) {
  const re = /(?:^| )(\d{1,2})[.)][ \t]+(?=[A-Za-z*_`"“])/g;
  const hits = [...String(line || "").matchAll(re)];
  if (hits.length < 2) return line;
  const nums = hits.map((h) => Number(h[1]));
  if (nums[0] > 2) return line;
  const sequential = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  if (!sequential) return line;
  const out = [];
  const prefix = line.slice(0, hits[0].index).trim();
  if (prefix) out.push(prefix);
  for (let i = 0; i < hits.length; i++) {
    let from = hits[i].index;
    if (from > 0 && line[from] === " ") from += 1;
    const to = i + 1 < hits.length ? hits[i + 1].index : line.length;
    out.push(line.slice(from, to).trim());
  }
  return out.join("\n");
}

function preprocessMarkdown(text) {
  let t = String(text || "").replace(/\r\n/g, "\n");
  t = t.replace(/([^\n])[ \t]+(#{1,3}[ \t]+)/g, "$1\n$2");
  t = t.replace(/^[ \t]{1,3}(#{1,3}[ \t]+)/gm, "$1");
  t = t.replace(/^(#{1,3}[ \t]+.+?)(?=[ \t]+\d{1,2}[.)][ \t]+)/gm, "$1\n");
  return t.split("\n").map(splitInlineOrderedList).join("\n");
}

function formatMarkdown(text) {
  const lines = preprocessMarkdown(text).split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      i += 1;
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+)$/);
    if (heading) {
      const lvl = heading[1].length;
      out.push(`<h${lvl}>${formatInline(heading[2].trim())}</h${lvl}>`);
      i += 1;
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push("<hr />");
      i += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${formatMarkdown(buf.join("\n"))}</blockquote>`);
      continue;
    }
    if (listItem(line)) {
      const list = consumeList(lines, i);
      out.push(list.html);
      i = list.next;
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const table = consumeTable(lines, i);
      out.push(table.html);
      i = table.next;
      continue;
    }
    const buf = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      if (/^\s*$/.test(next)) break;
      if (listItem(next) || /^(#{1,3})\s+/.test(next) || /^>\s?/.test(next)) break;
      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(next)) break;
      if (isTableRow(next) && i + 1 < lines.length && isTableSep(lines[i + 1])) break;
      buf.push(next);
      i += 1;
    }
    out.push(`<p>${buf.map(formatInline).join("<br />")}</p>`);
  }
  return out.join("");
}

function codeBlockHtml(lang, body) {
  const label = lang ? escapeHtml(lang) : "code";
  return `<pre class="msg-code"><div class="msg-code-bar"><span>${label}</span><button type="button" class="msg-copy" data-copy-code>Copy</button></div><code>${escapeHtml(body)}</code></pre>`;
}

function looksLikeRawCode(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  const lines = t.split("\n");
  const codeish = lines.filter((l) =>
    /^( {4}|\t|#!\/|def |class |function |import |from |const |let |var |package )/.test(l),
  ).length;
  return lines.length >= 4 && codeish / lines.length >= 0.5;
}

function formatMessageBody(text, type) {
  const parts = splitFences(text);
  const hasFence = parts.some((part) => part.type === "code");
  if (!hasFence && (type === "code" || looksLikeRawCode(text))) {
    return codeBlockHtml("code", text);
  }
  return parts
    .map((part) => {
      if (part.type === "code") return codeBlockHtml(part.lang, part.text);
      if (!part.text) return "";
      const md = formatMarkdown(part.text);
      return md ? `<div class="msg-prose">${md}</div>` : "";
    })
    .join("");
}

function messageHtml(m) {
  if (m.kind === "working") {
    const raw = String(m.text || "");
    const bits = raw.match(/^(Working|Worked)\s*·\s*(.*)$/);
    const done = bits ? bits[1] === "Worked" : false;
    const name = bits ? bits[2] : raw;
    return `<div class="msg is-tool${done ? " is-tool-done" : ""}">
      <div class="msg-kicker">${done ? "Tool · done" : "Tool"}</div>
      <div class="msg-body">${escapeHtml(name)}</div>
    </div>`;
  }
  if (m.kind === "approval") {
    const live = liveApproval(m.id) || m;
    const question = String((live && live.question) || "").trim();
    const showQ = question && question !== m.text;
    return `<div class="msg is-approval">
      <div class="msg-kicker">Approval</div>
      <div class="msg-body">
        <p class="msg-prose">${escapeHtml(m.text)}</p>
        ${showQ ? `<p class="muted">${escapeHtml(question)}</p>` : ""}
        ${approvalActionButtons(live || m)}
      </div>
    </div>`;
  }
  if (m.role === "user") {
    const files = Array.isArray(m.files) ? m.files : [];
    const chips = files
      .map((f) => `<span class="msg-file">${escapeHtml(f.filename || f.name || "file")}</span>`)
      .join("");
    const text = stripFileTags(m.text);
    return `<div class="msg user">${
      text ? escapeHtml(text) : ""
    }${chips ? `<div class="msg-files">${chips}</div>` : ""}</div>`;
  }
  const type = classifyReply(m.text);
  const kicker = MSG_KICKERS[type]
    ? `<div class="msg-kicker">${MSG_KICKERS[type]}</div>`
    : "";
  const body = formatMessageBody(m.text, type) || `<div class="msg-prose"></div>`;
  return `<div class="msg assistant is-${type}">${kicker}<div class="msg-body">${body}</div></div>`;
}

function keyLengthHint(len) {
  const n = Number(len) || 0;
  if (n <= 0) return "";
  return `${n} character${n === 1 ? "" : "s"} pasted — click Save & test to connect.`;
}

function looksLikeLeakedReasoning(text) {
  const s = String(text || "");
  if ((s.match(/<unk>/g) || []).length >= 8) return true;
  if ((s.match(/developer message/gi) || []).length >= 3) return true;
  if ((s.match(/hello-ok/g) || []).length >= 3 && s.length > 400) return true;
  if (s.length > 1600 && /brand guardrails/i.test(s) && /developer message/i.test(s)) return true;
  return false;
}

function looksLikeToolProtocol(text) {
  const s = String(text || "").trim();
  if (!s) return false;
  if (/^\{\"tool_calls\"/.test(s) || /^\[tool_use\b/.test(s)) return true;
  if (/^\{[\s\S]*\"name\"\s*:\s*\"file_read\"/.test(s) && s.length < 800) return true;
  return false;
}

function stripToolProtocol(text) {
  return String(text || "")
    .replace(/\{"tool_calls":\[[\s\S]*?\]\}/g, "")
    .replace(/\[tool_use [^\]]+\]/g, "")
    .replace(/\{"path":"[^"]+"\}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanAssistantText(text) {
  return stripToolProtocol(String(text || "").replace(/(<unk>)+/g, "")).replace(/\n{3,}/g, "\n\n");
}

/** Visible tokens only — same as the classic dashboard HTTP mapper (`chunk` + `content`). */
function streamVisibleDelta(ev, payload) {
  if (ev !== "chunk") return "";
  const t = String((payload && (payload.content || payload.text)) || "");
  if (looksLikeToolProtocol(t)) return "";
  return t;
}

function shouldShowHistoryText(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (looksLikeLeakedReasoning(t)) return false;
  if (/^reply with exactly:/i.test(t)) return false;
  if (/^(hello-ok|inferx-ok)$/i.test(t)) return false;
  return true;
}

function mapDaemonMessages(raw) {
  const out = [];
  for (const m of raw || []) {
    const roleRaw = String(m.role || "").toLowerCase();
    const role = roleRaw === "user" ? "user" : roleRaw === "assistant" || roleRaw === "agent" ? "assistant" : "";
    if (!role) continue;
    const text = cleanAssistantText(typeof m.content === "string" ? m.content : "");
    if (!shouldShowHistoryText(text)) continue;
    out.push({ role, text });
    for (const tool of m.tools || []) {
      const name = tool.name || "tool";
      out.push({ kind: "working", text: `Worked · ${name}` });
    }
  }
  return out;
}

/**
 * Per-assistant transcript cache. Lives outside `render()` so leaving Home
 * and coming back (or switching assistants) restores that agent's session,
 * matching the full ArmaraOS dashboard.
 */
const _agentMsgCache = {};
const _agentSessionId = {};
const LITE_MSG_CACHE_PREFIX = "armaraos-lite-msg-cache:";

function daemonSessionId(row) {
  return (row && (row.session_id || row.id)) || null;
}

function rememberedSessionId(agentId) {
  if (!agentId) return null;
  return _agentSessionId[agentId] || (state.prefs.sessionByAgent || {})[agentId] || null;
}

function rememberSessionId(agentId, sid) {
  if (!agentId || !sid) return;
  _agentSessionId[agentId] = sid;
  if (state.chat.loadedFor === agentId) state.chat.sessionId = sid;
  const prev = (state.prefs.sessionByAgent || {})[agentId];
  if (prev === sid) return;
  const sessionByAgent = { ...(state.prefs.sessionByAgent || {}), [agentId]: sid };
  savePrefs({ sessionByAgent }).catch(() => {});
}

function threadCacheKey(agentId, sessionId) {
  const sid = sessionId || rememberedSessionId(agentId);
  return sid ? `${agentId}:${sid}` : agentId;
}

function persistMsgCache(agentId, msgs, sessionId) {
  if (!agentId || !msgs) return;
  const sid = sessionId || (state.chat.loadedFor === agentId ? state.chat.sessionId : null) || rememberedSessionId(agentId);
  const key = threadCacheKey(agentId, sid);
  _agentMsgCache[key] = msgs;
  try {
    if (msgs.length) sessionStorage.setItem(LITE_MSG_CACHE_PREFIX + key, JSON.stringify(msgs));
  } catch {
    /* quota / private mode */
  }
}

function restoreMsgCache(agentId, sessionId) {
  if (!agentId) return [];
  const sid = sessionId || rememberedSessionId(agentId);
  const key = threadCacheKey(agentId, sid);
  if (Object.prototype.hasOwnProperty.call(_agentMsgCache, key)) return _agentMsgCache[key];
  const keys = [key, agentId];
  try {
    for (const k of keys) {
      const raw = sessionStorage.getItem(LITE_MSG_CACHE_PREFIX + k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        _agentMsgCache[key] = parsed;
        return parsed;
      }
    }
  } catch {
    /* ignore */
  }
  return [];
}

function snapshotCurrentChat() {
  const id = state.chat.loadedFor;
  if (!id || !state.chat.messages.length) return;
  persistMsgCache(id, state.chat.messages, state.chat.sessionId);
  if (state.chat.sessionId) rememberSessionId(id, state.chat.sessionId);
}

/** Show this assistant's remembered thread immediately (no network). */
function showAgentChat(agentId) {
  if (!agentId) return;
  snapshotCurrentChat();
  if (state.chat.loadedFor && state.chat.loadedFor !== agentId) {
    state.chat.sessions = [];
    state.chat.renamingSession = false;
  }
  const sid = rememberedSessionId(agentId);
  if (state.chat.loadedFor === agentId && state.chat.sessionId === sid) {
    if (!state.chat.messages.length) {
      const cached = restoreMsgCache(agentId, sid);
      if (cached.length) state.chat.messages = cached;
    }
    return;
  }
  const cached = restoreMsgCache(agentId, sid);
  state.chat.messages = cached;
  state.chat.loadedFor = agentId;
  state.chat.sessionId = sid;
}

function sessionOptionLabel(s) {
  return sessionDisplayName(s, state.chat.sessions);
}

function currentSessionRow() {
  const sid = state.chat.sessionId;
  if (!sid) return null;
  return (state.chat.sessions || []).find((s) => daemonSessionId(s) === sid) || null;
}

function purgeAgentCache(agentId) {
  if (!agentId) return;
  for (const key of Object.keys(_agentMsgCache)) {
    if (key === agentId || key.startsWith(`${agentId}:`)) delete _agentMsgCache[key];
  }
  delete _agentSessionId[agentId];
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(LITE_MSG_CACHE_PREFIX) && k.includes(agentId)) {
        sessionStorage.removeItem(k);
      }
    }
  } catch {
    /* ignore */
  }
  if ((state.prefs.sessionByAgent || {})[agentId]) {
    const sessionByAgent = { ...(state.prefs.sessionByAgent || {}) };
    delete sessionByAgent[agentId];
    savePrefs({ sessionByAgent }).catch(() => {});
  }
}

async function loadSessionList(agentId) {
  if (!agentId) return [];
  try {
    const data = await api("GET", `/api/agents/${encodeURIComponent(agentId)}/sessions`);
    const sessions = data.sessions || [];
    if (state.chat.loadedFor === agentId || !state.chat.loadedFor) {
      state.chat.sessions = sessions;
    }
    return sessions;
  } catch {
    return [];
  }
}

function graphFactLabel(node) {
  const kind = node.kind || (node.explain && node.explain.node_kind) || "";
  let lab = node.label;
  if (lab && typeof lab === "object") lab = lab.text || lab.title || lab.fact || "";
  lab = String(lab || (node.meta && node.meta.fact) || (node.explain && node.explain.what_happened) || "")
    .replace(/^Semantic fact stored:\s*/i, "")
    .trim();
  if (!lab) return null;
  if (/MCP readiness|AINL capabilities snapshot|strict_sum|strict_contract|recommended_next_tools/i.test(lab)) {
    return null;
  }
  const useful =
    kind === "semantic" || (kind === "procedural" && /skill loaded/i.test(lab));
  if (!useful) return null;
  if (lab.length > 120) lab = lab.slice(0, 117) + "…";
  return lab;
}

function formatAdvancedBody(link, data) {
  if (!data || typeof data !== "object") return String(data || "");
  if (link.id === "remember" || link.id === "graph-memory") {
    const nodes = data.nodes || [];
    const lines = [];
    for (const n of nodes) {
      const lab = graphFactLabel(n);
      if (lab) lines.push(`• ${lab}`);
    }
    if (lines.length) return `Graph-native facts (${lines.length}):\n\n${lines.join("\n")}`;
    const entries = data.entries || [];
    if (entries.length) {
      return entries
        .map((e) => `• ${typeof e === "string" ? e : e.text || e.label || JSON.stringify(e)}`)
        .join("\n");
    }
    return "No compact facts yet. Chat with the assistant so the daemon can store semantic nodes.";
  }
  if (link.id === "suggestions") {
    const rows = data.suggestions || [];
    if (!rows.length) return "No pulse suggestions.";
    return rows
      .map((s) => `${s.status || "unknown"} · ${s.title || s.id}${s.detail ? `\n  ${s.detail}` : ""}`)
      .join("\n\n");
  }
  if (link.id === "missions") {
    const rows = data.missions || data.active_missions || [];
    if (!rows.length) return "No missions on this agent.";
    return rows
      .map((m) => `${m.state || "unknown"} · ${m.objective_preview || m.mission_id}`)
      .join("\n");
  }
  if (link.id === "ainl") {
    const programs = data.programs || [];
    const head = `${data.total ?? programs.length} AINL programs${data.root ? ` in ${data.root}` : ""}`;
    return [head, ...programs.slice(0, 40).map((p) => p.path || p.name || JSON.stringify(p))].join("\n");
  }
  return JSON.stringify(data, null, 2).slice(0, 12000);
}

/** Stay on this agent's last session. Never steal the globally richest thread. */
async function attachDaemonSession(agentId) {
  if (!agentId) return;
  try {
    const sessions = await loadSessionList(agentId);
    if (!sessions.length) return;
    const wanted = rememberedSessionId(agentId);
    const remembered = wanted
      ? sessions.find((s) => daemonSessionId(s) === wanted)
      : null;
    const active = sessions.find((s) => s.active);
    const target = remembered || active || sessions[0];
    const sid = daemonSessionId(target);
    if (target && !target.active && sid) {
      await api(
        "POST",
        `/api/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sid)}/switch`,
        {},
      );
      for (const s of sessions) s.active = daemonSessionId(s) === sid;
    }
    if (sid) rememberSessionId(agentId, sid);
  } catch (e) {
    console.warn("Could not attach daemon session", e);
  }
}

async function loadChatHistory(agentId, opts) {
  const force = opts && opts.force;
  if (!agentId || state.chat.streaming) return;
  showAgentChat(agentId);
  if (!force && state.chat.loadedFor === agentId && state.chat.messages.length) {
    loadSessionList(agentId).then(() => {
      if (state.page === "home" && state.chat.loadedFor === agentId && !state.chat.streaming) render();
    });
    return;
  }
  try {
    await attachDaemonSession(agentId);
    const data = await api("GET", `/api/agents/${encodeURIComponent(agentId)}/session?limit=200`);
    if (state.chat.streaming) return;
    if (state.chat.loadedFor !== agentId) return;
    const mapped = mapDaemonMessages(data.messages || []);
    const sid = daemonSessionId(data) || rememberedSessionId(agentId);
    if (sid) rememberSessionId(agentId, sid);
    if (mapped.length || !state.chat.messages.length) {
      state.chat.messages = mapped;
      persistMsgCache(agentId, mapped, sid);
    }
    state.chat.loadedFor = agentId;
    if (sid) state.chat.sessionId = sid;
  } catch (e) {
    console.warn("Could not load daemon chat history", e);
  }
}

async function loadDaemonFeatures(agentId) {
  const next = { facts: [], suggestions: [], mission: null, goal: null };
  if (!agentId) {
    state.daemon = next;
    return;
  }
  const [graph, suggestions, digest] = await Promise.all([
    api("GET", `/api/graph-memory?agent_id=${encodeURIComponent(agentId)}&limit=40`).catch(() => null),
    api("GET", "/api/suggestions").catch(() => null),
    api("GET", `/api/agents/${encodeURIComponent(agentId)}/session/digest`).catch(() => null),
  ]);
  const facts = [];
  const seen = new Set();
  for (const node of (graph && graph.nodes) || []) {
    const label = graphFactLabel(node);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    facts.push(label);
    if (facts.length >= 8) break;
  }
  next.facts = facts;
  next.suggestions = ((suggestions && suggestions.suggestions) || [])
    .filter((s) => s.status === "pending")
    .slice(0, 4);
  const missions = (digest && digest.active_missions) || [];
  next.mission = missions[0] || null;
  if (digest && digest.session_goal_preview) {
    next.goal = {
      preview: digest.session_goal_preview,
      progress: digest.session_goal_progress || null,
      latched: !!digest.session_goal_latched,
    };
  }
  state.daemon = next;
}

async function applyProviderToDefaultAssistant(providerId) {
  const agent = defaultAgent();
  if (!agent || !providerId) return;
  const model = PROVIDER_DEFAULTS[providerId];
  if (!model) return;
  try {
    await api("PUT", `/api/agents/${encodeURIComponent(agent.id)}/model`, {
      model,
      provider: providerId,
    });
    await refreshAgents();
  } catch {
    /* already on this provider, or catalog mismatch — chat can still proceed */
  }
}

function tomlEscape(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function tomlMultiline(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"""/g, '""\\"');
}

function isConsumerAgent(a) {
  if (!a || a.premium_hand) return false;
  const name = (a.name || "").toLowerCase();
  if (name.includes("probe") || name.includes("automation")) return false;
  // Prefer everyday assistants; still allow other non-hand agents in the list.
  return true;
}

function isPreferredAssistant(a) {
  if (!isConsumerAgent(a)) return false;
  const name = (a.name || "").toLowerCase();
  return /^(armara|assistant|researcher|writer|coder|code-helper|code helper)/.test(name);
}

function defaultAgent() {
  const id = state.prefs.defaultAssistantId;
  if (id) {
    const found = state.agents.find((a) => a.id === id);
    if (found && isConsumerAgent(found)) return found;
  }
  return (
    state.agents.find(isPreferredAssistant) ||
    state.agents.find((a) => isConsumerAgent(a) && a.model_provider === "armara") ||
    state.agents.find(isConsumerAgent) ||
    state.agents[0] ||
    null
  );
}

async function refreshMeta() {
  const meta = await api("GET", "/lite/meta");
  state.prefs = meta.prefs || state.prefs;
  if (!state.prefs.sessionByAgent || typeof state.prefs.sessionByAgent !== "object") {
    state.prefs.sessionByAgent = {};
  }
  for (const [id, sid] of Object.entries(state.prefs.sessionByAgent)) {
    if (sid && !_agentSessionId[id]) _agentSessionId[id] = sid;
  }
  state.daemonBaseUrl = meta.daemonBaseUrl || "";
  const link = $("#full-dashboard-link");
  if (link && state.daemonBaseUrl) {
    link.href = state.daemonBaseUrl + "/";
  }
}

async function refreshHealth() {
  const el = $("#conn-status");
  try {
    const h = await api("GET", "/api/health");
    state.health = h;
    if (el) {
      el.textContent = `Daemon connected · v${h.version || "?"}`;
      el.className = "conn ok";
    }
    return true;
  } catch {
    state.health = null;
    if (el) {
      el.textContent = "Daemon unreachable — run armaraos start";
      el.className = "conn bad";
    }
    return false;
  }
}

async function refreshAgents() {
  const data = await api("GET", "/api/agents");
  state.agents = Array.isArray(data) ? data : data.agents || [];
}

async function refreshProviders() {
  const data = await api("GET", "/api/providers");
  state.providers = data.providers || data || [];
}

function mergeApprovalsIntoThread(thread) {
  const agentId = state.chat.streamingFor || state.chat.loadedFor;
  return mergePendingApprovals(thread, state.approvals, agentId);
}

async function refreshApprovals() {
  try {
    const data = await api("GET", "/api/approvals");
    state.approvals = data.approvals || [];
    const pending = (state.approvals || []).filter((a) => String(a.status || "pending").toLowerCase() === "pending");
    const badge = $("#approval-badge");
    if (badge) {
      if (pending.length) {
        badge.hidden = false;
        badge.textContent = String(pending.length);
      } else {
        badge.hidden = true;
        badge.textContent = "";
      }
    }
    if (state.chat.streaming || state.page === "home") {
      const thread = state.chat.messages;
      if (mergeApprovalsIntoThread(thread)) {
        persistMsgCache(state.chat.streamingFor || state.chat.loadedFor, thread);
        if (state.page === "home") {
          render();
          scrollChatToLatest({ smooth: false });
        }
      }
    }
  } catch {
    /* polling must not spam unhandled rejections when Lite is down */
  }
}

function syncWorkingBadge() {
  const el = $("#working-badge");
  const homeBtn = document.querySelector('.nav-item[data-page="home"]');
  const on = !!state.chat.streaming;
  if (el) {
    el.hidden = !on;
    el.textContent = on ? "live" : "";
  }
  homeBtn?.classList.toggle("is-working", on);
}

let approvalPollTimer = 0;
function startApprovalPoll() {
  if (approvalPollTimer) return;
  approvalPollTimer = window.setInterval(() => {
    refreshApprovals().catch(() => {});
  }, 2000);
}
function stopApprovalPoll() {
  if (!approvalPollTimer) return;
  clearInterval(approvalPollTimer);
  approvalPollTimer = 0;
}

async function refreshJobs() {
  const data = await api("GET", "/api/cron/jobs");
  state.jobs = data.jobs || [];
  try {
    const runs = await api("GET", "/api/cron/runs?n=200");
    state.jobRuns = runs.runs || [];
  } catch {
    /* last-result is best-effort */
  }
}

function syncChromeToggles() {
  const statusOpen = state.prefs.statusOpen !== false;
  document.body.classList.toggle("status-collapsed", !statusOpen);
  const st = $("#status-toggle");
  if (st) {
    st.setAttribute("aria-expanded", statusOpen ? "true" : "false");
    st.textContent = statusOpen ? "Hide status" : "Show status";
  }
}

async function savePrefs(partial) {
  state.prefs = await api("PUT", "/lite/prefs", partial);
}

function setPage(page) {
  snapshotCurrentChat();
  if (state.page === "activity" && page !== "activity") stopActivityLive();
  if (state.page === "automations" && page !== "automations") state.highlightJobId = null;
  state.page = page;
  document.querySelectorAll(".nav-item[data-page]").forEach((btn) => {
    if (btn.id === "advanced-toggle") return;
    btn.classList.toggle("active", btn.dataset.page === page);
  });
  const adv = $("#advanced-toggle");
  if (adv) {
    adv.classList.toggle("active", page === "advanced");
    adv.classList.toggle("open", state.prefs.advancedOpen || page === "advanced");
  }
  savePrefs({ lastPage: page }).catch(() => {});
  if (page === "home") {
    const liveId = state.chat.streaming ? state.chat.streamingFor : null;
    const focusId = state.pendingHomeAgentId;
    state.pendingHomeAgentId = null;
    const agent =
      (liveId && state.agents.find((a) => a.id === liveId)) ||
      (focusId && state.agents.find((a) => a.id === focusId)) ||
      defaultAgent();
    if (agent) showAgentChat(agent.id);
  }
  render();
  if (page === "home") {
    const agent =
      state.agents.find((a) => a.id === state.chat.loadedFor) || defaultAgent();
    if (agent && !state.chat.streaming) {
      Promise.all([loadChatHistory(agent.id), loadDaemonFeatures(agent.id)]).then(() => {
        if (state.page === "home" && !state.chat.streaming) {
          render();
          scrollChatToLatest({ smooth: false });
        }
      });
    } else if (state.chat.loadedFor && state.chat.streaming) {
      loadDaemonFeatures(state.chat.loadedFor).catch(() => {});
    }
  }
  if (page === "automations" || page === "activity") {
    refreshJobs()
      .then(() => {
        if (state.page === page) render();
      })
      .catch(() => {});
  }
  if (page === "activity") {
    refreshAudit()
      .then(() => {
        if (state.page === "activity") render();
      })
      .catch(() => {});
  }
}

function render() {
  const app = $("#app");
  const main = $("#main");
  const page = state.prefs.setupComplete ? state.page : "setup";
  if (app) app.dataset.page = page;
  document.body.dataset.page = page;
  main.className = page === "home" ? "main home-shell" : "main";
  const shell = document.querySelector(".shell");
  if (shell && shell.scrollTop) shell.scrollTop = 0;
  if (!state.prefs.setupComplete) {
    main.innerHTML = renderSetup();
    bindSetup();
    syncChromeToggles();
    syncWorkingBadge();
    return;
  }
  switch (state.page) {
    case "assistants":
      main.innerHTML = renderAssistants();
      bindAssistants();
      break;
    case "automations":
      main.innerHTML = renderAutomations();
      bindAutomations();
      break;
    case "activity":
      main.innerHTML = renderActivity();
      bindActivity();
      break;
    case "settings":
      main.innerHTML = renderSettings();
      bindSettings();
      break;
    case "advanced":
      main.innerHTML = renderAdvanced();
      bindAdvanced();
      break;
    default:
      main.innerHTML = renderHome();
      bindHome();
  }
  syncChromeToggles();
  syncWorkingBadge();
}

/* ── Setup (3 steps) ─────────────────────────────────────────── */

function renderSetup() {
  const step = state.setupStep;
  return `
    <div class="setup-steps">
      <span class="step ${step === 1 ? "on" : ""}">1 · Provider</span>
      <span class="step ${step === 2 ? "on" : ""}">2 · Assistant</span>
      <span class="step ${step === 3 ? "on" : ""}">3 · First request</span>
    </div>
    <h1>Welcome to ArmaraOS Lite</h1>
    <p class="lead">A personal AI workspace where assistants can chat with you, complete tasks and run automations on your behalf.</p>
    ${step === 1 ? renderSetupProvider() : ""}
    ${step === 2 ? renderSetupAssistant() : ""}
    ${step === 3 ? renderSetupFirst() : ""}
  `;
}

function renderSetupProvider() {
  const options = state.providers
    .filter((p) => SETUP_PROVIDERS.includes(p.id))
    .map((p) => {
      const sel = p.id === state.selectedProvider ? "selected" : "";
      const status = p.auth_status === "configured" ? " · connected" : "";
      return `<option value="${escapeHtml(p.id)}" ${sel}>${escapeHtml(p.display_name || p.id)}${status}</option>`;
    })
    .join("");
  const selected = state.providers.find((p) => p.id === state.selectedProvider);
  const needsKey = selected ? selected.key_required !== false : true;
  const already = selected && selected.auth_status === "configured";
  return `
    <div class="card">
      <h2>Choose a provider</h2>
      <p class="muted">Connect the model that will power your assistants.</p>
      ${state.selectedProvider === "armara" ? armaraKeyHelpHtml() : ""}
      <div class="field">
        <label for="provider-select">Provider</label>
        <select id="provider-select">${options || '<option value="armara">Armara</option>'}</select>
      </div>
      ${
        already
          ? `<p class="key-hint ok">This provider is already connected. Paste a new key only if you want to replace it.</p>`
          : ""
      }
      ${
        needsKey || already
          ? `<div class="field">
              <label for="api-key">${already ? "Replace API key (optional)" : "API key"}</label>
              <input id="api-key" type="password" autocomplete="off" spellcheck="false" placeholder="Paste your Armara / InferX key" value="${escapeHtml(state.apiKey)}" />
              <p class="key-hint" id="setup-key-hint">${escapeHtml(keyLengthHint(state.apiKey.length) || (already ? "" : "Paste your key — you should see dots appear as it lands."))}</p>
            </div>`
          : ""
      }
      <div class="row">
        <button type="button" class="btn btn-primary" id="setup-provider-next">Continue</button>
      </div>
    </div>
  `;
}

function renderSetupAssistant() {
  const cards = CONSUMER_TEMPLATES.map(
    (t, i) => `
    <button type="button" class="template-card ${i === state.selectedTemplate ? "selected" : ""}" data-tpl="${i}">
      <h3>${escapeHtml(t.name)}</h3>
      <p>${escapeHtml(t.description)}</p>
    </button>`,
  ).join("");
  return `
    <div class="card">
      <h2>Choose an assistant</h2>
      <p class="muted">You can add more later from Assistants.</p>
      <div class="grid-2" style="margin:16px 0">${cards}</div>
      <div class="row">
        <button type="button" class="btn btn-ghost" id="setup-back">Back</button>
        <button type="button" class="btn btn-primary" id="setup-create-assistant">Create & continue</button>
      </div>
    </div>
  `;
}

function renderSetupFirst() {
  return `
    <div class="card">
      <h2>What do you want to get done?</h2>
      <p class="muted">Send your first request to finish setup. You can also skip and explore Home.</p>
      <div class="prompt-box" style="margin-top:16px">
        <textarea id="setup-first-prompt" placeholder="e.g. Help me plan my week…"></textarea>
        <div class="prompt-actions">
          <button type="button" class="btn btn-ghost" id="setup-skip">Skip for now</button>
          <button type="button" class="btn btn-primary" id="setup-send-first">Send</button>
        </div>
      </div>
    </div>
  `;
}

function bindSetup() {
  const sel = $("#provider-select");
  if (sel) {
    sel.addEventListener("change", () => {
      state.selectedProvider = sel.value;
      render();
    });
  }
  const key = $("#api-key");
  if (key) {
    const hint = $("#setup-key-hint");
    const syncHint = () => {
      state.apiKey = key.value;
      if (hint) hint.textContent = keyLengthHint(key.value.length) || "Paste your key — you should see dots appear as it lands.";
    };
    key.addEventListener("input", syncHint);
    key.addEventListener("paste", () => setTimeout(syncHint, 0));
  }
  const next = $("#setup-provider-next");
  if (next) {
    next.addEventListener("click", async () => {
      next.disabled = true;
      try {
        const keyVal = ($("#api-key")?.value || "").trim();
        if (keyVal) {
          await api("POST", `/api/providers/${encodeURIComponent(state.selectedProvider)}/key`, { key: keyVal });
          await api("POST", `/api/providers/${encodeURIComponent(state.selectedProvider)}/test`, {});
          await applyProviderToDefaultAssistant(state.selectedProvider);
          toast("Provider connected");
        } else {
          const p = state.providers.find((x) => x.id === state.selectedProvider);
          if (!p || p.auth_status !== "configured") {
            toast("Enter an API key for this provider", true);
            next.disabled = false;
            return;
          }
        }
        state.setupStep = 2;
        render();
      } catch (e) {
        toast(e.message || "Provider setup failed", true);
        next.disabled = false;
      }
    });
  }
  document.querySelectorAll("[data-tpl]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedTemplate = Number(btn.dataset.tpl);
      render();
    });
  });
  $("#setup-back")?.addEventListener("click", () => {
    state.setupStep = 1;
    render();
  });
  $("#setup-create-assistant")?.addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      const tpl = CONSUMER_TEMPLATES[state.selectedTemplate];
      const provider = state.selectedProvider;
      const model = PROVIDER_DEFAULTS[provider] || "armara";
      const name = tpl.name.toLowerCase().replace(/\s+/g, "-");
      const toml =
        `name = "${tomlEscape(name)}"\n` +
        `description = "${tomlEscape(tpl.description)}"\n` +
        `profile = "${tpl.profile}"\n\n` +
        `[model]\nprovider = "${provider}"\n` +
        `model = "${model}"\n` +
        `system_prompt = """\n${tomlMultiline(tpl.system_prompt)}\n"""\n`;
      const res = await api("POST", "/api/agents", { manifest_toml: toml });
      const id = res.agent_id || res.id;
      await savePrefs({ defaultAssistantId: id });
      await refreshAgents();
      toast(`Assistant “${res.name || name}” ready`);
      state.setupStep = 3;
      render();
    } catch (e) {
      toast(e.message || "Could not create assistant", true);
      btn.disabled = false;
    }
  });
  $("#setup-skip")?.addEventListener("click", async () => {
    await savePrefs({ setupComplete: true });
    state.page = "home";
    render();
  });
  $("#setup-send-first")?.addEventListener("click", async () => {
    const text = ($("#setup-first-prompt")?.value || "").trim();
    if (!text) {
      toast("Type a request first", true);
      return;
    }
    await savePrefs({ setupComplete: true });
    state.page = "home";
    state.chat.messages = [];
    render();
    await sendChat(text);
  });
}

/* ── Home ────────────────────────────────────────────────────── */

function renderHome() {
  const agent = defaultAgent();
  const msgs = state.chat.messages.map(messageHtml).join("");
  const chips = HOME_EXAMPLES.map(
    (ex) => `<button type="button" class="chip" data-example="${escapeHtml(ex.prompt)}">${escapeHtml(ex.label)}</button>`,
  ).join("");
  const facts = (state.daemon.facts || [])
    .map((f) => `<span class="memory-chip">${escapeHtml(f)}</span>`)
    .join("");
  const mission = state.daemon.mission;
  const goal = state.daemon.goal;
  const suggestions = (state.daemon.suggestions || [])
    .map(
      (s) =>
        `<button type="button" class="chip" data-suggestion="${escapeHtml(s.title)}">${escapeHtml(s.title)}</button>`,
    )
    .join("");
  const headOpen = state.prefs.homeHeadOpen !== false;
  return `
    <div class="home-head${headOpen ? "" : " is-collapsed"}">
      <div class="home-head-bar">
        ${headOpen ? `<h1>What do you want to get done?</h1>` : `<span class="home-head-hint">Context hidden</span>`}
        <button type="button" class="chrome-toggle chrome-toggle-icon" id="home-head-toggle" aria-expanded="${headOpen ? "true" : "false"}" aria-label="${headOpen ? "Hide context" : "Show context"}" title="${headOpen ? "Hide context" : "Show context"}">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" d="M3.5 6l4.5 4.5L12.5 6"/>
          </svg>
        </button>
      </div>
      ${
        headOpen
          ? `<div class="home-brief">
    <p class="home-brief-byline">${
      agent
        ? `Talking with <strong>${escapeHtml(agent.name)}</strong>`
        : "Create an assistant first from Assistants."
    }</p>
    ${
      mission
        ? `<div class="home-mission">
            <span class="home-kicker">Mission</span>
            <p>${escapeHtml(mission.objective_preview || "Active mission")}<span class="home-mission-state"> · ${escapeHtml(mission.state || "")}</span></p>
            ${
              String(mission.state || "").toLowerCase() === "awaiting_input"
                ? `<div class="row" style="margin-top:8px">
                    <button type="button" class="btn btn-primary btn-sm" id="mission-continue">Continue</button>
                    <button type="button" class="btn btn-ghost btn-sm" id="mission-dismiss">Dismiss</button>
                  </div>`
                : ""
            }
          </div>`
        : ""
    }
    ${
      goal && goal.preview
        ? `<div class="home-goal">
            <div class="home-meta-row">
              <span class="home-kicker">Current goal</span>
              ${
                goal.progress && goal.progress.progress_pct != null
                  ? `<span class="home-goal-pct">${escapeHtml(String(goal.progress.progress_pct))}%</span>`
                  : ""
              }
            </div>
            <p class="home-goal-copy">${escapeHtml(goal.preview)}</p>
            ${
              goal.progress && goal.progress.progress_pct != null
                ? `<div class="home-goal-track" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, Number(goal.progress.progress_pct) || 0))}%"></span></div>`
                : ""
            }
          </div>`
        : ""
    }
    ${
      facts
        ? `<div class="home-memory">
            <span class="home-kicker">Graph memory</span>
            <div class="memory-row">${facts}</div>
          </div>`
        : ""
    }
    <div class="home-try">
      <span class="home-kicker">Try</span>
      <div class="chips">${chips}${suggestions}</div>
    </div>
  </div>`
          : ""
      }
    </div>
    <div class="messages" id="home-messages">${msgs || '<div class="empty">No messages in this chat yet. Send one below — it stays in this session.</div>'}</div>
    <div class="prompt-box prompt-sticky" id="home-prompt-box">
      ${
        (state.chat.files || []).length
          ? `<div class="attach-row" id="home-attach-row">${(state.chat.files || [])
              .map((f, i) => {
                const name = f.name || displayAttachmentName(f.file) || "file";
                const img = f.preview
                  ? `<img src="${escapeHtml(f.preview)}" alt="">`
                  : "";
                return `<span class="attach-chip">${img}<span class="attach-name">${escapeHtml(name)}</span><button type="button" class="attach-remove" data-detach="${i}" aria-label="Remove ${escapeHtml(name)}">×</button></span>`;
              })
              .join("")}</div>`
          : ""
      }
      ${
        state.chat.queue
          ? `<div class="queue-row">
              <span class="queue-chip">Next: ${escapeHtml(String(state.chat.queue.preview || state.chat.queue.text || "queued").slice(0, 80))}</span>
              <button type="button" class="btn btn-ghost btn-sm" id="home-queue-cancel">Cancel</button>
            </div>`
          : ""
      }
      <textarea id="home-prompt" placeholder="Describe a task… or drop a file or folder">${escapeHtml(state.chat.draft || "")}</textarea>
      <input type="file" id="home-file" multiple hidden>
      <input type="file" id="home-folder" webkitdirectory multiple hidden>
      <div class="prompt-actions">
        <div class="prompt-tools">
          ${
            agent
              ? `<button type="button" class="btn btn-ghost btn-sm" id="home-attach">Attach</button>
                 <button type="button" class="btn btn-ghost btn-sm" id="home-attach-folder">Folder</button>`
              : ""
          }
          ${
            agent && (state.chat.sessions || []).length
              ? state.chat.renamingSession
                ? `<div class="session-rename">
                    <input id="home-session-name" maxlength="128" value="${escapeHtml(sessionDisplayName(currentSessionRow() || {}, state.chat.sessions))}" aria-label="Chat name">
                    <button type="button" class="btn btn-primary btn-sm" id="home-session-save">Save</button>
                    <button type="button" class="btn btn-ghost btn-sm" id="home-session-cancel">Cancel</button>
                  </div>`
                : `<select id="home-session" ${state.chat.streaming || state.chat.deletingId ? "disabled" : ""} aria-label="Chat session">
                  ${(state.chat.sessions || [])
                    .map((s) => {
                      const sid = daemonSessionId(s);
                      const sel = sid && sid === state.chat.sessionId ? "selected" : "";
                      return `<option value="${escapeHtml(sid || "")}" ${sel}>${escapeHtml(sessionOptionLabel(s))}</option>`;
                    })
                    .join("")}
                </select>
                <button type="button" class="btn btn-ghost btn-sm" id="home-rename-session" ${state.chat.streaming || state.chat.deletingId ? "disabled" : ""}>Rename</button>
                <button type="button" class="btn btn-ghost btn-sm" id="home-delete-session" ${state.chat.streaming || state.chat.deletingId ? "disabled" : ""}>Delete</button>`
              : ""
          }
          ${
            agent
              ? `<button type="button" class="btn btn-ghost btn-sm" id="home-new-chat" ${state.chat.streaming || state.chat.deletingId ? "disabled" : ""}>New chat</button>`
              : ""
          }
          <span class="muted">${agent ? escapeHtml((agent.model_provider || "") + " / " + (agent.model_name || "")) : ""}</span>
        </div>
        <div class="prompt-send">
          ${
            state.chat.streaming
              ? `<button type="button" class="btn btn-danger" id="home-stop">Stop</button>`
              : ""
          }
          <button type="button" class="btn btn-primary" id="home-send" ${!agent ? "disabled" : ""}>Send</button>
        </div>
      </div>
    </div>
  `;
}

function bindHome() {
  $("#home-head-toggle")?.addEventListener("click", async () => {
    const open = state.prefs.homeHeadOpen !== false;
    await savePrefs({ homeHeadOpen: !open });
    render();
  });
  document.querySelectorAll("[data-example]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ta = $("#home-prompt");
      if (ta) ta.value = btn.dataset.example;
      ta?.focus();
    });
  });
  document.querySelectorAll("[data-suggestion]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ta = $("#home-prompt");
      if (ta) ta.value = btn.dataset.suggestion;
      ta?.focus();
    });
  });
  $("#home-stop")?.addEventListener("click", () => stopChat());
  $("#home-send")?.addEventListener("click", async () => {
    const text = ($("#home-prompt")?.value || "").trim();
    if (!text && !(state.chat.files || []).length) return;
    state.chat.draft = "";
    if ($("#home-prompt")) $("#home-prompt").value = "";
    if (state.chat.streaming) {
      queueChat(text);
      return;
    }
    await sendChat(text);
  });
  $("#home-prompt")?.addEventListener("input", (e) => {
    state.chat.draft = e.target.value;
  });
  $("#home-prompt")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    if (e.shiftKey) return;
    e.preventDefault();
    $("#home-send")?.click();
  });
  $("#home-new-chat")?.addEventListener("click", () => newChat());
  $("#home-session")?.addEventListener("change", (e) => {
    switchChatSession(e.target.value);
  });
  $("#home-rename-session")?.addEventListener("click", () => {
    if (state.chat.streaming) return;
    state.chat.renamingSession = true;
    render();
    $("#home-session-name")?.focus();
    $("#home-session-name")?.select();
  });
  $("#home-delete-session")?.addEventListener("click", () => deleteCurrentSession());
  $("#home-queue-cancel")?.addEventListener("click", () => {
    clearQueuedChat();
    render();
  });
  $("#home-session-cancel")?.addEventListener("click", () => {
    state.chat.renamingSession = false;
    render();
  });
  $("#home-session-save")?.addEventListener("click", () => saveSessionLabel());
  $("#home-session-name")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveSessionLabel();
    }
    if (e.key === "Escape") {
      state.chat.renamingSession = false;
      render();
    }
  });
  $("#home-attach")?.addEventListener("click", () => $("#home-file")?.click());
  $("#home-attach-folder")?.addEventListener("click", () => $("#home-folder")?.click());
  $("#home-file")?.addEventListener("change", (e) => {
    addPendingFiles(e.target.files);
    e.target.value = "";
  });
  $("#home-folder")?.addEventListener("change", (e) => {
    addPendingFiles(e.target.files);
    e.target.value = "";
  });
  bindPromptDrop($("#home-prompt-box"));
  document.querySelectorAll("[data-detach]").forEach((btn) => {
    btn.addEventListener("click", () => {
      removePendingFile(Number(btn.dataset.detach));
    });
  });
  bindApprovalButtons();
  $("#mission-continue")?.addEventListener("click", async () => {
    const mission = state.daemon.mission;
    const text =
      (mission && mission.objective_preview) ||
      "Continue the active mission until output is complete.";
    await sendChat(text);
  });
  $("#mission-dismiss")?.addEventListener("click", async () => {
    const mission = state.daemon.mission;
    const agent = defaultAgent();
    const id = mission && (mission.mission_id || mission.id);
    if (!id || !agent) return;
    try {
      await api(
        "POST",
        `/api/missions/${encodeURIComponent(id)}/cancel?agent_id=${encodeURIComponent(agent.id)}`,
        {},
      );
      await loadDaemonFeatures(agent.id);
      toast("Mission dismissed");
      render();
    } catch (e) {
      toast(e.message || "Could not dismiss mission", true);
    }
  });
  bindMessageChrome();
}

let messageChromeBound = false;
function bindMessageChrome() {
  if (messageChromeBound) return;
  messageChromeBound = true;
  document.addEventListener("click", async (e) => {
    const copy = e.target.closest("[data-copy-code]");
    if (!copy) return;
    const code = copy.closest(".msg-code")?.querySelector("code");
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.textContent || "");
      copy.textContent = "Copied";
      setTimeout(() => {
        copy.textContent = "Copy";
      }, 1200);
    } catch {
      toast("Could not copy", true);
    }
  });
}

function bindPromptDrop(box) {
  if (!box || box.dataset.dropBound === "1") return;
  box.dataset.dropBound = "1";
  const on = (e) => {
    e.preventDefault();
    box.classList.add("is-drop");
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  box.addEventListener("dragenter", on);
  box.addEventListener("dragover", on);
  box.addEventListener("dragleave", (e) => {
    if (!box.contains(e.relatedTarget)) box.classList.remove("is-drop");
  });
  box.addEventListener("drop", (e) => {
    e.preventDefault();
    box.classList.remove("is-drop");
    collectDroppedFiles(e).then((files) => addPendingFiles(files)).catch(() => {
      addPendingFiles(e.dataTransfer && e.dataTransfer.files);
    });
  });
}

async function collectDroppedFiles(e) {
  const dt = e && e.dataTransfer;
  if (!dt) return [];
  const items = dt.items;
  if (items && items.length) {
    const files = [];
    const tasks = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
      if (entry) tasks.push(walkFsEntry(entry, files, entry.isDirectory ? entry.name : ""));
    }
    if (tasks.length) {
      await Promise.all(tasks);
      if (files.length) return files;
    }
  }
  return [...(dt.files || [])];
}

async function walkFsEntry(entry, out, relPath) {
  if (!entry || out.length > MAX_PENDING_FILES) return;
  const rel = relPath || entry.name || "";
  if (dropPathBlocked(rel)) return;
  if (String(rel).split("/").filter(Boolean).length > 8) return;
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    if (rel && rel !== file.name) {
      try {
        file.litePath = rel;
      } catch {
        /* native File may reject extra fields */
      }
    }
    out.push(file);
    return;
  }
  if (!entry.isDirectory) return;
  const reader = entry.createReader();
  const readBatch = () =>
    new Promise((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
  const children = [];
  for (;;) {
    const batch = await readBatch();
    if (!batch.length) break;
    children.push(...batch);
  }
  for (const child of children) {
    if (out.length > MAX_PENDING_FILES) break;
    const childRel = rel ? `${rel}/${child.name}` : child.name;
    await walkFsEntry(child, out, childRel);
  }
}

function addPendingFiles(list) {
  if (!list || !list.length) return;
  const next = state.chat.files || [];
  const before = next.length;
  for (const file of list) {
    if (next.length >= MAX_PENDING_FILES) {
      toast(`You can attach up to ${MAX_PENDING_FILES} files at a time`, true);
      break;
    }
    const name = displayAttachmentName(file);
    if (dropPathBlocked(name)) continue;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast(`"${name}" is over 128MB`, true);
      continue;
    }
    if (!attachmentAllowed(file)) {
      toast(`That file type isn’t supported: ${name}`, true);
      continue;
    }
    let preview = null;
    if (isImageAttachment(file) && String(file.type || "").startsWith("image/")) {
      try {
        preview = URL.createObjectURL(file);
      } catch {
        preview = null;
      }
    }
    next.push({ file, preview, name });
  }
  state.chat.files = next;
  if (state.page === "home" && next.length !== before) render();
}

function removePendingFile(index) {
  const files = state.chat.files || [];
  const gone = files[index];
  if (gone && gone.preview) {
    try {
      URL.revokeObjectURL(gone.preview);
    } catch {
      /* ignore */
    }
  }
  state.chat.files = files.filter((_, i) => i !== index);
  if (state.page === "home") render();
}

function clearPendingFiles() {
  for (const f of state.chat.files || []) {
    if (f.preview) {
      try {
        URL.revokeObjectURL(f.preview);
      } catch {
        /* ignore */
      }
    }
  }
  state.chat.files = [];
}

async function uploadChatFile(agentId, file, filename) {
  const form = new FormData();
  form.append("file", file);
  form.append("filename", filename || displayAttachmentName(file));
  let res;
  try {
    res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/upload`, {
      method: "POST",
      body: form,
    });
  } catch (e) {
    markLiteOffline();
    const err = new Error("Can't reach the Lite workspace to upload that file.");
    err.cause = e;
    throw err;
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error((data && (data.error || data.message)) || `Upload failed (${res.status})`);
  }
  return data;
}

async function maybeAutoLabelSession(agentId, seed) {
  const sid = state.chat.sessionId;
  if (!sid) return;
  const row = currentSessionRow();
  if (row && String(row.label || "").trim()) return;
  const label = sanitizeSessionLabel(seed, 40);
  if (!label) return;
  try {
    await api("PUT", `/api/sessions/${encodeURIComponent(sid)}/label`, { label });
    const row = (state.chat.sessions || []).find((s) => daemonSessionId(s) === sid);
    if (row) row.label = label;
    const sel = $("#home-session");
    const opt = sel && [...sel.options].find((o) => o.value === sid);
    if (opt) opt.textContent = label;
    await loadSessionList(agentId);
  } catch {
    /* labeling is best-effort */
  }
}

async function saveSessionLabel() {
  const agent = defaultAgent();
  const sid = state.chat.sessionId;
  const raw = ($("#home-session-name")?.value || "").trim();
  const label = sanitizeSessionLabel(raw, 128);
  if (!agent || !sid) return;
  if (!label) {
    toast("Use letters, numbers, spaces, hyphens, or underscores", true);
    return;
  }
  try {
    await api("PUT", `/api/sessions/${encodeURIComponent(sid)}/label`, { label });
    state.chat.renamingSession = false;
    await loadSessionList(agent.id);
    toast("Chat renamed");
    render();
  } catch (e) {
    toast(e.message || "Could not rename this chat", true);
  }
}

function queueChat(text) {
  const files = [...(state.chat.files || [])];
  const names = files.map((f) => f.name || displayAttachmentName(f.file) || "").filter(Boolean);
  const composed = composeUserMessage(text, names);
  if (!composed) return;
  if (state.chat.queue && Array.isArray(state.chat.queue.files)) {
    for (const f of state.chat.queue.files) {
      if (f.preview && !files.includes(f)) {
        try {
          URL.revokeObjectURL(f.preview);
        } catch {
          /* ignore */
        }
      }
    }
  }
  state.chat.files = [];
  state.chat.queue = {
    text,
    files,
    preview: stripFileTags(composed) || names[0] || "queued",
  };
  toast("Queued — sends when this reply finishes");
  if (state.page === "home") render();
}

function clearQueuedChat() {
  const q = state.chat.queue;
  if (q && Array.isArray(q.files)) {
    for (const f of q.files) {
      if (f.preview) {
        try {
          URL.revokeObjectURL(f.preview);
        } catch {
          /* ignore */
        }
      }
    }
  }
  state.chat.queue = null;
}

async function flushQueuedChat() {
  const next = state.chat.queue;
  if (!next || state.chat.streaming) return;
  state.chat.queue = null;
  state.chat.files = next.files || [];
  await sendChat(next.text || "");
}

async function deleteCurrentSession() {
  const agent = defaultAgent();
  const sid = state.chat.sessionId;
  if (
    !agent ||
    shouldIgnoreSessionDeleteClick({
      sid,
      streaming: state.chat.streaming,
      deletingId: state.chat.deletingId,
    })
  ) {
    return;
  }
  const name = sessionOptionLabel(currentSessionRow() || { session_id: sid });
  state.chat.deletingId = sid;
  if (state.page === "home") render();
  try {
    if (!window.confirm(sessionDeleteConfirmMessage(name))) return;
    if (state.chat.deletingId !== sid) return;
    await api("DELETE", `/api/sessions/${encodeURIComponent(sid)}`);
    const key = threadCacheKey(agent.id, sid);
    delete _agentMsgCache[key];
    try {
      sessionStorage.removeItem(LITE_MSG_CACHE_PREFIX + key);
    } catch {
      /* ignore */
    }
    await loadSessionList(agent.id);
    const remaining = (state.chat.sessions || []).filter((s) => daemonSessionId(s) !== sid);
    state.chat.sessions = remaining;
    toast("Chat deleted");
    if (remaining.length) {
      await switchChatSession(daemonSessionId(remaining[0]));
    } else {
      await newChat();
    }
  } catch (e) {
    toast(e.message || "Could not delete this chat", true);
  } finally {
    if (state.chat.deletingId === sid) state.chat.deletingId = null;
    if (state.page === "home") render();
  }
}

async function newChat() {
  const agent = defaultAgent();
  if (!agent || state.chat.streaming) return;
  snapshotCurrentChat();
  try {
    const res = await api("POST", `/api/agents/${encodeURIComponent(agent.id)}/sessions`, {});
    const sid = daemonSessionId(res);
    rememberSessionId(agent.id, sid);
    state.chat.messages = [];
    state.chat.loadedFor = agent.id;
    state.chat.sessionId = sid;
    state.chat.renamingSession = false;
    persistMsgCache(agent.id, [], sid);
    await loadSessionList(agent.id);
    toast("New chat");
    render();
  } catch (e) {
    toast(e.message || "Could not start a new chat", true);
  }
}

async function switchChatSession(sid) {
  const agent = defaultAgent();
  if (!agent || !sid || state.chat.streaming) return;
  if (sid === state.chat.sessionId) return;
  snapshotCurrentChat();
  try {
    await api(
      "POST",
      `/api/agents/${encodeURIComponent(agent.id)}/sessions/${encodeURIComponent(sid)}/switch`,
      {},
    );
    rememberSessionId(agent.id, sid);
    state.chat.loadedFor = agent.id;
    state.chat.sessionId = sid;
    state.chat.renamingSession = false;
    const cached = restoreMsgCache(agent.id, sid);
    state.chat.messages = cached;
    for (const s of state.chat.sessions || []) s.active = daemonSessionId(s) === sid;
    if (!cached.length) await loadChatHistory(agent.id, { force: true });
    loadDaemonFeatures(agent.id).catch(() => {});
    render();
    scrollChatToLatest({ smooth: false });
  } catch (e) {
    toast(e.message || "Could not switch chat", true);
  }
}

let stopWatchdog = 0;
async function stopChat() {
  if (!state.chat.streaming) return;
  state.chat.stopRequested = true;
  try {
    state.chat.abort?.abort();
  } catch {
    /* already closed */
  }
  const agent = defaultAgent();
  if (agent) {
    try {
      await Promise.race([
        api("POST", `/api/agents/${encodeURIComponent(agent.id)}/stop`, {}),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch {
      /* stream abort is enough if stop endpoint fails */
    }
  }
  clearTimeout(stopWatchdog);
  stopWatchdog = window.setTimeout(() => {
    if (!state.chat.streaming) return;
    try {
      state.chat.abort?.abort();
    } catch {
      /* already closed */
    }
    state.chat.streaming = false;
    state.chat.streamingFor = null;
    state.chat.abort = null;
    stopApprovalPoll();
    syncWorkingBadge();
    if (state.page === "home") render();
  }, 2500);
}

async function sendChat(text) {
  const agent = defaultAgent();
  if (!agent) {
    toast("No assistant available", true);
    return;
  }
  if (state.chat.streaming) return;
  const agentId = agent.id;
  const pending = [...(state.chat.files || [])];
  const attachments = [];
  const sendBtn = $("#home-send");
  if (sendBtn && pending.length) {
    sendBtn.disabled = true;
    sendBtn.textContent = "Uploading…";
  }
  try {
    for (const item of pending) {
      const uploaded = await uploadChatFile(agentId, item.file, item.name);
      attachments.push({
        file_id: uploaded.file_id,
        filename: uploaded.filename || item.name || item.file.name,
        content_type: uploaded.content_type || item.file.type || "application/octet-stream",
      });
    }
  } catch (e) {
    toast(e.message || "Could not attach that file", true);
    if (state.page === "home") render();
    return;
  }
  clearPendingFiles();
  const filenames = attachments.map((a) => a.filename);
  const finalText = composeUserMessage(text, filenames);
  if (!finalText) return;

  const body = { message: finalText };
  if (attachments.length) body.attachments = attachments;

  showAgentChat(agentId);
  const thread = state.chat.messages;
  thread.push({
    role: "user",
    text: finalText,
    files: attachments.map((a) => ({ filename: a.filename, file_id: a.file_id })),
  });
  thread.push({ role: "assistant", text: "" });
  persistMsgCache(agentId, thread, state.chat.sessionId);
  state.chat.streaming = true;
  state.chat.streamingFor = agentId;
  state.chat.stopRequested = false;
  startApprovalPoll();
  syncWorkingBadge();
  if (state.page === "home" && state.chat.loadedFor === agentId) {
    render();
    scrollChatToLatest({ smooth: false });
  }

  const assistantIdx = thread.length - 1;
  let gotText = false;
  const live = () => state.chat.loadedFor === agentId && state.chat.messages === thread;
  try {
    await attachDaemonSession(agentId);
    maybeAutoLabelSession(agentId, stripFileTags(finalText) || filenames[0] || "").catch(() => {});
    const ac = new AbortController();
    state.chat.abort = ac;
    await streamMessage(agentId, body, (ev, payload) => {
      if (ac.signal.aborted) return;
      if (ev === "chunk") {
        const t = streamVisibleDelta(ev, payload);
        if (t) {
          thread[assistantIdx].text += t;
          gotText = true;
          persistMsgCache(agentId, thread);
          if (looksLikeLeakedReasoning(thread[assistantIdx].text)) {
            ac.abort();
            return;
          }
          if (live() && state.page === "home") patchLastAssistant();
        }
      } else if (ev === "tool_use" || ev === "tool_start" || ev === "tool" || ev === "tool_call") {
        const name = payload.name || payload.tool || payload.tool_name || "tool";
        thread.push({
          kind: "working",
          text: `Working · ${name}`,
        });
        persistMsgCache(agentId, thread);
        if (live() && state.page === "home") {
          render();
          scrollChatToLatest({ smooth: false });
        }
      } else if (ev === "phase") {
        const phase = String(payload.phase || "");
        const detail = String(payload.detail || "");
        const blob = `${phase} ${detail}`;
        if (/graph|memory|mission|ainl|skill|tool|think/i.test(blob)) {
          const label = detail || phase;
          const last = thread[thread.length - 1];
          if (last && last.kind === "working") last.text = `Working · ${label}`;
          else thread.push({ kind: "working", text: `Working · ${label}` });
          persistMsgCache(agentId, thread);
          if (live() && state.page === "home") {
            render();
            scrollChatToLatest({ smooth: false });
          }
        }
      } else if (ev === "error") {
        toast(payload.error || payload.message || "Stream error", true);
      }
    }, ac.signal);
    if (state.chat.stopRequested) {
      if (!String(thread[assistantIdx].text || "").trim()) thread[assistantIdx].text = "Stopped.";
    } else {
      const raw = thread[assistantIdx].text;
      const leaked = looksLikeLeakedReasoning(raw);
      const cleaned = leaked ? "" : cleanAssistantText(raw);
      thread[assistantIdx].text = cleaned;
      if (leaked) {
        thread[assistantIdx].text =
          "That reply got tangled internally. Try sending the message again.";
      } else if (!gotText && !cleaned) {
        const res = await api("POST", `/api/agents/${encodeURIComponent(agentId)}/message`, body);
        const t = cleanAssistantText(res.response || res.message || res.text || "");
        thread[assistantIdx].text =
          looksLikeLeakedReasoning(t)
            ? "That reply got tangled internally. Try sending the message again."
            : t || "(No reply — try another assistant in Settings)";
      }
    }
  } catch (e) {
    if (e && e.name === "AbortError") {
      if (state.chat.stopRequested) {
        if (!String(thread[assistantIdx].text || "").trim()) thread[assistantIdx].text = "Stopped.";
      } else {
        thread[assistantIdx].text =
          "That reply got tangled internally. Try sending the message again.";
      }
    } else {
      toast(e.message || "Chat failed", true);
      thread[assistantIdx].text = thread[assistantIdx].text || `(Error: ${e.message})`;
    }
  }
  const stopped = !!state.chat.stopRequested;
  state.chat.abort = null;
  state.chat.stopRequested = false;
  persistMsgCache(agentId, thread, state.chat.sessionId);
  state.chat.streaming = false;
  state.chat.streamingFor = null;
  clearTimeout(stopWatchdog);
  stopApprovalPoll();
  syncWorkingBadge();
  await refreshApprovals();
  mergeApprovalsIntoThread(thread);
  persistMsgCache(agentId, thread);
  if (state.page === "home" && live()) {
    render();
    scrollChatToLatest({ smooth: true });
  }
  loadDaemonFeatures(agentId).catch(() => {});
  if (!stopped) await flushQueuedChat();
}

function scrollChatToLatest(opts) {
  const box = $("#home-messages");
  if (!box) return;
  box.scrollTo({
    top: box.scrollHeight,
    behavior: opts && opts.smooth ? "smooth" : "auto",
  });
}

let scrollChatRaf = 0;
function scheduleScrollChatToLatest() {
  if (scrollChatRaf) return;
  scrollChatRaf = requestAnimationFrame(() => {
    scrollChatRaf = 0;
    scrollChatToLatest({ smooth: false });
  });
}

function patchLastAssistant() {
  const box = $("#home-messages");
  if (!box) return;
  const last = [...box.querySelectorAll(".msg.assistant")].pop();
  const msg = [...state.chat.messages].reverse().find((m) => m.role === "assistant");
  if (last && msg) last.outerHTML = messageHtml(msg);
  scheduleScrollChatToLatest();
}

async function streamMessage(agentId, body, onEvent, signal) {
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/message/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = `Stream failed (${res.status})`;
    try {
      msg = JSON.parse(text).error || msg;
    } catch {
      if (text) msg = text.slice(0, 200);
    }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    if (signal && signal.aborted) break;
    const { done, value } = await readStreamChunk(reader, signal, STREAM_IDLE_MS);
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() || "";
    for (const block of parts) {
      let ev = "message";
      const dataLines = [];
      for (const line of block.split("\n")) {
        if (!line || line[0] === ":") continue;
        if (line.startsWith("event:")) ev = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      let payload = {};
      try {
        payload = JSON.parse(dataLines.join("\n"));
      } catch {
        payload = { raw: dataLines.join("\n") };
      }
      onEvent(ev, payload);
    }
  }
}

async function handleApproval(id, approve, extra = {}) {
  try {
    const path = approve
      ? `/api/approvals/${encodeURIComponent(id)}/approve`
      : `/api/approvals/${encodeURIComponent(id)}/reject`;
    await api("POST", path, approve ? approvePayload(extra) : {});
    state.chat.messages = state.chat.messages.filter((m) => !(m.kind === "approval" && m.id === id));
    delete state.approvalDrafts[id];
    toast(approve ? "Approved" : "Denied");
    await refreshApprovals();
    render();
  } catch (e) {
    toast(e.message || "Approval failed", true);
  }
}

function liveApproval(id) {
  return (state.approvals || []).find((a) => String(a.id || a.approval_id) === String(id)) || null;
}

function approvalActionButtons(a) {
  const rawId = a.id || a.approval_id || "";
  const id = escapeHtml(rawId);
  const deny = `<button type="button" class="btn btn-danger btn-sm" data-reject="${id}">Deny</button>`;
  const actions = approvalActions(a);
  if (actions.mode === "choices") {
    const choices = actions.options
      .map((opt) => {
        const enc = escapeHtml(opt);
        return `<button type="button" class="btn btn-ok btn-sm" data-approve-answer="${id}" data-answer="${enc}">${enc}</button>`;
      })
      .join("");
    return `<div class="row activity-actions">${choices}${deny}</div>`;
  }
  if (actions.mode === "question_text") {
    const draft = escapeHtml(state.approvalDrafts[rawId] || "");
    return `<div class="approval-answer">
      <input type="text" class="approval-answer-input" data-approval-draft="${id}" maxlength="500" placeholder="Your answer…" aria-label="Your answer" value="${draft}">
      <div class="row activity-actions">
        <button type="button" class="btn btn-ok btn-sm" data-approve-typed="${id}">Send answer</button>
        ${deny}
      </div>
    </div>`;
  }
  if (actions.mode === "allow_once") {
    return `<div class="row activity-actions">
      <button type="button" class="btn btn-ok btn-sm" data-approve-scope="${id}" data-scope="once">Allow once</button>
      <button type="button" class="btn btn-ghost btn-sm" data-approve-scope="${id}" data-scope="session">Allow this turn</button>
      ${deny}
    </div>`;
  }
  return `<div class="row activity-actions">
    <button type="button" class="btn btn-ok btn-sm" data-approve="${id}">Approve</button>
    ${deny}
  </div>`;
}

function bindApprovalButtons() {
  document.querySelectorAll("[data-approve]").forEach((btn) => {
    btn.addEventListener("click", () => handleApproval(btn.dataset.approve, true));
  });
  document.querySelectorAll("[data-approve-scope]").forEach((btn) => {
    btn.addEventListener("click", () =>
      handleApproval(btn.dataset.approveScope, true, { scope: btn.dataset.scope }),
    );
  });
  document.querySelectorAll("[data-approve-answer]").forEach((btn) => {
    btn.addEventListener("click", () =>
      handleApproval(btn.dataset.approveAnswer, true, { answer: btn.dataset.answer }),
    );
  });
  document.querySelectorAll("[data-approval-draft]").forEach((el) => {
    el.addEventListener("input", () => {
      state.approvalDrafts[el.dataset.approvalDraft] = el.value;
    });
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      submitTypedApproval(el.dataset.approvalDraft);
    });
  });
  document.querySelectorAll("[data-approve-typed]").forEach((btn) => {
    btn.addEventListener("click", () => submitTypedApproval(btn.dataset.approveTyped));
  });
  document.querySelectorAll("[data-reject]").forEach((btn) => {
    btn.addEventListener("click", () => handleApproval(btn.dataset.reject, false));
  });
}

function submitTypedApproval(id) {
  const input = document.querySelector(`[data-approval-draft="${id}"]`);
  const answer = String((input && input.value) || state.approvalDrafts[id] || "").trim();
  if (!answer) {
    toast("Type an answer first", true);
    return;
  }
  handleApproval(id, true, { answer });
}

/* ── Assistants ──────────────────────────────────────────────── */

function sanitizeAgentName(raw) {
  return String(raw || "")
    .replace(/[/\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}

function resetAssistantUi() {
  state.assistantUi = {
    editId: null,
    name: "",
    description: "",
    prompt: "",
    modelId: null,
    modelQuery: "",
  };
}

async function ensureModelsCatalog() {
  if (state.modelsCatalog && state.modelsCatalog.length) return;
  try {
    const data = await api("GET", "/api/models?available=true");
    state.modelsCatalog = data.models || [];
  } catch {
    state.modelsCatalog = [];
  }
}

async function ensureModels(provider) {
  if (!provider) return;
  if (Object.prototype.hasOwnProperty.call(state.modelsByProvider, provider)) return;
  try {
    const data = await api(
      "GET",
      `/api/models?available=true&provider=${encodeURIComponent(provider)}`,
    );
    state.modelsByProvider[provider] = data.models || [];
  } catch {
    state.modelsByProvider[provider] = [];
  }
}

function modelCatalogFor(agent) {
  const provider = (agent && agent.model_provider) || "";
  const seen = new Set();
  const rows = [];
  function add(id, label, prov) {
    if (!id || seen.has(id)) return;
    seen.add(id);
    rows.push({
      id,
      label: label || id,
      provider: prov || provider,
    });
  }
  if (agent) add(agent.model_name, agent.model_name, provider);
  const def = PROVIDER_DEFAULTS[provider];
  if (def) add(def, def, provider);
  for (const p of state.providers || []) {
    if (p.auth_status !== "configured") continue;
    const fallback = PROVIDER_DEFAULTS[p.id];
    if (fallback) add(fallback, `${fallback} · ${p.display_name || p.id}`, p.id);
  }
  const catalog = [
    ...(state.modelsCatalog || []),
    ...((agent && state.modelsByProvider[provider]) || []),
  ];
  for (const m of catalog) {
    const label = m.display_name && m.display_name !== m.id ? `${m.display_name} · ${m.provider || ""}` : m.id;
    add(m.id, label, m.provider || provider);
  }
  return filterModels(rows, state.assistantUi.modelQuery, 50);
}

function modelOptionsHtml(agent) {
  const current = agent.model_name || "";
  return modelCatalogFor(agent)
    .map((m) => {
      const sel = m.id === current ? "selected" : "";
      return `<option value="${escapeHtml(m.id)}" data-provider="${escapeHtml(m.provider || "")}" ${sel}>${escapeHtml(m.label)}</option>`;
    })
    .join("");
}

function renderAssistantCard(a) {
  const isDefault = state.prefs.defaultAssistantId === a.id;
  const editing = state.assistantUi.editId === a.id;
  const modeling = state.assistantUi.modelId === a.id;
  const busy = state.chat.streaming && state.chat.streamingFor === a.id;
  let body;
  if (editing) {
    body = `<div class="assistant-edit">
      <label class="field-label" for="assistant-rename">Name</label>
      <input id="assistant-rename" maxlength="64" value="${escapeHtml(state.assistantUi.name || a.name)}" aria-label="Assistant name">
      <label class="field-label" for="assistant-description">What they help with</label>
      <textarea id="assistant-description" maxlength="280" rows="2" aria-label="Description">${escapeHtml(state.assistantUi.description || "")}</textarea>
      <label class="field-label" for="assistant-prompt">Instructions</label>
      <textarea id="assistant-prompt" maxlength="4000" rows="5" aria-label="Instructions">${escapeHtml(state.assistantUi.prompt || "")}</textarea>
      <div class="assistant-actions">
        <button type="button" class="btn btn-primary btn-sm" data-save-edit="${escapeHtml(a.id)}">Save</button>
        <button type="button" class="btn btn-ghost btn-sm" data-cancel-edit="1">Cancel</button>
      </div>
    </div>`;
  } else if (modeling) {
    body = `<div class="assistant-edit">
      <p class="muted">${escapeHtml(a.name)}</p>
      <input id="assistant-model-search" value="${escapeHtml(state.assistantUi.modelQuery || "")}" placeholder="Search models" aria-label="Search models">
      <select id="assistant-model" size="6" aria-label="Model">${modelOptionsHtml(a) || "<option disabled>No models match</option>"}</select>
      <div class="assistant-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-cancel-edit="1">Done</button>
      </div>
    </div>`;
  } else {
    const desc = String(a.description || "").trim();
    body = `<button type="button" class="assistant-open" data-open-agent="${escapeHtml(a.id)}">
      <h3>${escapeHtml(a.name)} ${isDefault ? '<span class="pill on">default</span>' : ""}${busy ? '<span class="pill">live</span>' : ""}</h3>
      <p>${escapeHtml(a.model_provider || "")} / ${escapeHtml(a.model_name || "")} · ${escapeHtml(a.state || "")}</p>
      ${desc ? `<p class="assistant-desc">${escapeHtml(desc)}</p>` : ""}
    </button>
    <div class="assistant-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-edit-agent="${escapeHtml(a.id)}">Edit</button>
      <button type="button" class="btn btn-ghost btn-sm" data-model-agent="${escapeHtml(a.id)}">Model</button>
      <button type="button" class="btn btn-danger btn-sm" data-delete-agent="${escapeHtml(a.id)}">Delete</button>
    </div>`;
  }
  return `<div class="assistant-card">${body}</div>`;
}

function renderAssistants() {
  const list = state.agents.filter(isConsumerAgent);
  const cards = list.length
    ? list.map(renderAssistantCard).join("")
    : `<div class="empty">No assistants yet. Create one below.</div>`;
  const tpls = CONSUMER_TEMPLATES.map(
    (t, i) => `
    <button type="button" class="template-card" data-create-tpl="${i}">
      <h3>+ ${escapeHtml(t.name)}</h3>
      <p>${escapeHtml(t.description)}</p>
    </button>`,
  ).join("");
  return `
    <h1>Assistants</h1>
    <p class="lead">People you can chat with and assign work to.</p>
    <div class="grid-2">${cards}</div>
    <h2 style="margin-top:32px">Add an assistant</h2>
    <div class="grid-2" style="margin-top:12px">${tpls}</div>
  `;
}

async function openAssistantChat(nextId) {
  if (state.chat.streaming && state.chat.streamingFor && nextId !== state.chat.streamingFor) {
    toast("Wait for the reply to finish, or tap Stop on Home.");
    return;
  }
  snapshotCurrentChat();
  if (nextId !== state.prefs.defaultAssistantId) {
    await savePrefs({ defaultAssistantId: nextId });
    toast("Default assistant updated");
  }
  showAgentChat(nextId);
  setPage("home");
}

async function beginAssistantEdit(id) {
  const agent = state.agents.find((a) => a.id === id);
  if (!agent) return;
  let description = String(agent.description || "");
  let prompt = "";
  try {
    const detail = await api("GET", `/api/agents/${encodeURIComponent(id)}`);
    const row = detail && (detail.agent || detail);
    if (row && typeof row.description === "string") description = row.description;
    prompt = String((row && (row.system_prompt || row.systemPrompt)) || "");
  } catch {
    /* list payload is enough to open the editor */
  }
  state.assistantUi = {
    editId: id,
    name: agent.name || "",
    description,
    prompt,
    modelId: null,
    modelQuery: "",
  };
  render();
  $("#assistant-rename")?.focus();
  $("#assistant-rename")?.select();
}

async function saveAssistantEdit(id) {
  const name = sanitizeAgentName($("#assistant-rename")?.value || state.assistantUi.name || "");
  if (!name) {
    toast("Give this assistant a name", true);
    return;
  }
  const description = String($("#assistant-description")?.value ?? state.assistantUi.description ?? "")
    .trim()
    .slice(0, 280);
  const promptRaw = String($("#assistant-prompt")?.value ?? state.assistantUi.prompt ?? "");
  const body = { name, description };
  if (promptRaw.trim()) body.system_prompt = promptRaw;
  try {
    await api("PATCH", `/api/agents/${encodeURIComponent(id)}`, body);
    resetAssistantUi();
    await refreshAgents();
    const row = state.agents.find((a) => a.id === id);
    if (row) row.description = description;
    toast("Assistant updated");
    render();
  } catch (e) {
    toast(e.message || "Could not update this assistant", true);
  }
}

async function applyAssistantModel(id, model, provider) {
  if (!model) return;
  try {
    await api("PUT", `/api/agents/${encodeURIComponent(id)}/model`, {
      model,
      provider,
    });
    await refreshAgents();
    resetAssistantUi();
    toast("Model updated");
    render();
  } catch (e) {
    toast(e.message || "Could not change the model", true);
  }
}

async function deleteAssistant(id) {
  const agent = state.agents.find((a) => a.id === id);
  if (!agent) return;
  if (state.chat.streaming && state.chat.streamingFor === id) {
    toast("Stop the live reply before deleting this assistant.");
    return;
  }
  const ok = window.confirm(`Delete ${agent.name}? This cannot be undone.`);
  if (!ok) return;
  try {
    await api("DELETE", `/api/agents/${encodeURIComponent(id)}`);
    purgeAgentCache(id);
    await refreshAgents();
    if (state.prefs.defaultAssistantId === id) {
      const next =
        state.agents.find((a) => isConsumerAgent(a) && /^armara$/i.test(String(a.name || ""))) ||
        state.agents.find(isPreferredAssistant) ||
        state.agents.find(isConsumerAgent) ||
        null;
      await savePrefs({ defaultAssistantId: next ? next.id : null });
      if (next) showAgentChat(next.id);
      else {
        state.chat.messages = [];
        state.chat.loadedFor = null;
        state.chat.sessionId = null;
      }
    }
    toast(`Deleted ${agent.name}`);
    render();
  } catch (e) {
    toast(e.message || "Could not delete this assistant", true);
  }
}

function bindAssistants() {
  document.querySelectorAll("[data-open-agent]").forEach((el) => {
    el.addEventListener("click", () => openAssistantChat(el.dataset.openAgent));
  });
  document.querySelectorAll("[data-edit-agent]").forEach((btn) => {
    btn.addEventListener("click", () => beginAssistantEdit(btn.dataset.editAgent));
  });
  document.querySelectorAll("[data-model-agent]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.modelAgent;
      const agent = state.agents.find((a) => a.id === id);
      state.assistantUi = {
        editId: null,
        name: "",
        description: "",
        prompt: "",
        modelId: id,
        modelQuery: "",
      };
      render();
      await Promise.all([
        ensureModelsCatalog(),
        agent ? ensureModels(agent.model_provider) : Promise.resolve(),
      ]);
      if (state.page === "assistants" && state.assistantUi.modelId === id) render();
    });
  });
  document.querySelectorAll("[data-delete-agent]").forEach((btn) => {
    btn.addEventListener("click", () => deleteAssistant(btn.dataset.deleteAgent));
  });
  document.querySelectorAll("[data-save-edit]").forEach((btn) => {
    btn.addEventListener("click", () => saveAssistantEdit(btn.dataset.saveEdit));
  });
  document.querySelectorAll("[data-cancel-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      resetAssistantUi();
      render();
    });
  });
  $("#assistant-rename")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (state.assistantUi.editId) saveAssistantEdit(state.assistantUi.editId);
    }
    if (e.key === "Escape") {
      resetAssistantUi();
      render();
    }
  });
  $("#assistant-rename")?.addEventListener("input", (e) => {
    state.assistantUi.name = e.target.value;
  });
  $("#assistant-description")?.addEventListener("input", (e) => {
    state.assistantUi.description = e.target.value;
  });
  $("#assistant-prompt")?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      resetAssistantUi();
      render();
    }
  });
  $("#assistant-prompt")?.addEventListener("input", (e) => {
    state.assistantUi.prompt = e.target.value;
  });
  $("#assistant-description")?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      resetAssistantUi();
      render();
    }
  });
  $("#assistant-model-search")?.addEventListener("input", (e) => {
    state.assistantUi.modelQuery = e.target.value;
    const sel = $("#assistant-model");
    const agent = state.agents.find((a) => a.id === state.assistantUi.modelId);
    if (sel && agent) sel.innerHTML = modelOptionsHtml(agent) || `<option disabled>No models match</option>`;
  });
  $("#assistant-model")?.addEventListener("change", (e) => {
    const id = state.assistantUi.modelId;
    const opt = e.target.selectedOptions[0];
    if (!id || !opt || opt.disabled) return;
    applyAssistantModel(id, opt.value, opt.dataset.provider);
  });
  document.querySelectorAll("[data-create-tpl]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tpl = CONSUMER_TEMPLATES[Number(btn.dataset.createTpl)];
      const provider = state.selectedProvider || "armara";
      const model = PROVIDER_DEFAULTS[provider] || "armara";
      const configured = state.providers.find((p) => p.auth_status === "configured");
      const useProvider = configured?.id || provider;
      const useModel = PROVIDER_DEFAULTS[useProvider] || model;
      const name = tpl.name.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now().toString(36).slice(-4);
      const toml =
        `name = "${tomlEscape(name)}"\n` +
        `description = "${tomlEscape(tpl.description)}"\n` +
        `profile = "${tpl.profile}"\n\n` +
        `[model]\nprovider = "${useProvider}"\n` +
        `model = "${useModel}"\n` +
        `system_prompt = """\n${tomlMultiline(tpl.system_prompt)}\n"""\n`;
      try {
        const res = await api("POST", "/api/agents", { manifest_toml: toml });
        const newId = res.agent_id || res.id;
        if (!state.chat.streaming && newId) {
          await savePrefs({ defaultAssistantId: newId });
        }
        await refreshAgents();
        toast(`Created ${res.name || name}`);
        render();
      } catch (e) {
        toast(e.message || "Create failed", true);
      }
    });
  });
}

/* ── Automations ─────────────────────────────────────────────── */

function cronOptionsHtml(selected) {
  const current = String(selected || "0 9 * * 1-5");
  const seen = new Set();
  const rows = [];
  function add(value, label) {
    if (!value || seen.has(value)) return;
    seen.add(value);
    const sel = value === current ? "selected" : "";
    rows.push(`<option value="${escapeHtml(value)}" ${sel}>${escapeHtml(label)}</option>`);
  }
  for (const p of CRON_PRESETS) add(p.value, p.label);
  if (!seen.has(current)) add(current, describeCron(current));
  return rows.join("");
}

function timezoneOptionsHtml(selected) {
  const current = String(selected || defaultTimeZone());
  return timeZoneOptions(current)
    .map((o) => {
      const sel = o.value === current ? "selected" : "";
      return `<option value="${escapeHtml(o.value)}" ${sel}>${escapeHtml(o.label)}</option>`;
    })
    .join("");
}

function createTimeZone() {
  return state.automationUi.createTz || state.prefs.cronTimeZone || defaultTimeZone();
}

function jobAgentName(agentId) {
  const agent = state.agents.find((a) => a.id === agentId);
  return (agent && agent.name) || "Unknown assistant";
}

function automationAgentOptions(selectedId) {
  const selected = selectedId || (defaultAgent() && defaultAgent().id) || "";
  const seen = new Set();
  const rows = [];
  function add(a) {
    if (!a || !a.id || seen.has(a.id)) return;
    seen.add(a.id);
    const sel = a.id === selected ? "selected" : "";
    rows.push(`<option value="${escapeHtml(a.id)}" ${sel}>${escapeHtml(a.name || a.id)}</option>`);
  }
  for (const a of state.agents.filter(isConsumerAgent)) add(a);
  if (selected) {
    const extra = state.agents.find((a) => a.id === selected);
    if (extra) add(extra);
  }
  return rows.join("");
}

function resetAutomationUi() {
  const prev = state.automationUi || {};
  state.automationUi = {
    editId: null,
    name: "",
    message: "",
    expr: "",
    tz: "",
    agentId: "",
    createName: prev.createName || "",
    createMessage: prev.createMessage || "",
    createExpr: prev.createExpr || "",
    createTz: prev.createTz || "",
    createAgentId: prev.createAgentId || "",
    resultId: prev.resultId || null,
  };
}

function renderAutomations() {
  const hideSystem = state.prefs.hideSystemJobs !== false;
  const shown = visibleJobs(state.jobs, state.agents, hideSystem);
  const hiddenCount = Math.max(0, state.jobs.length - shown.length);
  const items = shown
    .map((j) => {
      const sched =
        j.schedule?.kind === "cron"
          ? j.schedule.expr
          : j.schedule?.kind || JSON.stringify(j.schedule || {});
      const action =
        j.action?.kind === "agent_turn"
          ? j.action.message
          : j.action?.kind === "ainl_run"
            ? `Run ${j.action.program_path}`
            : j.action?.kind || "task";
      const editing = state.automationUi.editId === j.id;
      const highlight = state.highlightJobId === j.id;
      if (editing && isAgentTurnJob(j)) {
        return `<div class="list-item${highlight ? " is-highlight" : ""}" data-job-id="${escapeHtml(j.id)}">
          <div class="assistant-edit" style="flex:1">
            <label class="field-label" for="auto-edit-name">Name</label>
            <input id="auto-edit-name" maxlength="80" value="${escapeHtml(state.automationUi.name || j.name || "")}" aria-label="Automation name">
            <label class="field-label" for="auto-edit-agent">Assistant</label>
            <select id="auto-edit-agent" aria-label="Assistant">${automationAgentOptions(state.automationUi.agentId || j.agent_id)}</select>
            <label class="field-label" for="auto-edit-msg">What should happen?</label>
            <textarea id="auto-edit-msg" rows="3" maxlength="2000" aria-label="Automation task">${escapeHtml(state.automationUi.message || "")}</textarea>
            <label class="field-label" for="auto-edit-sched">When</label>
            <select id="auto-edit-sched" aria-label="Schedule">${cronOptionsHtml(state.automationUi.expr || sched)}</select>
            <label class="field-label" for="auto-edit-tz">Time zone</label>
            <select id="auto-edit-tz" aria-label="Time zone">${timezoneOptionsHtml(state.automationUi.tz || jobScheduleTimeZone(j))}</select>
            <div class="row" style="margin-top:8px">
              <button type="button" class="btn btn-primary btn-sm" data-save-job="${escapeHtml(j.id)}">Save</button>
              <button type="button" class="btn btn-ghost btn-sm" data-cancel-job="1">Cancel</button>
            </div>
          </div>
        </div>`;
      }
      const result = latestCronResult(state.jobRuns, j.id);
      const showResult = state.automationUi.resultId === j.id && result;
      return `<div class="list-item${highlight ? " is-highlight" : ""}" data-job-id="${escapeHtml(j.id)}">
        <div>
          <h4>${escapeHtml(j.name)} <span class="pill ${j.enabled ? "on" : "off"}">${j.enabled ? "on" : "off"}</span></h4>
          <p class="muted">${escapeHtml(String(action)).slice(0, 120)}</p>
          <p class="job-meta">${escapeHtml(describeCron(String(sched)))} · ${escapeHtml(timeZoneLabel(jobScheduleTimeZone(j)))} · ${escapeHtml(jobAgentName(j.agent_id))}</p>
          <p class="job-meta">${escapeHtml(jobTimingLine(j))}</p>
          ${
            showResult
              ? `<div class="job-result${result.failed ? " is-fail" : ""}">${escapeHtml(result.text).slice(0, 600)}</div>`
              : ""
          }
        </div>
        <div class="row">
          ${
            isAgentTurnJob(j)
              ? `<button type="button" class="btn btn-ghost btn-sm" data-edit-job="${escapeHtml(j.id)}">Edit</button>`
              : ""
          }
          ${
            result
              ? `<button type="button" class="btn btn-ghost btn-sm" data-result-job="${escapeHtml(j.id)}">${showResult ? "Hide result" : "Last result"}</button>`
              : ""
          }
          <button type="button" class="btn btn-ghost btn-sm" data-run-job="${escapeHtml(j.id)}">Run now</button>
          <button type="button" class="btn btn-ghost btn-sm" data-toggle-job="${escapeHtml(j.id)}" data-enabled="${j.enabled ? "1" : "0"}">${j.enabled ? "Pause" : "Enable"}</button>
          <button type="button" class="btn btn-danger btn-sm" data-del-job="${escapeHtml(j.id)}">Delete</button>
        </div>
      </div>`;
    })
    .join("");
  return `
    <div class="page-toolbar">
      <div>
        <h1>Automations</h1>
        <p class="lead">Recurring tasks that run on your behalf.</p>
      </div>
      <label class="filter-check">
        <input type="checkbox" id="hide-system-jobs" ${hideSystem ? "checked" : ""}>
        Hide system tasks${hiddenCount && hideSystem ? ` (${hiddenCount})` : ""}
      </label>
    </div>
    <div class="card" style="margin-bottom:20px">
      <h2>New recurring task</h2>
      <div class="field">
        <label for="auto-name">Name</label>
        <input id="auto-name" placeholder="Morning priorities" value="${escapeHtml(state.automationUi.createName || "")}" />
      </div>
      <div class="field">
        <label for="auto-agent">Assistant</label>
        <select id="auto-agent">${automationAgentOptions(state.automationUi.createAgentId || (defaultAgent() && defaultAgent().id))}</select>
      </div>
      <div class="field">
        <label for="auto-msg">What should happen?</label>
        <input id="auto-msg" placeholder="Remind me of my top three priorities" value="${escapeHtml(state.automationUi.createMessage || "")}" />
      </div>
      <div class="field">
        <label for="auto-sched">When</label>
        <select id="auto-sched">${cronOptionsHtml(state.automationUi.createExpr || "0 9 * * 1-5")}</select>
      </div>
      <div class="field">
        <label for="auto-tz">Time zone</label>
        <select id="auto-tz">${timezoneOptionsHtml(createTimeZone())}</select>
        <p class="muted">Clock times use this zone — weekday 9:00 means 9:00 here, not UTC.</p>
      </div>
      <button type="button" class="btn btn-primary" id="auto-create">Create automation</button>
    </div>
    <div class="list">${items || `<div class="empty">${hideSystem ? "No personal automations yet. System tasks are hidden." : "No automations yet."}</div>`}</div>
  `;
}

function bindAutomations() {
  $("#hide-system-jobs")?.addEventListener("change", async (e) => {
    const on = !!e.target.checked;
    try {
      await savePrefs({ hideSystemJobs: on });
    } catch {
      state.prefs.hideSystemJobs = on;
    }
    render();
  });
  $("#auto-create")?.addEventListener("click", async () => {
    const agentId =
      ($("#auto-agent")?.value || state.automationUi.createAgentId || "").trim() ||
      (defaultAgent() && defaultAgent().id);
    if (!agentId) {
      toast("Create an assistant first", true);
      return;
    }
    const name = ($("#auto-name")?.value || "").trim() || "Recurring task";
    const message = ($("#auto-msg")?.value || "").trim();
    const expr = $("#auto-sched")?.value || "0 9 * * 1-5";
    const tz = $("#auto-tz")?.value || createTimeZone();
    if (!message) {
      toast("Describe what should happen", true);
      return;
    }
    try {
      await api("POST", "/api/cron/jobs", {
        agent_id: agentId,
        name,
        schedule: cronSchedulePayload(expr, tz),
        action: { kind: "agent_turn", message, model_override: null, timeout_secs: null },
        enabled: true,
      });
      toast("Automation created");
      state.automationUi.createName = "";
      state.automationUi.createMessage = "";
      state.automationUi.createExpr = "";
      state.automationUi.createTz = tz;
      savePrefs({ cronTimeZone: tz }).catch(() => {});
      await refreshJobs();
      render();
    } catch (e) {
      toast(e.message || "Could not create automation", true);
    }
  });
  document.querySelectorAll("[data-edit-job]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.editJob;
      const job = state.jobs.find((j) => j.id === id);
      if (!job || !isAgentTurnJob(job)) return;
      state.automationUi = {
        editId: id,
        name: job.name || "",
        message: job.action?.message || "",
        expr: job.schedule?.expr || "0 9 * * 1-5",
        tz: jobScheduleTimeZone(job),
        agentId: job.agent_id || "",
        createName: state.automationUi.createName || "",
        createMessage: state.automationUi.createMessage || "",
        createExpr: state.automationUi.createExpr || "",
        createTz: state.automationUi.createTz || "",
        createAgentId: state.automationUi.createAgentId || "",
        resultId: null,
      };
      render();
      $("#auto-edit-name")?.focus();
    });
  });
  document.querySelectorAll("[data-save-job]").forEach((btn) => {
    btn.addEventListener("click", () => saveAutomationEdit(btn.dataset.saveJob));
  });
  document.querySelectorAll("[data-cancel-job]").forEach((btn) => {
    btn.addEventListener("click", () => {
      resetAutomationUi();
      render();
    });
  });
  $("#auto-edit-name")?.addEventListener("input", (e) => {
    state.automationUi.name = e.target.value;
  });
  $("#auto-edit-msg")?.addEventListener("input", (e) => {
    state.automationUi.message = e.target.value;
  });
  $("#auto-edit-sched")?.addEventListener("change", (e) => {
    state.automationUi.expr = e.target.value;
  });
  $("#auto-edit-tz")?.addEventListener("change", (e) => {
    state.automationUi.tz = e.target.value;
  });
  $("#auto-edit-agent")?.addEventListener("change", (e) => {
    state.automationUi.agentId = e.target.value;
  });
  $("#auto-name")?.addEventListener("input", (e) => {
    state.automationUi.createName = e.target.value;
  });
  $("#auto-msg")?.addEventListener("input", (e) => {
    state.automationUi.createMessage = e.target.value;
  });
  $("#auto-sched")?.addEventListener("change", (e) => {
    state.automationUi.createExpr = e.target.value;
  });
  $("#auto-tz")?.addEventListener("change", (e) => {
    state.automationUi.createTz = e.target.value;
  });
  $("#auto-agent")?.addEventListener("change", (e) => {
    state.automationUi.createAgentId = e.target.value;
  });
  document.querySelectorAll("[data-result-job]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.resultJob;
      state.automationUi.resultId = state.automationUi.resultId === id ? null : id;
      render();
    });
  });
  document.querySelectorAll("[data-run-job]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api("POST", `/api/cron/jobs/${encodeURIComponent(btn.dataset.runJob)}/run`, {});
        toast("Triggered");
        window.setTimeout(() => {
          refreshJobs()
            .then(() => {
              if (state.page === "automations") render();
            })
            .catch(() => {});
        }, 1200);
      } catch (e) {
        toast(e.message || "Run failed", true);
      }
    });
  });
  document.querySelectorAll("[data-toggle-job]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const enabled = btn.dataset.enabled === "1";
        await api("PUT", `/api/cron/jobs/${encodeURIComponent(btn.dataset.toggleJob)}/enable`, {
          enabled: !enabled,
        });
        await refreshJobs();
        render();
      } catch (e) {
        toast(e.message || "Toggle failed", true);
      }
    });
  });
  document.querySelectorAll("[data-del-job]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const job = state.jobs.find((j) => j.id === btn.dataset.delJob);
      if (job && !window.confirm(`Delete “${job.name}”? This recurring task will stop.`)) return;
      try {
        await api("DELETE", `/api/cron/jobs/${encodeURIComponent(btn.dataset.delJob)}`);
        if (state.automationUi.editId === btn.dataset.delJob) resetAutomationUi();
        await refreshJobs();
        render();
      } catch (e) {
        toast(e.message || "Delete failed", true);
      }
    });
  });
  const hid = state.highlightJobId;
  if (hid) {
    const el = document.querySelector(`[data-job-id="${hid}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

async function saveAutomationEdit(id) {
  const job = state.jobs.find((j) => j.id === id);
  if (!job || !isAgentTurnJob(job)) return;
  const name = String($("#auto-edit-name")?.value || state.automationUi.name || "").trim();
  const message = String($("#auto-edit-msg")?.value || state.automationUi.message || "").trim();
  const expr = $("#auto-edit-sched")?.value || state.automationUi.expr || job.schedule?.expr;
  const tz = $("#auto-edit-tz")?.value || state.automationUi.tz || jobScheduleTimeZone(job);
  const agentId = ($("#auto-edit-agent")?.value || state.automationUi.agentId || job.agent_id || "").trim();
  if (!name) {
    toast("Give this automation a name", true);
    return;
  }
  if (!message) {
    toast("Describe what should happen", true);
    return;
  }
  try {
    await api("PUT", `/api/cron/jobs/${encodeURIComponent(id)}`, {
      agent_id: agentId || job.agent_id,
      name,
      enabled: job.enabled,
      schedule: cronSchedulePayload(expr, tz),
      action: {
        kind: "agent_turn",
        message,
        model_override: job.action?.model_override ?? null,
        timeout_secs: job.action?.timeout_secs ?? null,
      },
    });
    resetAutomationUi();
    await refreshJobs();
    toast("Automation updated");
    render();
  } catch (e) {
    toast(e.message || "Could not update this automation", true);
  }
}

/* ── Activity ────────────────────────────────────────────────── */

async function refreshAudit() {
  try {
    const data = await api("GET", "/api/audit/recent?n=80");
    state.auditEntries = data.entries || [];
  } catch {
    /* feed is best-effort */
  }
}

let activitySse = null;
let activitySseTimer = 0;
let activitySseIgnoreUntil = 0;

function stopActivityLive() {
  if (activitySseTimer) {
    clearTimeout(activitySseTimer);
    activitySseTimer = 0;
  }
  if (activitySse) {
    activitySse.close();
    activitySse = null;
  }
  state.activityLive = false;
}

function scheduleActivityRefresh() {
  if (activitySseTimer) return;
  activitySseTimer = window.setTimeout(async () => {
    activitySseTimer = 0;
    if (state.page !== "activity") return;
    await Promise.all([refreshApprovals(), refreshAudit()]);
    if (state.page === "activity") render();
  }, 800);
}

function startActivityLive() {
  if (activitySse && activitySse.readyState !== EventSource.CLOSED) return;
  stopActivityLive();
  activitySseIgnoreUntil = Date.now() + 1500;
  try {
    activitySse = new EventSource("/api/events/stream");
    activitySse.onopen = () => {
      state.activityLive = true;
    };
    activitySse.onmessage = () => {
      if (state.page !== "activity") return;
      if (Date.now() < activitySseIgnoreUntil) return;
      scheduleActivityRefresh();
    };
  } catch {
    state.activityLive = false;
  }
}

function renderActivity() {
  const pending = pendingApprovalsForAgent(state.approvals, null);
  const hideSystem = state.prefs.hideSystemJobs !== false;
  const agentsById = new Map(state.agents.map((a) => [a.id, a]));
  const approvals = pending
    .map((a) => {
      const agent =
        agentsById.get(a.agent_id || a.agentId) ||
        { name: a.agent_name || "Assistant" };
      const title = approvalCardText(a);
      const question = String(a.question || "").trim();
      const showQ = question && question !== title;
      return `<div class="list-item">
        <div>
          <h4>${escapeHtml(title)}</h4>
          ${showQ ? `<p>${escapeHtml(question)}</p>` : ""}
          <p class="muted">${escapeHtml(agent.name || "Assistant")}${a.tool_name ? ` · ${escapeHtml(a.tool_name)}` : ""}</p>
          ${approvalActionButtons(a)}
        </div>
      </div>`;
    })
    .join("");

  const feed = consumerActivityEntries(mergeActivitySources(state.auditEntries, state.jobRuns), {
    jobs: state.jobs,
    agents: state.agents,
    hideSystem,
    limit: 24,
  })
    .map((item) => {
      const job = item.jobId ? state.jobs.find((j) => j.id === item.jobId) : null;
      const agent = agentsById.get(item.agentId);
      const title = job
        ? job.name
        : (agent && agent.name) || auditActionLabel(item.action) || "Activity";
      const kicker = job ? (item.failed ? "failed" : "ok") : auditActionLabel(item.action);
      const when = formatJobWhen(item.timestamp, Date.now(), "UTC") || "recently";
      const preview = activityPreview(item);
      const jump = activityJump(item, state.agents);
      const jumpBtn = jump
        ? jump.kind === "job"
          ? `<button type="button" class="btn btn-ghost btn-sm" data-open-job="${escapeHtml(jump.id)}">Open automation</button>`
          : `<button type="button" class="btn btn-ghost btn-sm" data-open-chat="${escapeHtml(jump.id)}">Open chat</button>`
        : "";
      const showKicker = kicker && kicker !== title;
      return `<div class="list-item">
        <div>
          <h4>${escapeHtml(title)}${showKicker ? ` <span class="pill ${item.failed ? "off" : "on"}">${escapeHtml(kicker)}</span>` : ""}</h4>
          <p class="job-meta">${escapeHtml(when)}${agent && job ? ` · ${escapeHtml(agent.name)}` : ""}</p>
          ${preview ? `<p class="muted">${escapeHtml(preview)}</p>` : ""}
        </div>
        ${jumpBtn ? `<div class="row">${jumpBtn}</div>` : ""}
      </div>`;
    })
    .join("");

  const live = state.activityLive
    ? `<span class="live-dot" title="Updating as events arrive">Live</span>`
    : "";
  return `
    <div class="page-toolbar">
      <div>
        <h1>Activity</h1>
        <p class="lead">Approve anything important, then follow recent work as it happens. ${live}</p>
      </div>
    </div>
    <h2>Approvals</h2>
    <div class="list" style="margin-bottom:28px">${approvals || '<div class="empty">Nothing waiting for approval.</div>'}</div>
    <h2>Recent activity</h2>
    <div class="list">${feed || '<div class="empty">No recent activity yet.</div>'}</div>
  `;
}

function bindActivity() {
  startActivityLive();
  bindApprovalButtons();
  document.querySelectorAll("[data-open-job]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.openJob;
      const job = state.jobs.find((j) => j.id === id);
      const agent = job && state.agents.find((a) => a.id === job.agent_id);
      if (job && isSystemJob(job, agent) && state.prefs.hideSystemJobs !== false) {
        try {
          await savePrefs({ hideSystemJobs: false });
        } catch {
          state.prefs.hideSystemJobs = false;
        }
      }
      state.automationUi.resultId = id;
      state.highlightJobId = id;
      setPage("automations");
    });
  });
  document.querySelectorAll("[data-open-chat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.pendingHomeAgentId = btn.dataset.openChat;
      setPage("home");
    });
  });
}

/* ── Settings ────────────────────────────────────────────────── */

function renderSettings() {
  const selected = state.providers.find((p) => p.id === state.selectedProvider);
  const connected = selected && selected.auth_status === "configured";
  const draftLen = (state.settingsKeyDraft || "").length;
  const hideSystem = state.prefs.hideSystemJobs !== false;
  const providerOpts = state.providers
    .filter((p) => SETUP_PROVIDERS.includes(p.id) || p.auth_status === "configured")
    .map((p) => {
      const sel = p.id === state.selectedProvider ? "selected" : "";
      return `<option value="${escapeHtml(p.id)}" ${sel}>${escapeHtml(p.display_name || p.id)} (${escapeHtml(p.auth_status || "?")})</option>`;
    })
    .join("");
  const agentOpts = state.agents
    .filter(isConsumerAgent)
    .map((a) => {
      const sel = a.id === state.prefs.defaultAssistantId ? "selected" : "";
      return `<option value="${escapeHtml(a.id)}" ${sel}>${escapeHtml(a.name)}</option>`;
    })
    .join("");
  const keyHint = draftLen
    ? keyLengthHint(draftLen)
    : connected
      ? "This provider is connected. Paste a new key only if you want to replace it."
      : "Paste your Armara / InferX API key — dots should appear, then click Save & test.";
  return `
    <h1>Settings</h1>
    <p class="lead">Provider, default assistant, workspace, and privacy.</p>
    <div class="card">
      <h2>Provider ${connected ? '<span class="pill on">connected</span>' : '<span class="pill off">needs key</span>'}</h2>
      ${state.providerSaveNotice ? `<div class="status-banner">${escapeHtml(state.providerSaveNotice)}</div>` : ""}
      <div class="field">
        <label for="settings-provider">LLM provider</label>
        <select id="settings-provider">${providerOpts}</select>
      </div>
      <div class="field">
        <label for="settings-key">API key</label>
        <input id="settings-key" type="password" autocomplete="off" spellcheck="false" placeholder="Paste to update" value="${escapeHtml(state.settingsKeyDraft)}" />
        <p class="key-hint ${draftLen ? "" : connected ? "ok" : ""}" id="settings-key-hint">${escapeHtml(keyHint)}</p>
        ${state.selectedProvider === "armara" ? armaraKeyHelpHtml() : ""}
      </div>
      <button type="button" class="btn btn-primary" id="settings-save-provider">Save & test</button>
    </div>
    <div class="card">
      <h2>Default assistant</h2>
      <div class="field">
        <label for="settings-agent">Assistant</label>
        <select id="settings-agent">${agentOpts || "<option value=''>None</option>"}</select>
      </div>
      <button type="button" class="btn btn-ghost" id="settings-save-agent">Save</button>
    </div>
    <div class="card">
      <h2>Privacy</h2>
      <p class="muted">ArmaraOS Lite talks only to your local ArmaraOS daemon. Keys and chats stay under <span class="mono">~/.armaraos</span>. Lite prefs live in <span class="mono">~/.armaraos-lite</span>. We do not train on your prompts.</p>
      <button type="button" class="btn btn-ghost" id="settings-reset-setup">Run setup again</button>
    </div>
    <div class="card">
      <h2>Workspace</h2>
      <p class="muted">${
        state.health
          ? `Daemon connected · v${escapeHtml(state.health.version || "?")}`
          : "Daemon status unknown — check the sidebar."
      }</p>
      <label class="filter-check" style="margin:12px 0">
        <input type="checkbox" id="settings-hide-system" ${hideSystem ? "checked" : ""}>
        Hide system tasks on Automations and Activity
      </label>
      <p style="margin-top:12px"><a class="full-dash-link" href="${escapeHtml(state.daemonBaseUrl || "#")}/" target="_blank" rel="noopener">Open full ArmaraOS dashboard</a></p>
    </div>
  `;
}

function bindSettings() {
  $("#settings-provider")?.addEventListener("change", (e) => {
    state.selectedProvider = e.target.value;
    state.providerSaveNotice = "";
    render();
  });
  const keyEl = $("#settings-key");
  if (keyEl) {
    const hint = $("#settings-key-hint");
    const syncHint = () => {
      state.settingsKeyDraft = keyEl.value;
      if (!hint) return;
      const n = keyEl.value.length;
      hint.className = n ? "key-hint" : "key-hint ok";
      hint.textContent = n
        ? keyLengthHint(n)
        : "This provider is connected. Paste a new key only if you want to replace it.";
    };
    keyEl.addEventListener("input", syncHint);
    keyEl.addEventListener("paste", () => setTimeout(syncHint, 0));
  }
  $("#settings-save-provider")?.addEventListener("click", async () => {
    const id = $("#settings-provider")?.value;
    const key = ($("#settings-key")?.value || state.settingsKeyDraft || "").trim();
    if (!id) return;
    const btn = $("#settings-save-provider");
    if (btn) btn.disabled = true;
    try {
      if (key) {
        await api("POST", `/api/providers/${encodeURIComponent(id)}/key`, { key });
      }
      await api("POST", `/api/providers/${encodeURIComponent(id)}/test`, {});
      await applyProviderToDefaultAssistant(id);
      state.selectedProvider = id;
      state.settingsKeyDraft = "";
      state.providerSaveNotice = key
        ? `API key saved and verified for ${id}. You can chat from Home.`
        : `Provider ${id} is connected.`;
      await refreshProviders();
      toast("Provider saved");
      render();
    } catch (e) {
      toast(e.message || "Save failed", true);
      if (btn) btn.disabled = false;
    }
  });
  $("#settings-save-agent")?.addEventListener("click", async () => {
    const id = $("#settings-agent")?.value || null;
    await savePrefs({ defaultAssistantId: id });
    if (id) showAgentChat(id);
    toast("Default assistant saved");
    if (id) {
      await Promise.all([loadChatHistory(id), loadDaemonFeatures(id)]);
    }
    render();
  });
  $("#settings-reset-setup")?.addEventListener("click", async () => {
    await savePrefs({ setupComplete: false });
    state.setupStep = 1;
    render();
  });
  $("#settings-hide-system")?.addEventListener("change", async (e) => {
    const on = !!e.target.checked;
    try {
      await savePrefs({ hideSystemJobs: on });
    } catch {
      state.prefs.hideSystemJobs = on;
    }
  });
}

/* ── Advanced ────────────────────────────────────────────────── */

function renderAdvanced() {
  if (!state.prefs.advancedOpen && state.page !== "advanced") {
    return `<h1>Advanced</h1><p class="lead">Technical tools are hidden by default.</p>
      <button type="button" class="btn btn-primary" id="adv-open">Show advanced tools</button>`;
  }
  const cards = ADVANCED_LINKS.map(
    (l) => `<button type="button" class="adv-card" data-adv="${escapeHtml(l.id)}">
      <h4>${escapeHtml(l.title)}</h4>
      <p>${escapeHtml(l.desc)}</p>
    </button>`,
  ).join("");
  const detail = state.advancedDetail
    ? `<div class="card" style="margin-top:20px">
        <h2>${escapeHtml(state.advancedDetail.title)}</h2>
        <pre class="mono" style="white-space:pre-wrap;max-height:420px;overflow:auto;margin:0">${escapeHtml(state.advancedDetail.body)}</pre>
      </div>`
    : `<p class="muted" style="margin-top:16px">Pick a tool for a compact view, or open the full dashboard for the operator UI.</p>`;
  return `
    <h1>Advanced</h1>
    <p class="lead">Operator tools from the ArmaraOS daemon. Primary navigation stays simple — these stay here.</p>
    <div class="advanced-grid">${cards}</div>
    ${detail}
    <p style="margin-top:20px"><a class="full-dash-link" href="${escapeHtml(state.daemonBaseUrl)}/" target="_blank" rel="noopener">Open full ArmaraOS dashboard →</a></p>
  `;
}

function bindAdvanced() {
  $("#adv-open")?.addEventListener("click", async () => {
    await savePrefs({ advancedOpen: true });
    render();
  });
  document.querySelectorAll("[data-adv]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const link = ADVANCED_LINKS.find((l) => l.id === btn.dataset.adv);
      if (!link) return;
      try {
        let path = link.path;
        if (link.needsAgent) {
          const agent = defaultAgent();
          if (!agent) throw new Error("Create an assistant first — this tool needs an agent_id.");
          const sep = path.includes("?") ? "&" : "?";
          path = `${path}${sep}agent_id=${encodeURIComponent(agent.id)}`;
        }
        const data = await api("GET", path);
        state.advancedDetail = {
          title: link.title,
          body: formatAdvancedBody(link, data),
        };
        render();
      } catch (e) {
        state.advancedDetail = {
          title: link.title,
          body: `Unavailable: ${e.message}\n\nUse the full ArmaraOS dashboard for this surface if the API path differs.`,
        };
        render();
      }
    });
  });
}

/* ── Boot ────────────────────────────────────────────────────── */

async function boot() {
  document.querySelectorAll(".nav-item[data-page]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const page = btn.dataset.page;
      if (page === "advanced") {
        if (!state.prefs.advancedOpen) {
          await savePrefs({ advancedOpen: true });
        }
        setPage("advanced");
        return;
      }
      setPage(page);
    });
  });
  $("#status-toggle")?.addEventListener("click", async () => {
    const open = state.prefs.statusOpen !== false;
    await savePrefs({ statusOpen: !open });
    syncChromeToggles();
  });

  try {
    await refreshMeta();
    const ok = await refreshHealth();
    if (!ok) {
      $("#main").innerHTML = `
        <h1>Daemon not running</h1>
        <p class="lead">ArmaraOS Lite needs the full ArmaraOS daemon. It does not replace <span class="mono">armaraos</span>.</p>
        <div class="card">
          <p>In a terminal:</p>
          <pre class="mono">armaraos start</pre>
          <p class="muted" style="margin-top:12px">Then refresh this page or run <span class="mono">armaraos-lite</span> again.</p>
        </div>`;
      return;
    }
    await Promise.all([refreshAgents(), refreshProviders(), refreshApprovals(), refreshJobs()]);
    // If user already has agents + configured provider, skip setup
    if (!state.prefs.setupComplete) {
      const hasAgent = state.agents.some(isConsumerAgent);
      const hasProvider = state.providers.some((p) => p.auth_status === "configured");
      if (hasAgent && hasProvider) {
        const agent = state.agents.find(isConsumerAgent);
        await savePrefs({
          setupComplete: true,
          defaultAssistantId: state.prefs.defaultAssistantId || agent?.id || null,
        });
      }
    }
    if (state.prefs.defaultAssistantId == null) {
      const agent =
        state.agents.find(isPreferredAssistant) ||
        state.agents.find((a) => isConsumerAgent(a) && a.model_provider === "armara") ||
        state.agents.find(isConsumerAgent);
      if (agent) await savePrefs({ defaultAssistantId: agent.id });
    } else {
      const current = state.agents.find((a) => a.id === state.prefs.defaultAssistantId);
      if (!current || !isConsumerAgent(current)) {
        const agent =
          state.agents.find(isPreferredAssistant) ||
          state.agents.find((a) => isConsumerAgent(a) && a.model_provider === "armara") ||
          state.agents.find(isConsumerAgent);
        if (agent) await savePrefs({ defaultAssistantId: agent.id });
      }
    }
    const configured = state.providers.find((p) => SETUP_PROVIDERS.includes(p.id) && p.auth_status === "configured");
    if (configured) state.selectedProvider = configured.id;
    state.page = state.prefs.setupComplete ? state.prefs.lastPage || "home" : "home";
    if (!["home", "assistants", "automations", "activity", "settings", "advanced"].includes(state.page)) {
      state.page = "home";
    }
    const agent = defaultAgent();
    if (agent) showAgentChat(agent.id);
    render();
    if (state.page === "activity") {
      refreshAudit()
        .then(() => {
          if (state.page === "activity") render();
        })
        .catch(() => {});
    }
    if (agent && state.prefs.setupComplete) {
      await Promise.all([loadChatHistory(agent.id, { force: true }), loadDaemonFeatures(agent.id)]);
      if (state.page === "home") {
        render();
        scrollChatToLatest({ smooth: false });
      }
    }
    setInterval(() => {
      refreshHealth().catch(() => {});
      refreshApprovals().then(() => {
        if (state.page !== "activity") return;
        refreshAudit()
          .then(() => {
            if (state.page === "activity") render();
          })
          .catch(() => {});
      });
    }, 8000);
  } catch (e) {
    $("#main").innerHTML = `<h1>Could not start</h1><p class="lead">${escapeHtml(e.message)}</p>`;
  }
}

window.addEventListener("beforeunload", () => {
  snapshotCurrentChat();
});
boot();
