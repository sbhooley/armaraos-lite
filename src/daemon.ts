import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

export interface DaemonInfo {
  pid: number;
  listen_addr: string;
  started_at: string;
  version: string;
  platform: string;
}

export function armaraosHome(): string {
  return process.env.ARMARAOS_HOME || process.env.OPENFANG_HOME || join(homedir(), ".armaraos");
}

export function liteHome(): string {
  return process.env.ARMARAOS_LITE_HOME || join(homedir(), ".armaraos-lite");
}

export async function readDaemonInfo(): Promise<DaemonInfo | null> {
  try {
    const raw = await readFile(join(armaraosHome(), "daemon.json"), "utf8");
    return JSON.parse(raw) as DaemonInfo;
  } catch {
    return null;
  }
}

/** Normalize listen address and return base URL if /api/health succeeds. */
export async function findDaemon(): Promise<string | null> {
  const info = await readDaemonInfo();
  if (!info?.listen_addr) return null;

  const addr = info.listen_addr.replace("0.0.0.0", "127.0.0.1");
  const base = `http://${addr}`;

  try {
    const ctrl = AbortSignal.timeout(2000);
    const res = await fetch(`${base}/api/health`, { signal: ctrl });
    if (res.ok) return base;
  } catch {
    /* unreachable */
  }
  return null;
}

export async function daemonHealth(baseUrl: string): Promise<{ ok: boolean; version?: string }> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { ok: false };
    const body = (await res.json()) as { version?: string };
    return { ok: true, version: body.version };
  } catch {
    return { ok: false };
  }
}
