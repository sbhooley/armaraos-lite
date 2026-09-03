import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_UPLOAD_BYTES,
  attachmentAllowed,
  isImageAttachment,
  sanitizeSessionLabel,
  sessionDisplayName,
  composeUserMessage,
  stripFileTags,
  looksLikeUuid,
  filterModels,
  mergePendingApprovals,
  pendingApprovalsForAgent,
  approvalKind,
  isAllowOnceApproval,
  isQuestionApproval,
  questionOptions,
  approvePayload,
  approvalActions,
  isConsumerAuditAction,
  consumerActivityEntries,
  mergeActivitySources,
  activityJump,
  auditActionLabel,
  sessionDeleteConfirmMessage,
  shouldIgnoreSessionDeleteClick,
  readStreamChunk,
  dropPathBlocked,
  displayAttachmentName,
  isAgentTurnJob,
  isSystemJob,
  visibleJobs,
  CRON_PRESETS,
  describeCron,
  jobTimingLine,
  formatUpcoming,
  latestCronResult,
  cronSchedulePayload,
  timeZoneLabel,
  timeZoneOptions,
  jobScheduleTimeZone,
} from "../web/lite-lib.js";

describe("attachments", () => {
  it("allows screenshots, PDFs, and scripts", () => {
    assert.equal(attachmentAllowed({ name: "shot.png", type: "image/png" }), true);
    assert.equal(attachmentAllowed({ name: "notes.pdf", type: "application/pdf" }), true);
    assert.equal(attachmentAllowed({ name: "run.py", type: "" }), true);
    assert.equal(attachmentAllowed({ name: "app.js", type: "text/javascript" }), true);
  });

  it("blocks executables even with a friendly MIME", () => {
    assert.equal(attachmentAllowed({ name: "payload.exe", type: "application/octet-stream" }), false);
    assert.equal(attachmentAllowed({ name: "setup.dmg", type: "application/x-apple-diskimage" }), false);
  });

  it("detects image attachments by type or extension", () => {
    assert.equal(isImageAttachment({ name: "x", type: "image/webp" }), true);
    assert.equal(isImageAttachment({ name: "photo.JPEG", type: "" }), true);
    assert.equal(isImageAttachment({ name: "notes.pdf", type: "application/pdf" }), false);
  });

  it("keeps the daemon 128MB ceiling", () => {
    assert.equal(MAX_UPLOAD_BYTES, 128 * 1024 * 1024);
  });
});

describe("session labels", () => {
  it("strips characters the daemon rejects", () => {
    assert.equal(sanitizeSessionLabel("Hello, world!"), "Hello world");
    assert.equal(sanitizeSessionLabel("path/traversal"), "path traversal");
    assert.equal(sanitizeSessionLabel("notes.txt"), "notes txt");
    assert.equal(sanitizeSessionLabel("   "), "");
  });

  it("caps auto-labels at 40 chars", () => {
    const long = "a".repeat(80);
    assert.equal(sanitizeSessionLabel(long, 40).length, 40);
  });

  it("never shows a UUID as the picker name", () => {
    const sid = "f79031aa-1111-2222-3333-444444444444";
    assert.equal(looksLikeUuid(sid), true);
    const name = sessionDisplayName({
      session_id: sid,
      label: "",
      created_at: "2026-09-02T12:00:00.000Z",
    });
    assert.equal(looksLikeUuid(name), false);
    assert.match(name, /^Chat · /);
    assert.equal(sessionDisplayName({ label: "Research inbox" }), "Research inbox");
    assert.equal(sessionDisplayName({}), "New chat");
  });

  it("adds a clock when two unlabeled chats share a calendar day", () => {
    const day = new Date();
    day.setHours(9, 5, 0, 0);
    const a = { session_id: "a", label: "", created_at: new Date(day).toISOString() };
    const later = new Date(day);
    later.setHours(15, 41, 0, 0);
    const b = { session_id: "b", label: "", created_at: later.toISOString() };
    const labeled = {
      session_id: "c",
      label: "File notes",
      created_at: new Date(day).toISOString(),
    };
    const siblings = [a, b, labeled];
    const nameA = sessionDisplayName(a, siblings);
    const nameB = sessionDisplayName(b, siblings);
    assert.match(nameA, /^Chat · /);
    assert.match(nameB, /^Chat · /);
    assert.match(nameA, /,/);
    assert.match(nameB, /,/);
    assert.notEqual(nameA, nameB);
    assert.equal(sessionDisplayName(a, [a, labeled]), sessionDisplayName(a));
    assert.equal(sessionDisplayName({ label: "File notes" }, siblings), "File notes");
  });

  it("keeps a single unlabeled chat as Chat · date without a clock", () => {
    const day = new Date();
    day.setHours(12, 0, 0, 0);
    const only = { session_id: "solo", label: "", created_at: day.toISOString() };
    const name = sessionDisplayName(only, [only]);
    assert.match(name, /^Chat · /);
    assert.equal(name.includes(","), false);
  });
});

describe("file tags in the user turn", () => {
  it("appends [File: name] for the model and strips it for display", () => {
    const sent = composeUserMessage("Summarize this", ["brief.pdf", "shot.png"]);
    assert.match(sent, /\[File: brief\.pdf\]/);
    assert.match(sent, /\[File: shot\.png\]/);
    assert.equal(stripFileTags(sent), "Summarize this");
    assert.equal(composeUserMessage("", ["only.txt"]), "[File: only.txt]");
    assert.equal(stripFileTags("[File: only.txt]"), "");
  });
});

describe("model catalog search", () => {
  const catalog = [
    { id: "armara", display_name: "Armara", provider: "armara" },
    { id: "gpt-4o", display_name: "GPT-4o", provider: "openai" },
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 · anthropic", provider: "anthropic" },
    { id: "nvidia/nemotron-3-super-120b-a12b:free", display_name: "Nemotron", provider: "openrouter" },
  ];

  it("keeps current order and caps results", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `m${i}`, provider: "openai" }));
    assert.equal(filterModels(many, "", 50).length, 50);
    assert.equal(filterModels(many, "", 3).map((m) => m.id).join(","), "m0,m1,m2");
  });

  it("matches id, display name, label, and provider", () => {
    assert.equal(filterModels(catalog, "claude").map((m) => m.id).join(), "claude-sonnet-4-5");
    assert.equal(filterModels(catalog, "openai").map((m) => m.id).join(), "gpt-4o");
    assert.equal(filterModels(catalog, "Nemotron").map((m) => m.id).join(), "nvidia/nemotron-3-super-120b-a12b:free");
    assert.equal(filterModels(catalog, "no-such-model").length, 0);
  });
});

describe("pending approvals in the thread", () => {
  it("inserts pending cards for the current agent only", () => {
    const thread = [{ role: "user", text: "go" }];
    const changed = mergePendingApprovals(
      thread,
      [
        { id: "p1", status: "pending", agent_id: "agent-a", action_summary: "Run shell" },
        { id: "p2", status: "pending", agent_id: "agent-b", action_summary: "Other agent" },
        { id: "done", status: "approved", agent_id: "agent-a", action_summary: "Already done" },
      ],
      "agent-a",
    );
    assert.equal(changed, true);
    assert.equal(thread.filter((m) => m.kind === "approval").length, 1);
    assert.equal(thread.at(-1).id, "p1");
    assert.equal(thread.at(-1).text, "Run shell");
    assert.equal(thread.at(-1).approvalKind, "tool_gate");
  });

  it("skips duplicates and drops cards that are no longer pending", () => {
    const thread = [
      { role: "assistant", text: "working" },
      { kind: "approval", id: "p1", text: "Run shell" },
      { kind: "approval", id: "old", text: "Stale" },
    ];
    const again = mergePendingApprovals(
      thread,
      [{ id: "p1", status: "pending", agent_id: "agent-a", tool_name: "shell" }],
      "agent-a",
    );
    assert.equal(again, true);
    assert.deepEqual(
      thread.filter((m) => m.kind === "approval").map((m) => m.id),
      ["p1"],
    );
    assert.equal(
      pendingApprovalsForAgent(
        [
          { id: "p1", status: "pending", agent_id: "agent-a" },
          { id: "x", status: "rejected", agent_id: "agent-a" },
        ],
        "agent-a",
      ).length,
      1,
    );
  });
});

describe("session delete guard", () => {
  it("names the chat in the confirm copy", () => {
    assert.match(sessionDeleteConfirmMessage("File notes"), /File notes/);
    assert.match(sessionDeleteConfirmMessage("Chat · Sep 3"), /will be gone/);
  });

  it("ignores a second click while a delete is already in flight", () => {
    assert.equal(
      shouldIgnoreSessionDeleteClick({ sid: "a", streaming: false, deletingId: null }),
      false,
    );
    assert.equal(
      shouldIgnoreSessionDeleteClick({ sid: "a", streaming: false, deletingId: "a" }),
      true,
    );
    assert.equal(
      shouldIgnoreSessionDeleteClick({ sid: "b", streaming: false, deletingId: "a" }),
      true,
    );
    assert.equal(
      shouldIgnoreSessionDeleteClick({ sid: "a", streaming: true, deletingId: null }),
      true,
    );
    assert.equal(
      shouldIgnoreSessionDeleteClick({ sid: "", streaming: false, deletingId: null }),
      true,
    );
  });
});

describe("stream read cannot hang past abort or idle", () => {
  function hangingReader() {
    return {
      cancelled: false,
      read() {
        return new Promise(() => {});
      },
      cancel() {
        this.cancelled = true;
        return Promise.resolve();
      },
    };
  }

  it("rejects with AbortError when the signal fires", async () => {
    const reader = hangingReader();
    const ac = new AbortController();
    const pending = readStreamChunk(reader, ac.signal, 30_000);
    ac.abort();
    await assert.rejects(pending, (err) => err && err.name === "AbortError");
    assert.equal(reader.cancelled, true);
  });

  it("resolves done/idle when no bytes arrive", async () => {
    const reader = hangingReader();
    const result = await readStreamChunk(reader, undefined, 260);
    assert.equal(result.done, true);
    assert.equal(result.idle, true);
    assert.equal(reader.cancelled, true);
  });
});

describe("folder drops", () => {
  it("skips git metadata and junk files, keeps nested source", () => {
    assert.equal(dropPathBlocked("src/app.js"), false);
    assert.equal(dropPathBlocked("notes/.git/config"), true);
    assert.equal(dropPathBlocked("project/node_modules/left-pad/index.js"), true);
    assert.equal(dropPathBlocked("shot/.DS_Store"), true);
  });

  it("prefers relative paths for display", () => {
    assert.equal(displayAttachmentName({ name: "app.js", webkitRelativePath: "src/app.js" }), "src/app.js");
    assert.equal(displayAttachmentName({ name: "app.js", litePath: "lib/app.js" }), "lib/app.js");
    assert.equal(displayAttachmentName({ name: "notes.txt" }), "notes.txt");
  });
});

describe("automation kinds", () => {
  it("only treats agent_turn jobs as in-place editable", () => {
    assert.equal(isAgentTurnJob({ action: { kind: "agent_turn", message: "hi" } }), true);
    assert.equal(isAgentTurnJob({ action: { kind: "ainl_run", program_path: "x.ainl" } }), false);
  });

  it("treats AINL, workspace_action, and operator hands as system tasks", () => {
    assert.equal(isSystemJob({ action: { kind: "ainl_run" } }), true);
    assert.equal(isSystemJob({ action: { kind: "workspace_action" } }), true);
    assert.equal(
      isSystemJob({ action: { kind: "agent_turn" } }, { name: "predictor-hand", premium_hand: false }),
      true,
    );
    assert.equal(
      isSystemJob({ action: { kind: "agent_turn" } }, { name: "Researcher" }),
      false,
    );
    const jobs = [
      { id: "a", action: { kind: "agent_turn" }, agent_id: "r" },
      { id: "b", action: { kind: "ainl_run" }, agent_id: "r" },
      { id: "c", action: { kind: "agent_turn" }, agent_id: "h" },
    ];
    const agents = [
      { id: "r", name: "Researcher" },
      { id: "h", name: "predictor-hand" },
    ];
    assert.deepEqual(
      visibleJobs(jobs, agents, true).map((j) => j.id),
      ["a"],
    );
    assert.equal(visibleJobs(jobs, agents, false).length, 3);
  });
});

describe("readable cron schedules", () => {
  it("covers weekday, hourly, every 5 minutes, and Monday presets", () => {
    const values = CRON_PRESETS.map((p) => p.value);
    assert.equal(values.includes("0 9 * * 1-5"), true);
    assert.equal(values.includes("0 * * * *"), true);
    assert.equal(values.includes("*/5 * * * *"), true);
    assert.equal(values.includes("0 10 * * 1"), true);
    assert.equal(describeCron("0 9 * * 1-5"), "Weekday mornings (9:00)");
    assert.equal(describeCron("0 * * * *"), "Every hour");
    assert.equal(describeCron("*/5 * * * *"), "Every 5 minutes");
    assert.equal(describeCron("0 10 * * 1"), "Monday mornings (10:00)");
    assert.equal(describeCron("0 11 * * 1"), "Mondays at 11:00 AM");
    assert.equal(describeCron("0 7 * * 1-5"), "Weekdays at 7:00 AM");
  });
});

describe("job timing copy", () => {
  it("shows last/next when enabled and hides next when paused", () => {
    const now = Date.parse("2026-09-03T15:00:00.000Z");
    const last = "2026-09-03T13:00:00.000Z";
    const next = "2026-09-04T09:00:00.000Z";
    const enabled = jobTimingLine({ enabled: true, last_run: last, next_run: next, schedule: { tz: null } }, now);
    assert.match(enabled, /Last run 2 hours ago/);
    assert.match(enabled, /Next tomorrow 9:00/);
    const paused = jobTimingLine({ enabled: false, last_run: last, next_run: next }, now);
    assert.match(paused, /Last run 2 hours ago/);
    assert.match(paused, /Paused/);
    assert.equal(paused.includes("Next"), false);
    assert.equal(jobTimingLine({ enabled: false }, now), "Paused · never run");
  });

  it("prints next run in the job timezone so a 9:00 UTC cron is not 4:00 local", () => {
    const now = Date.parse("2026-09-03T15:00:00.000Z");
    const utc = formatUpcoming("2026-09-04T09:00:00.000Z", now, "UTC");
    assert.match(utc, /tomorrow/);
    assert.match(utc, /9:00/);
    const chicago = formatUpcoming("2026-09-04T14:00:00.000Z", now, "America/Chicago");
    assert.match(chicago, /9:00/);
  });
});

describe("cron time zones", () => {
  it("sends null tz for UTC and IANA names otherwise", () => {
    assert.deepEqual(cronSchedulePayload("0 9 * * 1-5", "UTC"), {
      kind: "cron",
      expr: "0 9 * * 1-5",
      tz: null,
    });
    assert.deepEqual(cronSchedulePayload("0 9 * * 1-5", "America/Chicago"), {
      kind: "cron",
      expr: "0 9 * * 1-5",
      tz: "America/Chicago",
    });
    assert.equal(cronSchedulePayload("0 9 * * *", "Not/AZone").tz, null);
    assert.equal(timeZoneLabel("America/Chicago"), "Central (Chicago)");
    assert.equal(timeZoneLabel(null), "UTC");
    assert.equal(jobScheduleTimeZone({ schedule: { tz: null } }), "UTC");
    const opts = timeZoneOptions("Pacific/Auckland");
    assert.equal(opts.some((o) => o.value === "UTC"), true);
    assert.equal(opts.some((o) => o.value === "America/Chicago"), true);
    assert.equal(opts.some((o) => o.value === "Pacific/Auckland"), true);
  });
});

describe("latest cron result", () => {
  const job = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const other = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  it("matches id= in detail, skips other jobs, and uses the newest output or failure", () => {
    const runs = [
      { action: "CronJobRun", detail: `job=A, id=${job}`, outcome: "started" },
      { action: "CronJobFailure", detail: `job=A, id=${job}`, outcome: "timed out after 120s" },
      { action: "CronJobOutput", detail: `job=A, id=${job}`, outcome: "older success" },
      { action: "CronJobOutput", detail: `job=B, id=${other}`, outcome: "other job" },
    ];
    const mine = latestCronResult(runs, job);
    assert.equal(mine.text, "timed out after 120s");
    assert.equal(mine.failed, true);
    assert.equal(latestCronResult(runs, other).text, "other job");
    assert.equal(latestCronResult(runs, "cccccccc-cccc-cccc-cccc-cccccccccccc"), null);
  });

  it("prefers CronJobOutput over CronJobRun when that is the newest result", () => {
    const runs = [
      { action: "CronJobOutput", detail: `job=A, id=${job}`, outcome: "priorities listed" },
      { action: "CronJobRun", detail: `job=A, id=${job}`, outcome: "started" },
    ];
    const hit = latestCronResult(runs, job);
    assert.equal(hit.text, "priorities listed");
    assert.equal(hit.failed, false);
  });
});

describe("approval actions", () => {
  it("treats one_time_tool_grant as allow-once with once/session scopes", () => {
    assert.equal(approvalKind({ kind: "one_time_tool_grant" }), "one_time_tool_grant");
    assert.equal(isAllowOnceApproval({ kind: "one_time_tool_grant" }), true);
    assert.equal(isQuestionApproval({ kind: "one_time_tool_grant" }), false);
    assert.deepEqual(approvalActions({ kind: "one_time_tool_grant" }), { mode: "allow_once" });
    assert.deepEqual(approvePayload({ scope: "once" }), { scope: "once" });
    assert.deepEqual(approvePayload({ scope: "session" }), { scope: "session" });
    assert.deepEqual(approvePayload({}), {});
  });

  it("surfaces question options as choices", () => {
    const a = { kind: "question", question_options: ["Yes", "No", ""] };
    assert.equal(isQuestionApproval(a), true);
    assert.deepEqual(questionOptions(a), ["Yes", "No"]);
    assert.deepEqual(approvalActions(a), { mode: "choices", options: ["Yes", "No"] });
    assert.deepEqual(approvePayload({ answer: "Yes" }), { answer: "Yes" });
    assert.deepEqual(approvalActions({ kind: "tool_gate" }), { mode: "approve" });
    assert.deepEqual(approvalActions({ kind: "question" }), { mode: "question_text" });
    assert.deepEqual(approvalActions({ kind: "question", question_options: [] }), { mode: "question_text" });
  });
});

describe("consumer activity feed", () => {
  const personal = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const system = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const jobs = [
    { id: personal, name: "Weekly scan", agent_id: "armara", action: { kind: "agent_turn" } },
    { id: system, name: "test-ainl-pulse", agent_id: "armara", action: { kind: "ainl_run" } },
  ];
  const agents = [
    { id: "armara", name: "Armara" },
    { id: "op-hand", name: "ops-hand", premium_hand: true },
  ];

  it("keeps consumer cron output and agent messages, skips noise and hashes", () => {
    assert.equal(isConsumerAuditAction("CronJobOutput"), true);
    assert.equal(isConsumerAuditAction("CapabilityCheck"), false);
    assert.equal(auditActionLabel("CronJobFailure"), "Automation failed");
    const entries = [
      { seq: 10, action: "CronJobOutput", detail: `job=Weekly scan, id=${personal}`, outcome: "done", agent_id: "armara" },
      { seq: 9, action: "CronJobFailure", detail: `job=Weekly scan, id=${personal}`, outcome: "older fail", agent_id: "armara" },
      { seq: 8, action: "CronJobOutput", detail: `job=test-ainl-pulse, id=${system}`, outcome: "ainl", agent_id: "armara" },
      { seq: 7, action: "CapabilityCheck", detail: "tools", outcome: "ok", agent_id: "armara" },
      { seq: 6, action: "AgentMessage", detail: "hello", outcome: "ok", agent_id: "armara" },
      { seq: 5.5, action: "AgentMessage", detail: "tokens_in=20646, tokens_out=409", outcome: "ok", agent_id: "armara" },
      { seq: 5, action: "ToolInvoke", detail: "web_search", outcome: "ok", agent_id: "op-hand" },
      { seq: 4, action: "AgentSpawn", detail: "name=gone", outcome: "ok", agent_id: "missing" },
    ];
    const rows = consumerActivityEntries(entries, { jobs, agents, hideSystem: true });
    assert.equal(rows.some((r) => r.jobId === personal), true);
    assert.equal(rows.filter((r) => r.jobId === personal).length, 1);
    assert.equal(rows.find((r) => r.jobId === personal).failed, false);
    assert.equal(rows.some((r) => r.jobId === system), false);
    assert.equal(rows.some((r) => r.action === "AgentMessage"), true);
    assert.equal(rows.some((r) => /tokens_in=/.test(String(r.detail || ""))), false);
    assert.equal(rows.some((r) => r.action === "AgentSpawn"), false);
    assert.equal(rows.some((r) => r.agentId === "op-hand"), false);
    assert.equal(rows.some((r) => r.hash), false);
    assert.deepEqual(activityJump(rows.find((r) => r.jobId === personal), agents), {
      kind: "job",
      id: personal,
    });
    assert.deepEqual(activityJump({ agentId: "armara" }, agents), { kind: "chat", id: "armara" });
    const merged = mergeActivitySources(
      [{ seq: 1, action: "AgentMessage", detail: "hello", agent_id: "armara" }],
      [{ seq: 99, action: "CronJobOutput", detail: `job=Weekly scan, id=${personal}`, outcome: "done", agent_id: "armara" }],
    );
    assert.equal(merged.length, 2);
    assert.equal(
      consumerActivityEntries(merged, { jobs, agents, hideSystem: true }).some((r) => r.jobId === personal),
      true,
    );
  });
});
