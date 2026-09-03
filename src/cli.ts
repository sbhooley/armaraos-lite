import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { findDaemon, daemonHealth, armaraosHome, readDaemonInfo } from "./daemon.ts";
import { loadPrefs, savePrefs, type DashboardChoice } from "./prefs.ts";
import { startLiteServer, DEFAULT_LITE_PORT, openInBrowser } from "./server.ts";

const HELP = `
armaraos-lite — personal AI workspace (consumer shell over the ArmaraOS daemon)

Usage:
  armaraos-lite                     Same as start (uses saved dashboard preference)
  armaraos-lite start [options]
  armaraos-lite dashboard [options]  Open a dashboard (lite or classic)
  armaraos-lite use lite|classic    Save default dashboard preference
  armaraos-lite status
  armaraos-lite chat [message]
  armaraos-lite advanced --open

Dashboard options (start / dashboard):
  --lite                 New Lite workspace (http://127.0.0.1:4210)
  --classic, --old       Classic ArmaraOS operator dashboard (daemon URL)
  --choose               Ask which dashboard to open (interactive)
  --port N               Lite server port (default 4210)
  --no-open              Do not open a browser
  --remember             Save this choice as the default

Requires a running ArmaraOS daemon (armaraos start). Does not replace armaraos.
`.trim();

function print(msg: string): void {
  process.stdout.write(msg + "\n");
}

function fail(msg: string, hint?: string): never {
  process.stderr.write(`Error: ${msg}\n`);
  if (hint) process.stderr.write(`Hint: ${hint}\n`);
  process.exit(1);
}

function parseDashboardFlag(args: string[]): {
  choice: DashboardChoice | "ask" | null;
  port: number;
  openBrowser: boolean;
  remember: boolean;
  rest: string[];
} {
  let choice: DashboardChoice | "ask" | null = null;
  let port = DEFAULT_LITE_PORT;
  let openBrowser = true;
  let remember = false;
  const rest: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--lite" || a === "--new") choice = "lite";
    else if (a === "--classic" || a === "--old" || a === "--full") choice = "classic";
    else if (a === "--choose" || a === "--ask") choice = "ask";
    else if (a === "--remember") remember = true;
    else if (a === "--no-open") openBrowser = false;
    else if (a === "--port" && args[i + 1]) port = Number(args[++i]);
    else rest.push(a!);
  }

  return { choice, port, openBrowser, remember, rest };
}

async function promptDashboardChoice(): Promise<DashboardChoice> {
  if (!process.stdin.isTTY) {
    return "lite";
  }
  print("");
  print("Which dashboard?");
  print("  1) Lite     — simple workspace (Home, Assistants, Automations)");
  print("  2) Classic  — full operator dashboard (missions, MCP, graph memory, …)");
  print("");
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question("Choose [1/2] (default 1): ")).trim().toLowerCase();
    if (answer === "2" || answer === "classic" || answer === "old" || answer === "c") {
      return "classic";
    }
    return "lite";
  } finally {
    rl.close();
  }
}

async function resolveDashboard(
  flag: DashboardChoice | "ask" | null,
): Promise<DashboardChoice> {
  if (flag === "lite" || flag === "classic") return flag;
  if (flag === "ask") return promptDashboardChoice();

  const prefs = await loadPrefs();
  if (prefs.preferredDashboard === "lite" || prefs.preferredDashboard === "classic") {
    return prefs.preferredDashboard;
  }
  // No preference yet — ask when interactive, otherwise default to Lite.
  if (process.stdin.isTTY) return promptDashboardChoice();
  return "lite";
}

async function openClassicDashboard(daemonBaseUrl: string, openBrowser: boolean): Promise<void> {
  const url = daemonBaseUrl.endsWith("/") ? daemonBaseUrl : `${daemonBaseUrl}/`;
  print(`Opening classic ArmaraOS dashboard: ${url}`);
  if (openBrowser) openInBrowser(url);
  else print(`Visit: ${url}`);
}

async function openLiteDashboard(
  daemonBaseUrl: string,
  port: number,
  openBrowser: boolean,
): Promise<void> {
  print(`Starting ArmaraOS Lite on http://127.0.0.1:${port} …`);
  const { url } = await startLiteServer({ daemonBaseUrl, port, openBrowser });
  print(`Lite workspace ready: ${url}`);
  print("Press Ctrl+C to stop Lite (daemon keeps running).");
  await new Promise<void>(() => {
    /* keep alive */
  });
}

async function cmdStatus(): Promise<void> {
  const info = await readDaemonInfo();
  const base = await findDaemon();
  const prefs = await loadPrefs();

  print("ArmaraOS Lite status");
  print(`  ArmaraOS home:  ${armaraosHome()}`);
  print(`  daemon.json:    ${info ? `${info.listen_addr} (pid ${info.pid}, v${info.version})` : "missing"}`);
  if (base) {
    const h = await daemonHealth(base);
    print(`  daemon health:  ${h.ok ? `ok (${h.version || "?"})` : "unreachable"} @ ${base}`);
  } else {
    print("  daemon health:  unreachable");
    print("  → Start the full CLI first: armaraos start");
  }
  print(`  lite port:      ${DEFAULT_LITE_PORT} (when running)`);
  print(
    `  dashboard pref: ${prefs.preferredDashboard || "(not set — will ask)"}`,
  );
  print(`  setup complete: ${prefs.setupComplete}`);
  print(`  default assistant: ${prefs.defaultAssistantId || "(none)"}`);
}

async function cmdStart(args: string[]): Promise<void> {
  const { choice: flag, port, openBrowser, remember } = parseDashboardFlag(args);
  const base = await findDaemon();
  if (!base) {
    fail(
      "ArmaraOS daemon not reachable.",
      "Start it with `armaraos start`, then run `armaraos-lite` again. Lite does not start the kernel itself.",
    );
  }

  print(`Daemon found at ${base}`);
  const prefsBefore = await loadPrefs();
  const hadPreference = prefsBefore.preferredDashboard === "lite" || prefsBefore.preferredDashboard === "classic";
  const choice = await resolveDashboard(flag);

  if (remember) {
    await savePrefs({ preferredDashboard: choice });
    print(`Saved default dashboard: ${choice}`);
  } else if (process.stdin.isTTY && (flag === "ask" || !hadPreference)) {
    const rl = createInterface({ input, output });
    try {
      const save = (await rl.question(`Remember “${choice}” as default? [y/N]: `)).trim().toLowerCase();
      if (save === "y" || save === "yes") {
        await savePrefs({ preferredDashboard: choice });
        print(`Saved default dashboard: ${choice}`);
      }
    } finally {
      rl.close();
    }
  }

  if (choice === "classic") {
    await openClassicDashboard(base, openBrowser);
    return;
  }
  await openLiteDashboard(base, port, openBrowser);
}

async function cmdUse(args: string[]): Promise<void> {
  const raw = (args[0] || "").toLowerCase();
  let choice: DashboardChoice | null = null;
  if (raw === "lite" || raw === "new") choice = "lite";
  else if (raw === "classic" || raw === "old" || raw === "full") choice = "classic";
  else if (raw === "clear" || raw === "reset" || raw === "ask") {
    await savePrefs({ preferredDashboard: null });
    print("Cleared dashboard preference — next start will ask.");
    return;
  }
  if (!choice) {
    fail("Usage: armaraos-lite use lite|classic|clear");
  }
  await savePrefs({ preferredDashboard: choice });
  print(`Default dashboard set to “${choice}”.`);
  print(
    choice === "lite"
      ? "Next `armaraos-lite` opens the Lite workspace."
      : "Next `armaraos-lite` opens the classic operator dashboard.",
  );
}

async function cmdChat(args: string[]): Promise<void> {
  const base = await findDaemon();
  if (!base) {
    fail("ArmaraOS daemon not reachable.", "Run: armaraos start");
  }
  const prefs = await loadPrefs();
  let agentId = prefs.defaultAssistantId;
  const agents = (await (await fetch(`${base}/api/agents`)).json()) as Array<{
    id: string;
    name: string;
    premium_hand?: unknown;
    model_provider?: string;
  }>;
  const usable = agents.filter((a) => !a.premium_hand);
  const preferred =
    usable.find((a) => /^(armara|assistant|researcher|writer|coder)/i.test(a.name)) ||
    usable.find((a) => a.model_provider === "armara") ||
    usable[0];
  if (!agentId || !usable.some((a) => a.id === agentId)) {
    agentId = preferred?.id || null;
  }
  if (!agentId) fail("No assistants found.", "Open Lite and finish setup, or create an agent in the full dashboard.");

  const message = args.join(" ").trim() || (await readStdinPrompt());
  if (!message) fail("No message provided.");

  print(`→ ${message}`);
  const res = await fetch(`${base}/api/agents/${agentId}/message/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text();
    fail(`Stream failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let wrote = false;
  process.stdout.write("← ");
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() || "";
    for (const block of parts) {
      let ev = "message";
      const dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) ev = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(dataLines.join("\n"));
      } catch {
        continue;
      }
      if (ev === "token" || ev === "text" || ev === "delta" || ev === "chunk") {
        const t = (payload.text || payload.delta || payload.content || payload.chunk || "") as string;
        if (t) {
          process.stdout.write(t);
          wrote = true;
        }
      } else if (ev === "done" || ev === "complete") {
        const t = (payload.text || payload.message || "") as string;
        if (t) {
          process.stdout.write(t);
          wrote = true;
        }
      } else if (ev === "error") {
        process.stdout.write("\n");
        fail(String(payload.error || payload.message || "stream error"));
      }
    }
  }
  if (!wrote) {
    const fallback = await fetch(`${base}/api/agents/${agentId}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (fallback.ok) {
      const body = (await fallback.json()) as { response?: string; message?: string; text?: string };
      const t = body.response || body.message || body.text || "";
      if (t) process.stdout.write(t);
      else process.stdout.write("(no text in response)");
    } else {
      process.stdout.write("(empty stream — try another assistant in Settings)");
    }
  }
  process.stdout.write("\n");
}

async function readStdinPrompt(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function cmdAdvanced(args: string[]): Promise<void> {
  if (args.includes("--open")) {
    await savePrefs({ advancedOpen: true });
    print("Advanced section will open next time you load Lite.");
    const base = await findDaemon();
    if (base) {
      await startLiteServer({ daemonBaseUrl: base, openBrowser: true });
      await new Promise(() => {});
    }
    return;
  }
  print("Usage: armaraos-lite advanced --open");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rest = argv.slice(1);

  if (cmd === "-h" || cmd === "--help" || cmd === "help") {
    print(HELP);
    return;
  }

  // Bare flags like `armaraos-lite --classic` act as start.
  if (cmd?.startsWith("--")) {
    await cmdStart(argv);
    return;
  }

  if (!cmd || cmd === "start") {
    await cmdStart(cmd === "start" ? rest : argv);
    return;
  }
  if (cmd === "dashboard" || cmd === "dash" || cmd === "ui") {
    await cmdStart(rest);
    return;
  }
  if (cmd === "use" || cmd === "prefer") {
    await cmdUse(rest);
    return;
  }
  if (cmd === "status") {
    await cmdStatus();
    return;
  }
  if (cmd === "chat") {
    await cmdChat(rest);
    return;
  }
  if (cmd === "advanced") {
    await cmdAdvanced(rest);
    return;
  }
  fail(`Unknown command: ${cmd}`, "Run armaraos-lite --help");
}

main().catch((e) => {
  fail(e instanceof Error ? e.message : String(e));
});
