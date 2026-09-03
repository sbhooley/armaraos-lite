import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { liteHome } from "./daemon.ts";

export type DashboardChoice = "lite" | "classic";

export interface LitePrefs {
  setupComplete: boolean;
  defaultAssistantId: string | null;
  lastPage: string;
  advancedOpen: boolean;
  homeHeadOpen: boolean;
  statusOpen: boolean;
  /** Which dashboard `armaraos-lite` / `start` opens. null = ask when interactive. */
  preferredDashboard: DashboardChoice | null;
  /** Last daemon session id per assistant — same stickiness as the full dashboard. */
  sessionByAgent: Record<string, string>;
  /** Last timezone chosen for a new automation. null = this device. */
  cronTimeZone: string | null;
}

const DEFAULTS: LitePrefs = {
  setupComplete: false,
  defaultAssistantId: null,
  lastPage: "home",
  advancedOpen: false,
  homeHeadOpen: true,
  statusOpen: true,
  preferredDashboard: null,
  sessionByAgent: {},
  hideSystemJobs: true,
  cronTimeZone: null,
};

function prefsPath(): string {
  return join(liteHome(), "prefs.json");
}

export async function loadPrefs(): Promise<LitePrefs> {
  try {
    const raw = await readFile(prefsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<LitePrefs>;
    return {
      ...DEFAULTS,
      ...parsed,
      sessionByAgent: {
        ...DEFAULTS.sessionByAgent,
        ...(parsed.sessionByAgent && typeof parsed.sessionByAgent === "object"
          ? parsed.sessionByAgent
          : {}),
      },
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function savePrefs(partial: Partial<LitePrefs>): Promise<LitePrefs> {
  const current = await loadPrefs();
  const next: LitePrefs = {
    ...current,
    ...partial,
    sessionByAgent: {
      ...current.sessionByAgent,
      ...(partial.sessionByAgent && typeof partial.sessionByAgent === "object"
        ? partial.sessionByAgent
        : {}),
    },
  };
  await mkdir(liteHome(), { recursive: true });
  await writeFile(prefsPath(), JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}
