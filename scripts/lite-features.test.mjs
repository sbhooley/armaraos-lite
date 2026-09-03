import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { looksLikeUuid, sessionDisplayName, sanitizeSessionLabel } from "../web/lite-lib.js";

const ARMARA_ID = "e74411f4-d72a-4278-b088-6a47aff8c6fe";
const CANDIDATES = ["http://127.0.0.1:50051", "http://127.0.0.1:4210"];

async function ping(base) {
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function json(base, method, path, body, headers = {}) {
  const opts = { method, headers: { ...headers } };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, opts);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error((data && (data.error || data.message)) || `${method} ${path} → ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

let base = null;
for (const url of CANDIDATES) {
  if (await ping(url)) {
    base = url;
    break;
  }
}

describe("live daemon contracts", { skip: !base }, () => {
  let agentId = null;
  let originalModel = null;
  let originalProvider = null;

  after(async () => {
    if (base && agentId) {
      await fetch(`${base}/api/agents/${encodeURIComponent(agentId)}`, { method: "DELETE" }).catch(
        () => {},
      );
    }
    await fetch("http://127.0.0.1:4210/lite/prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultAssistantId: ARMARA_ID }),
    }).catch(() => {});
  });

  it("creates a throwaway assistant, renames it, and changes model", async () => {
    const stamp = Date.now().toString(36);
    const name = `litetest-${stamp}`;
    const created = await json(base, "POST", "/api/agents", {
      manifest_toml:
        `name = "${name}"\n` +
        `description = "Lite production probe — delete after test"\n` +
        `profile = "automation"\n\n` +
        `[model]\nprovider = "armara"\nmodel = "armara"\n`,
    });
    agentId = created.agent_id || created.id;
    assert.ok(agentId, "create returns an agent id");
    assert.notEqual(agentId, ARMARA_ID);

    const renamed = `litetest ${stamp}`;
    await json(base, "PATCH", `/api/agents/${encodeURIComponent(agentId)}`, { name: renamed });
    const agents = await json(base, "GET", "/api/agents");
    const list = agents.agents || agents || [];
    const row = list.find((a) => a.id === agentId);
    assert.ok(row, "renamed assistant is listed");
    assert.equal(row.name, renamed);

    originalModel = row.model_name;
    originalProvider = row.model_provider;
    const models = await json(
      base,
      "GET",
      `/api/models?available=true&provider=${encodeURIComponent(originalProvider || "armara")}`,
    );
    const catalog = models.models || [];
    assert.ok(Array.isArray(catalog), "model catalog is a list");
    const other = catalog.find((m) => m.id && m.id !== originalModel);
    if (other) {
      await json(base, "PUT", `/api/agents/${encodeURIComponent(agentId)}/model`, {
        model: other.id,
        provider: other.provider || originalProvider,
      });
      await json(base, "PUT", `/api/agents/${encodeURIComponent(agentId)}/model`, {
        model: originalModel,
        provider: originalProvider,
      });
    }
  });

  it("uploads a text file and labels a session with a human name", async () => {
    assert.ok(agentId, "throwaway assistant exists");
    const form = new FormData();
    form.append("file", new Blob(["hello from lite production test\n"], { type: "text/plain" }), "lite-test.txt");
    form.append("filename", "lite-test.txt");
    const uploaded = await json(base, "POST", `/api/agents/${encodeURIComponent(agentId)}/upload`, form);
    assert.ok(uploaded.file_id, "upload returns file_id");
    assert.equal(uploaded.filename, "lite-test.txt");

    const session = await json(base, "POST", `/api/agents/${encodeURIComponent(agentId)}/sessions`, {});
    const sid = session.session_id || session.id;
    assert.ok(sid, "new session has an id");
    const label = sanitizeSessionLabel("Research inbox");
    await json(base, "PUT", `/api/sessions/${encodeURIComponent(sid)}/label`, { label });
    const listed = await json(base, "GET", `/api/agents/${encodeURIComponent(agentId)}/sessions`);
    const row = (listed.sessions || []).find((s) => (s.session_id || s.id) === sid);
    assert.ok(row, "labeled session is listed");
    assert.equal(row.label, label);
    const shown = sessionDisplayName(row);
    assert.equal(shown, "Research inbox");
    assert.equal(looksLikeUuid(shown), false);
  });

  it("patches description and instructions on GET /api/agents/:id", async () => {
    assert.ok(agentId, "throwaway assistant exists");
    const description = "Lite probe description";
    const system_prompt = "You are a throwaway Lite probe. Reply in one short sentence.";
    await json(base, "PATCH", `/api/agents/${encodeURIComponent(agentId)}`, {
      description,
      system_prompt,
    });
    const detail = await json(base, "GET", `/api/agents/${encodeURIComponent(agentId)}`);
    const row = detail.agent || detail;
    assert.equal(row.description, description);
    const prompt = row.system_prompt || row.systemPrompt || "";
    assert.match(String(prompt), /throwaway Lite probe/);
  });

  it("deletes a throwaway session without touching Armara", async () => {
    assert.ok(agentId, "throwaway assistant exists");
    const armaraBefore = await json(base, "GET", `/api/agents/${encodeURIComponent(ARMARA_ID)}/sessions`);
    const armaraIds = (armaraBefore.sessions || []).map((s) => s.session_id || s.id).sort();

    const session = await json(base, "POST", `/api/agents/${encodeURIComponent(agentId)}/sessions`, {});
    const sid = session.session_id || session.id;
    assert.ok(sid, "new session has an id");
    await json(base, "DELETE", `/api/sessions/${encodeURIComponent(sid)}`);
    const listed = await json(base, "GET", `/api/agents/${encodeURIComponent(agentId)}/sessions`);
    const stillThere = (listed.sessions || []).some((s) => (s.session_id || s.id) === sid);
    assert.equal(stillThere, false);

    const armaraAfter = await json(base, "GET", `/api/agents/${encodeURIComponent(ARMARA_ID)}/sessions`);
    const afterIds = (armaraAfter.sessions || []).map((s) => s.session_id || s.id).sort();
    assert.deepEqual(afterIds, armaraIds);
  });

  it("returns a searchable available-model catalog", async () => {
    const models = await json(base, "GET", "/api/models?available=true");
    const catalog = models.models || [];
    assert.ok(Array.isArray(catalog), "model catalog is a list");
    assert.ok(catalog.length >= 1, "catalog is not empty");
    assert.ok(catalog.every((m) => m && m.id), "every model has an id");
  });

  it("injects a pending approval for the throwaway agent", async () => {
    assert.ok(agentId, "throwaway assistant exists");
    const created = await json(base, "POST", "/api/approvals", {
      agent_id: agentId,
      tool_name: "lite_probe",
      description: "Lite production approval probe",
      action_summary: "Allow the Lite test tool",
    });
    const approvalId = created.id || created.approval_id;
    assert.ok(approvalId, "create returns an approval id");
    const listed = await json(base, "GET", "/api/approvals");
    const row = (listed.approvals || []).find((a) => (a.id || a.approval_id) === approvalId);
    assert.ok(row, "approval is listed");
    assert.equal(String(row.status || "pending").toLowerCase(), "pending");
    assert.equal(row.agent_id || row.agentId, agentId);
    await json(base, "POST", `/api/approvals/${encodeURIComponent(approvalId)}/reject`, {});
    const after = await json(base, "GET", "/api/approvals");
    const leftover = (after.approvals || []).find(
      (a) => (a.id || a.approval_id) === approvalId && String(a.status || "").toLowerCase() === "pending",
    );
    assert.equal(leftover, undefined);
  });

  it("approves a throwaway request with allow-once scope", async () => {
    assert.ok(agentId, "throwaway assistant exists");
    const created = await json(base, "POST", "/api/approvals", {
      agent_id: agentId,
      tool_name: "lite_probe_once",
      description: "Lite allow-once probe",
      action_summary: "Allow the Lite once-scope probe",
    });
    const approvalId = created.id || created.approval_id;
    assert.ok(approvalId, "create returns an approval id");
    const approved = await json(base, "POST", `/api/approvals/${encodeURIComponent(approvalId)}/approve`, {
      scope: "once",
    });
    assert.equal(String(approved.status || "").toLowerCase(), "approved");
    const after = await json(base, "GET", "/api/approvals");
    const leftover = (after.approvals || []).find(
      (a) => (a.id || a.approval_id) === approvalId && String(a.status || "").toLowerCase() === "pending",
    );
    assert.equal(leftover, undefined);
  });

  it("audit recent and events stream are available", async () => {
    const audit = await json(base, "GET", "/api/audit/recent?n=20");
    assert.ok(Array.isArray(audit.entries), "GET /api/audit/recent returns entries");
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 2500);
    try {
      const res = await fetch(`${base}/api/events/stream`, {
        headers: { Accept: "text/event-stream" },
        signal: ac.signal,
      });
      assert.ok(res.ok, "events stream responds");
      assert.match(String(res.headers.get("content-type") || ""), /text\/event-stream/);
      if (res.body) await res.body.cancel();
    } finally {
      clearTimeout(t);
    }
  });

  it("cron runs expose job= and id= so Lite can show last result", async () => {
    const data = await json(base, "GET", "/api/cron/runs?n=200");
    assert.ok(Array.isArray(data.runs), "GET /api/cron/runs returns a runs array");
    const withId = (data.runs || []).find((r) =>
      /\bid=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(String(r.detail || "")),
    );
    if ((data.runs || []).length) {
      assert.ok(withId, "run detail includes id=<uuid>");
      assert.match(String(withId.action || ""), /CronJob(Run|Output|Failure)/);
    }
  });

  it("creates, edits, and deletes a throwaway automation without touching existing jobs", async () => {
    assert.ok(agentId, "throwaway assistant exists");
    const before = await json(base, "GET", "/api/cron/jobs");
    const beforeIds = new Set((before.jobs || []).map((j) => j.id));
    const name = `lite-auto-${Date.now().toString(36)}`;
    const created = await json(base, "POST", "/api/cron/jobs", {
      agent_id: agentId,
      name,
      schedule: { kind: "cron", expr: "0 11 * * 1", tz: "America/Chicago" },
      action: { kind: "agent_turn", message: "lite probe", model_override: null, timeout_secs: null },
      enabled: false,
    });
    let jobId = created.job_id || created.id;
    if (!jobId && typeof created.result === "string") {
      try {
        jobId = JSON.parse(created.result).job_id;
      } catch {
        jobId = null;
      }
    }
    if (!jobId) {
      const listed = await json(base, "GET", "/api/cron/jobs");
      jobId = (listed.jobs || []).find((j) => j.name === name)?.id;
    }
    assert.ok(jobId, "create returns a job id");
    await json(base, "PUT", `/api/cron/jobs/${encodeURIComponent(jobId)}`, {
      agent_id: agentId,
      name: `${name}-edited`,
      enabled: false,
      schedule: { kind: "cron", expr: "0 12 * * 1", tz: "America/Chicago" },
      action: {
        kind: "agent_turn",
        message: "lite probe edited",
        model_override: null,
        timeout_secs: null,
      },
    });
    const afterEdit = await json(base, "GET", "/api/cron/jobs");
    const row = (afterEdit.jobs || []).find((j) => j.id === jobId);
    assert.ok(row, "edited job is listed");
    assert.equal(row.name, `${name}-edited`);
    assert.match(String(row.action?.message || ""), /edited/);
    assert.equal(row.schedule?.expr, "0 12 * * 1");
    assert.equal(row.schedule?.tz, "America/Chicago");
    assert.equal(row.agent_id, agentId, "create/edit keep the chosen non-default assistant");
    await json(base, "DELETE", `/api/cron/jobs/${encodeURIComponent(jobId)}`);
    const after = await json(base, "GET", "/api/cron/jobs");
    const leftover = (after.jobs || []).some((j) => j.id === jobId);
    assert.equal(leftover, false);
    for (const id of beforeIds) {
      assert.equal(
        (after.jobs || []).some((j) => j.id === id),
        true,
        "existing automations were left in place",
      );
    }
  });

  it("deletes the throwaway assistant and leaves Armara in place", async () => {
    assert.ok(agentId);
    await json(base, "DELETE", `/api/agents/${encodeURIComponent(agentId)}`);
    const agents = await json(base, "GET", "/api/agents");
    const list = agents.agents || agents || [];
    assert.equal(list.some((a) => a.id === agentId), false);
    assert.equal(
      list.some((a) => a.id === ARMARA_ID),
      true,
      "production Armara assistant is still registered",
    );
    agentId = null;
  });
});
