import http from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import httpProxy from "http-proxy";
import { loadPrefs, savePrefs } from "./prefs.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(__dirname, "../web");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

export const DEFAULT_LITE_PORT = 4210;

export interface ServerOptions {
  daemonBaseUrl: string;
  port?: number;
  openBrowser?: boolean;
}

function daemonTarget(daemonBaseUrl: string): { host: string; port: number; protocol: string } {
  const u = new URL(daemonBaseUrl);
  return {
    host: u.hostname,
    port: Number(u.port || (u.protocol === "https:" ? 443 : 80)),
    protocol: u.protocol,
  };
}

function contentType(filePath: string): string {
  return MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  let urlPath = (req.url || "/").split("?")[0] || "/";
  if (urlPath === "/lite" || urlPath === "/lite/") urlPath = "/index.html";
  else if (urlPath.startsWith("/lite/")) urlPath = urlPath.slice("/lite".length) || "/index.html";
  if (urlPath === "/") urlPath = "/index.html";
  if (urlPath.includes("..")) {
    res.writeHead(400).end("Bad path");
    return true;
  }
  const filePath = join(WEB_ROOT, urlPath);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    // SPA fallback
    const index = join(WEB_ROOT, "index.html");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    createReadStream(index).pipe(res);
    return true;
  }
  res.writeHead(200, { "Content-Type": contentType(filePath) });
  createReadStream(filePath).pipe(res);
  return true;
}

async function handleLiteApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  daemonBaseUrl: string,
): Promise<boolean> {
  const url = new URL(req.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/lite/")) return false;

  res.setHeader("Content-Type", "application/json");

  if (url.pathname === "/lite/meta" && req.method === "GET") {
    const prefs = await loadPrefs();
    res.end(
      JSON.stringify({
        product: "ArmaraOS Lite",
        tagline:
          "A personal AI workspace where assistants can chat with you, complete tasks and run automations on your behalf.",
        daemonBaseUrl,
        prefs,
      }),
    );
    return true;
  }

  if (url.pathname === "/lite/prefs" && req.method === "GET") {
    res.end(JSON.stringify(await loadPrefs()));
    return true;
  }

  if (url.pathname === "/lite/prefs" && req.method === "PUT") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const prefs = await savePrefs(body);
    res.end(JSON.stringify(prefs));
    return true;
  }

  res.writeHead(404).end(JSON.stringify({ error: "not found" }));
  return true;
}

export async function startLiteServer(opts: ServerOptions): Promise<{ port: number; url: string }> {
  const port = opts.port ?? DEFAULT_LITE_PORT;
  const target = daemonTarget(opts.daemonBaseUrl);
  const proxy = httpProxy.createProxyServer({
    target: {
      host: target.host,
      port: target.port,
      protocol: target.protocol,
    },
    changeOrigin: true,
    ws: true,
    xfwd: true,
  });

  proxy.on("error", (err, _req, res) => {
    const msg = `Daemon proxy error: ${err.message}`;
    process.stderr.write(`${msg}\n`);
    try {
      const r = res as http.ServerResponse | undefined;
      if (r && typeof r.writeHead === "function" && !r.headersSent && !r.writableEnded) {
        r.writeHead(502, { "Content-Type": "application/json" });
        r.end(
          JSON.stringify({
            error: msg,
            hint: "Is the ArmaraOS daemon still running? Try: armaraos start",
          }),
        );
      } else if (r && typeof r.destroy === "function") {
        r.destroy();
      }
    } catch {
      /* client already gone — never crash the Lite process */
    }
  });

  const server = http.createServer(async (req, res) => {
    try {
      if (await handleLiteApi(req, res, opts.daemonBaseUrl)) return;

      const path = (req.url || "").split("?")[0] || "";
      if (path.startsWith("/api/") || path.startsWith("/uploads/")) {
        proxy.web(req, res);
        return;
      }
      serveStatic(req, res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: msg }));
    }
  });

  server.on("upgrade", (req, socket, head) => {
    const path = (req.url || "").split("?")[0] || "";
    if (path.startsWith("/api/")) {
      proxy.ws(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onListenError = (err: Error) => reject(err);
    server.once("error", onListenError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onListenError);
      server.on("error", (err) => {
        process.stderr.write(`Lite server error: ${err instanceof Error ? err.message : String(err)}\n`);
      });
      resolve();
    });
  });

  const url = `http://127.0.0.1:${port}`;
  if (opts.openBrowser !== false) {
    openInBrowser(url);
  }
  return { port, url };
}

export function openInBrowser(url: string): void {
  const platform = process.platform;
  try {
    if (platform === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    else if (platform === "win32") spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
    else spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    /* ignore */
  }
}
