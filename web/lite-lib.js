/**
 * Pure helpers for ArmaraOS Lite chat attachments and session labels.
 * Keep this file importable from both the browser (`app.js`) and Node tests.
 */

/** Must match `MAX_UPLOAD_SIZE` in the daemon upload route. */
export const MAX_UPLOAD_BYTES = 128 * 1024 * 1024;
export const MAX_PENDING_FILES = 8;

const BLOCKED_EXT = [
  ".exe",
  ".dll",
  ".bat",
  ".cmd",
  ".msi",
  ".scr",
  ".com",
  ".app",
  ".deb",
  ".rpm",
  ".dmg",
  ".pkg",
  ".iso",
];

const EXT_OK = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".tif",
  ".tiff",
  ".heic",
  ".heif",
  ".avif",
  ".svg",
  ".pdf",
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".jsonl",
  ".csv",
  ".tsv",
  ".tab",
  ".xml",
  ".xsl",
  ".html",
  ".htm",
  ".xhtml",
  ".css",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".vue",
  ".svelte",
  ".php",
  ".phtml",
  ".py",
  ".pyw",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".cs",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".rb",
  ".sql",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".ainl",
  ".lang",
  ".graphql",
  ".gql",
  ".xlsx",
  ".xls",
  ".xlsm",
  ".ods",
  ".docx",
  ".doc",
  ".odt",
  ".rtf",
  ".pptx",
  ".ppt",
  ".odp",
  ".zip",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".wav",
  ".ogg",
  ".oga",
  ".opus",
  ".flac",
  ".m4a",
  ".aac",
  ".mp4",
  ".webm",
  ".mov",
  ".mkv",
  ".m4v",
];

const IMAGE_EXT = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".tif",
  ".tiff",
  ".heic",
  ".heif",
  ".avif",
  ".svg",
];

const APP_EXACT = [
  "application/pdf",
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/rtf",
  "application/sql",
  "application/csv",
  "application/graphql",
  "application/xhtml+xml",
  "application/msword",
  "application/ld+json",
  "application/x-httpd-php",
  "application/x-yaml",
  "application/x-sh",
  "application/x-shellscript",
  "application/toml",
  "application/zip",
  "application/x-zip-compressed",
];

export function fileExt(name) {
  const s = String(name || "");
  const i = s.lastIndexOf(".");
  return i === -1 ? "" : s.slice(i).toLowerCase();
}

export function attachmentAllowed(file) {
  const name = file && file.name;
  const type = String((file && file.type) || "").toLowerCase();
  const ext = fileExt(name);
  if (ext && BLOCKED_EXT.includes(ext)) return false;
  if (
    type.startsWith("image/") ||
    type.startsWith("audio/") ||
    type.startsWith("video/") ||
    type.startsWith("text/") ||
    type.startsWith("font/")
  ) {
    return true;
  }
  if (
    type.startsWith("application/vnd.openxmlformats") ||
    type.startsWith("application/vnd.oasis") ||
    type.startsWith("application/vnd.ms-")
  ) {
    return true;
  }
  if (APP_EXACT.includes(type)) return true;
  if (ext && EXT_OK.includes(ext)) return true;
  return false;
}

export function isImageAttachment(file) {
  const type = String((file && file.type) || "").toLowerCase();
  if (type.startsWith("image/")) return true;
  return IMAGE_EXT.includes(fileExt(file && file.name));
}

/**
 * Daemon `SessionLabel` allows 1–128 chars of alphanumeric, space, hyphen, underscore.
 */
export function sanitizeSessionLabel(raw, max = 128) {
  const cap = Math.max(1, Math.min(128, Number(max) || 128));
  return String(raw || "")
    .replace(/\./g, " ")
    .replace(/[^a-zA-Z0-9 _-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, cap);
}

export function formatSessionWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatSessionClock(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Human name for the session picker — never a raw UUID. Pass siblings to split same-day unlabeled chats. */
export function sessionDisplayName(s, siblings) {
  const label = String((s && s.label) || "").trim();
  if (label) return label;
  const created = s && (s.created_at || s.createdAt);
  const when = formatSessionWhen(created);
  if (!when) return "New chat";
  const base = `Chat · ${when}`;
  const peers = Array.isArray(siblings) ? siblings : [];
  const sameDay = peers.filter((x) => {
    if (String((x && x.label) || "").trim()) return false;
    return formatSessionWhen(x && (x.created_at || x.createdAt)) === when;
  });
  if (sameDay.length <= 1) return base;
  const clock = formatSessionClock(created);
  return clock ? `Chat · ${when}, ${clock}` : base;
}

export function composeUserMessage(text, filenames) {
  let out = String(text || "").trim();
  for (const name of filenames || []) {
    const tag = `[File: ${name}]`;
    if (!out.includes(tag)) out = out ? `${out}\n${tag}` : tag;
  }
  return out;
}

export function stripFileTags(text) {
  return String(text || "")
    .replace(/(?:^|\n)\[File: [^\]]+\]/g, "")
    .trim();
}

export function looksLikeUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(s || "").trim(),
  );
}

export function filterModels(models, query, limit = 50) {
  const q = String(query || "").trim().toLowerCase();
  let list = Array.isArray(models) ? models : [];
  if (q) {
    list = list.filter((m) => {
      const id = String((m && m.id) || "").toLowerCase();
      const name = String((m && m.display_name) || "").toLowerCase();
      const label = String((m && m.label) || "").toLowerCase();
      const prov = String((m && m.provider) || "").toLowerCase();
      return id.includes(q) || name.includes(q) || label.includes(q) || prov.includes(q);
    });
  }
  const cap = Math.max(1, Number(limit) || 50);
  return list.slice(0, cap);
}

export function approvalCardText(a) {
  if (!a) return "Needs approval";
  return (
    a.action_summary ||
    a.summary ||
    a.description ||
    a.tool_name ||
    a.tool ||
    a.action ||
    "Needs approval"
  );
}

export function pendingApprovalsForAgent(approvals, agentId) {
  return (approvals || []).filter((a) => {
    const status = String((a && a.status) || "pending").toLowerCase();
    if (status !== "pending") return false;
    if (!agentId) return true;
    const owner = a.agent_id || a.agentId;
    if (!owner) return true;
    return String(owner) === String(agentId);
  });
}

/** Mutates `thread`. Returns true when a pending card was inserted or a resolved one removed. */
export function mergePendingApprovals(thread, approvals, agentId) {
  if (!thread) return false;
  let changed = false;
  const pending = pendingApprovalsForAgent(approvals, agentId);
  const pendingIds = new Set(
    pending.map((a) => a.id || a.approval_id).filter(Boolean).map((id) => String(id)),
  );
  for (let i = thread.length - 1; i >= 0; i -= 1) {
    const msg = thread[i];
    if (!msg || msg.kind !== "approval") continue;
    if (pendingIds.has(String(msg.id))) continue;
    thread.splice(i, 1);
    changed = true;
  }
  for (const a of pending) {
    const id = a.id || a.approval_id;
    if (!id) continue;
    if (thread.some((m) => m.kind === "approval" && String(m.id) === String(id))) continue;
    thread.push({
      kind: "approval",
      id,
      text: approvalCardText(a),
      approvalKind: approvalKind(a),
      question_options: questionOptions(a),
      tool_name: a.tool_name || a.tool || "",
    });
    changed = true;
  }
  return changed;
}

export function sessionDeleteConfirmMessage(name) {
  return `Delete “${name}”? Messages in this chat will be gone.`;
}

/** True when a Delete click must not start another session delete. */
export function shouldIgnoreSessionDeleteClick({ sid, streaming, deletingId }) {
  if (!sid) return true;
  if (streaming) return true;
  if (deletingId) return true;
  return false;
}

export const STREAM_IDLE_MS = 90_000;

function abortError() {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

/**
 * One `ReadableStream` pull that cannot hang past abort or idle.
 * Idle resolves `{ done: true, idle: true }` so the UI can finish the turn.
 */
export function readStreamChunk(reader, signal, idleMs = STREAM_IDLE_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = 0;
    const finish = (kind, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (kind === "reject") reject(value);
      else resolve(value);
    };
    const onAbort = () => {
      try {
        reader.cancel();
      } catch {
        /* already closed */
      }
      finish("reject", abortError());
    };
    if (signal && signal.aborted) {
      onAbort();
      return;
    }
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      try {
        reader.cancel();
      } catch {
        /* already closed */
      }
      finish("resolve", { done: true, value: undefined, idle: true });
    }, Math.max(250, Number(idleMs) || STREAM_IDLE_MS));
    Promise.resolve()
      .then(() => reader.read())
      .then(
        (result) => finish("resolve", result),
        (err) => {
          if (signal && signal.aborted) finish("reject", abortError());
          else if (err && err.name === "AbortError") finish("reject", abortError());
          else finish("reject", err);
        },
      );
  });
}

export function dropPathBlocked(relPath) {
  const parts = String(relPath || "")
    .split(/[\\/]/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    const n = part.toLowerCase();
    if (n === ".git" || n === "node_modules" || n === ".ds_store" || n === "thumbs.db") return true;
  }
  return false;
}

export function displayAttachmentName(file) {
  const lite = String((file && file.litePath) || "").replace(/\\/g, "/").trim();
  if (lite) return lite;
  const rel = String((file && file.webkitRelativePath) || "").replace(/\\/g, "/").trim();
  if (rel) return rel;
  return String((file && file.name) || "file");
}

export const CRON_PRESETS = [
  { value: "0 9 * * 1-5", label: "Weekday mornings (9:00)" },
  { value: "0 8 * * *", label: "Every morning (8:00)" },
  { value: "0 18 * * 1-5", label: "Weekday evenings (18:00)" },
  { value: "0 * * * *", label: "Every hour" },
  { value: "*/5 * * * *", label: "Every 5 minutes" },
  { value: "0 10 * * 1", label: "Monday mornings (10:00)" },
  { value: "0 */6 * * *", label: "Every 6 hours" },
];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function clockLabel(hour, minute = 0) {
  const h = Number(hour);
  const m = Number(minute) || 0;
  if (!Number.isFinite(h) || h < 0 || h > 23) return "";
  const suffix = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  return m ? `${hr}:${String(m).padStart(2, "0")} ${suffix}` : `${hr}:00 ${suffix}`;
}

export function describeCron(expr) {
  const raw = String(expr || "").trim();
  if (!raw) return "On a schedule";
  const preset = CRON_PRESETS.find((p) => p.value === raw);
  if (preset) return preset.label;
  const parts = raw.split(/\s+/);
  if (parts.length < 5) return raw;
  const [min, hour, dom, mon, dow] = parts;
  if (min.startsWith("*/") && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    const n = Number(min.slice(2));
    if (n === 1) return "Every minute";
    if (Number.isFinite(n) && n > 1) return `Every ${n} minutes`;
  }
  if (min === "0" && hour === "*" && dom === "*" && mon === "*" && dow === "*") return "Every hour";
  if (min === "0" && hour.startsWith("*/") && dom === "*" && mon === "*" && dow === "*") {
    const n = Number(hour.slice(2));
    if (n === 1) return "Every hour";
    if (Number.isFinite(n) && n > 1) return `Every ${n} hours`;
  }
  const time = /^\d+$/.test(min) && /^\d+$/.test(hour) ? clockLabel(hour, min) : "";
  if (time && dom === "*" && mon === "*" && dow === "*") return `Every day at ${time}`;
  if (time && dom === "*" && mon === "*" && dow === "1-5") return `Weekdays at ${time}`;
  if (time && dom === "*" && mon === "*" && /^[0-6]$/.test(dow)) {
    return `${WEEKDAYS[Number(dow)]}s at ${time}`;
  }
  return raw;
}

/** Daemon cron with no tz is UTC. Use that zone for clocks so 9:00 cron matches next run. */
export function jobScheduleTimeZone(job) {
  return normalizeTimeZone(job && job.schedule && job.schedule.tz);
}

export function normalizeTimeZone(tz) {
  const raw = String(tz || "UTC").trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw }).format(new Date());
    return raw;
  } catch {
    return "UTC";
  }
}

export function defaultTimeZone() {
  try {
    return normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return "UTC";
  }
}

/** Short consumer list; device zone and the current job zone are always included. */
export const TIMEZONE_OPTIONS = [
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Phoenix", label: "Arizona" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Paris", label: "Paris" },
  { value: "Europe/Berlin", label: "Berlin" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Australia/Sydney", label: "Sydney" },
];

export function timeZoneLabel(tz) {
  const n = normalizeTimeZone(tz);
  const hit = TIMEZONE_OPTIONS.find((o) => o.value === n);
  if (hit) return hit.label;
  return n.replace(/_/g, " ");
}

export function timeZoneOptions(current) {
  const seen = new Set();
  const list = [];
  function add(value, label) {
    const n = normalizeTimeZone(value);
    if (seen.has(n)) return;
    seen.add(n);
    list.push({ value: n, label: label || timeZoneLabel(n) });
  }
  for (const o of TIMEZONE_OPTIONS) add(o.value, o.label);
  const local = defaultTimeZone();
  if (local !== "UTC") add(local, `${timeZoneLabel(local)} (this device)`);
  add(current);
  return list;
}

/** `tz: null` is the daemon default (UTC). Named zones are IANA. */
export function cronSchedulePayload(expr, tz) {
  const zone = normalizeTimeZone(tz);
  return { kind: "cron", expr: String(expr || "").trim(), tz: zone === "UTC" ? null : zone };
}

function calendarDay(ms, timeZone) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ms));
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ms));
  }
}

function addCivilDays(ymd, days) {
  const [y, m, d] = String(ymd)
    .split("-")
    .map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function formatClock(ms, timeZone) {
  try {
    return new Date(ms).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    });
  } catch {
    return new Date(ms).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    });
  }
}

export function formatJobWhen(iso, now = Date.now(), timeZone = "UTC") {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const delta = now - t;
  if (delta < 0) return formatUpcoming(iso, now, timeZone);
  const mins = Math.round(delta / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const today = calendarDay(now, timeZone);
  const that = calendarDay(t, timeZone);
  if (that === addCivilDays(today, -1)) return "yesterday";
  try {
    return new Date(t).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      timeZone,
    });
  } catch {
    return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  }
}

export function formatUpcoming(iso, now = Date.now(), timeZone = "UTC") {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (d.getTime() <= now) return "due now";
  const mins = Math.max(1, Math.round((d.getTime() - now) / 60000));
  if (mins < 60) return `in ${mins} min`;
  const clock = formatClock(d.getTime(), timeZone);
  const today = calendarDay(now, timeZone);
  const that = calendarDay(d.getTime(), timeZone);
  if (that === today) return `today ${clock}`;
  if (that === addCivilDays(today, 1)) return `tomorrow ${clock}`;
  try {
    const day = d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone,
    });
    return `${day} ${clock}`;
  } catch {
    return `${clock}`;
  }
}

export function jobTimingLine(job, now = Date.now()) {
  if (!job) return "";
  const tz = jobScheduleTimeZone(job);
  const last = formatJobWhen(job.last_run, now, tz);
  const next = job.enabled ? formatUpcoming(job.next_run, now, tz) : "";
  if (last && next) return `Last run ${last} · Next ${next}`;
  if (last && !job.enabled) return `Last run ${last} · Paused`;
  if (last) return `Last run ${last}`;
  if (next) return `Next ${next}`;
  if (!job.enabled) return "Paused · never run";
  return "Not run yet";
}

export function cronRunJobId(run) {
  const detail = String((run && run.detail) || "");
  const m = detail.match(/\bid=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
  return m ? m[1] : "";
}

export function cronResultText(outcome) {
  if (outcome == null || outcome === "") return "";
  if (typeof outcome === "string") return outcome.trim();
  if (typeof outcome === "object") {
    if (outcome.message) return String(outcome.message).trim();
    if (outcome.error) return String(outcome.error).trim();
    if (outcome.ok === true && outcome.label) return String(outcome.label);
    try {
      return JSON.stringify(outcome);
    } catch {
      return "";
    }
  }
  return String(outcome).trim();
}

/** Newest CronJobOutput or CronJobFailure for this job. `runs` is newest-first. */
export function latestCronResult(runs, jobId) {
  const id = String(jobId || "");
  if (!id) return null;
  const mine = (runs || []).filter((r) => cronRunJobId(r) === id);
  const hit = mine.find((r) => {
    const action = String((r && r.action) || "");
    return /output/i.test(action) || /fail/i.test(action);
  });
  if (!hit) return null;
  const text = cronResultText(hit.outcome);
  if (!text) return null;
  return {
    at: hit.timestamp,
    failed: /fail/i.test(String(hit.action || "")),
    text,
  };
}

export function isAgentTurnJob(job) {
  return String((job && job.action && job.action.kind) || "") === "agent_turn";
}

export function isOperatorAgent(agent) {
  if (!agent) return false;
  if (agent.premium_hand) return true;
  const name = String(agent.name || "").toLowerCase();
  return name.endsWith("-hand") || name.endsWith(" hand") || name.includes("probe");
}

/** AINL / workspace_action / workflows / operator hands — not everyday recurring tasks. */
export function isSystemJob(job, agent) {
  if (!job) return true;
  if (!isAgentTurnJob(job)) return true;
  if (isOperatorAgent(agent)) return true;
  const name = String(job.name || "").toLowerCase();
  return name.startsWith("test-ainl") || name.startsWith("armaraos-");
}

export function visibleJobs(jobs, agents, hideSystem) {
  const list = jobs || [];
  if (!hideSystem) return list;
  const byId = new Map((agents || []).map((a) => [a.id, a]));
  return list.filter((j) => !isSystemJob(j, byId.get(j.agent_id)));
}

export function cronRunJobName(run) {
  const detail = String((run && run.detail) || "");
  const m = detail.match(/\bjob=([^,]+)/i);
  return m ? m[1].trim() : "Automation";
}

export function approvalKind(a) {
  return String((a && a.kind) || "tool_gate").toLowerCase();
}

export function isAllowOnceApproval(a) {
  return approvalKind(a) === "one_time_tool_grant";
}

export function isQuestionApproval(a) {
  return approvalKind(a) === "question";
}

export function questionOptions(a) {
  const opts = (a && a.question_options) || [];
  return Array.isArray(opts) ? opts.map((o) => String(o)).filter(Boolean) : [];
}

/** Body for POST /api/approvals/:id/approve. Empty object is valid for a plain gate. */
export function approvePayload(extra = {}) {
  const body = {};
  const scope = String(extra.scope || "").toLowerCase();
  if (scope === "once" || scope === "session") body.scope = scope;
  const answer = String(extra.answer || "").trim();
  if (answer) body.answer = answer;
  return body;
}

export function approvalActions(a) {
  if (isQuestionApproval(a)) {
    if (questionOptions(a).length) return { mode: "choices", options: questionOptions(a) };
    return { mode: "question_text" };
  }
  if (isAllowOnceApproval(a)) return { mode: "allow_once" };
  return { mode: "approve" };
}

const CONSUMER_AUDIT_ACTIONS = new Set([
  "CronJobOutput",
  "CronJobFailure",
  "AgentMessage",
  "ToolInvoke",
  "ShellExec",
  "FileAccess",
]);

export function isConsumerAuditAction(action) {
  return CONSUMER_AUDIT_ACTIONS.has(String(action || ""));
}

export function auditActionLabel(action) {
  switch (String(action || "")) {
    case "CronJobOutput":
      return "Automation finished";
    case "CronJobFailure":
      return "Automation failed";
    case "AgentMessage":
      return "Message";
    case "ToolInvoke":
      return "Tool";
    case "ShellExec":
      return "Shell";
    case "FileAccess":
      return "File";
    default:
      return "";
  }
}

/**
 * Newest-first consumer activity rows. Skips operator hands, Merkle hashes,
 * and (when hideSystem) AINL / workspace_action / probe jobs.
 */
export function consumerActivityEntries(entries, { jobs = [], agents = [], hideSystem = true, limit = 24 } = {}) {
  const byJob = new Map((jobs || []).map((j) => [j.id, j]));
  const byAgent = new Map((agents || []).map((a) => [a.id, a]));
  const newest = [...(entries || [])].sort((a, b) => Number(b.seq || 0) - Number(a.seq || 0));
  const seenJob = new Set();
  const out = [];
  for (const e of newest) {
    if (!e || !isConsumerAuditAction(e.action)) continue;
    const agentId = e.agent_id || e.agentId || "";
    const agent = byAgent.get(agentId);
    if (isOperatorAgent(agent)) continue;
    const jobId = cronRunJobId(e);
    const cron = /^CronJob(Output|Failure)$/.test(String(e.action || ""));
    if (cron) {
      if (jobId && seenJob.has(jobId)) continue;
      const job = byJob.get(jobId);
      if (hideSystem) {
        if (!job) continue;
        if (isSystemJob(job, byAgent.get(job.agent_id))) continue;
      }
      if (jobId) seenJob.add(jobId);
    } else {
      if (!agent || isOperatorAgent(agent)) continue;
      if (String(e.action) === "AgentMessage" && /tokens_in=/.test(String(e.detail || ""))) continue;
    }
    out.push({
      seq: e.seq,
      timestamp: e.timestamp,
      action: e.action,
      detail: e.detail,
      outcome: e.outcome,
      agentId,
      jobId,
      failed: /fail/i.test(String(e.action || "")),
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function mergeActivitySources(auditEntries, jobRuns) {
  const out = new Map();
  for (const e of [...(jobRuns || []), ...(auditEntries || [])]) {
    if (!e) continue;
    const key =
      e.seq != null
        ? `s${e.seq}`
        : `t${e.timestamp || ""}|${e.action || ""}|${e.detail || ""}`;
    if (!out.has(key)) out.set(key, e);
  }
  return [...out.values()];
}

export function activityJump(item, agents = []) {
  if (item && item.jobId) return { kind: "job", id: item.jobId };
  const id = item && item.agentId;
  if (!id) return null;
  const agent = (agents || []).find((a) => a.id === id);
  if (agent && isOperatorAgent(agent)) return null;
  if (id) return { kind: "chat", id };
  return null;
}

export function activityPreview(item) {
  const out = cronResultText(item && item.outcome);
  if (out && !/^ok$/i.test(out)) return out.slice(0, 160);
  const d = String((item && item.detail) || "").trim();
  if (!d) return "";
  return d.length > 160 ? `${d.slice(0, 157)}…` : d;
}
