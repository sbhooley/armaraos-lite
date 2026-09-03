# ArmaraOS Lite

> ArmaraOS is a personal AI workspace where assistants can chat with you, complete tasks and run automations on your behalf.

**ArmaraOS Lite** is the consumer workspace for a running [ArmaraOS](https://armaraos.com/download) daemon. The CLI ships it at `/lite/`; this repo is the UI source used to update that embed.

## Why Lite exists

The full ArmaraOS dashboard exposes graph memory, missions, trajectories, failures, proposals, orchestration, MCP, runtime, logs, and channels all at once — useful for operators, heavy for everyday use.

Lite keeps the main experience simple:

1. Tell an assistant what you want done  
2. Watch it work  
3. Approve anything important  

Primary navigation: **Home · Assistants · Automations · Activity · Settings**. Technical tools live under **Advanced**.

## Requirements

- A running ArmaraOS daemon (`armaraos start` / the public installer)
- Node.js 22+ only if you run this repo’s sidecar (`armaraos-lite`) for local UI work

## Install & run

Lite is included in the ArmaraOS CLI. After the public installer, the daemon serves it at **`/lite/`** — no separate Node install:

```bash
# macOS / Linux / WSL
curl -sSfL https://ainativelang.com/install.sh | sh
armaraos dashboard            # http://127.0.0.1:4200/lite/
armaraos dashboard --classic  # full operator UI at /
```

This repo is the UI source. For local iteration without rebuilding the CLI:

```bash
# 1. ArmaraOS daemon (already running from `armaraos start`)
# 2. Node 22+ sidecar on :4210
git clone https://github.com/sbhooley/armaraos-lite.git
cd armaraos-lite
npm install
npm link
armaraos-lite --lite
```

Copy a new UI into the CLI crate before a daemon release: `scripts/sync-lite-ui.sh` in [sbhooley/armara](https://github.com/sbhooley/armara).

The sidecar still opens **http://127.0.0.1:4210** (proxies `/api` to the daemon) for local UI work. Production users use `armaraos dashboard` instead.

### Choose a dashboard

```bash
armaraos-lite --lite          # new consumer workspace
armaraos-lite --classic       # classic full dashboard
armaraos-lite --choose        # interactive 1/2 prompt
armaraos-lite use lite        # save default
armaraos-lite use classic     # save default
armaraos-lite use clear       # ask again next time
```

If no preference is saved and you’re in a terminal, `armaraos-lite` asks which dashboard to open.

### Commands

| Command | What it does |
|---------|----------------|
| `armaraos-lite` / `start` / `dashboard` | Open preferred (or flagged) dashboard |
| `armaraos-lite use lite\|classic\|clear` | Save / clear dashboard preference |
| `armaraos-lite status` | Daemon reachable? Prefs? |
| `armaraos-lite chat "…"` | One-shot terminal chat with default assistant |
| `armaraos-lite advanced --open` | Open Lite with Advanced expanded |

Flags: `--lite`, `--classic` / `--old`, `--choose`, `--remember`, `--port N`, `--no-open`.

## Setup (3 steps)

1. **Provider** — Armara, OpenRouter, OpenAI, or Anthropic  
2. **Assistant** — Armara / Code Helper / Researcher / Writer  
3. **First request** — land on Home and send a prompt  

## Data

| Path | Owner |
|------|--------|
| `~/.armaraos/` | Daemon (keys, agents, chats, cron) |
| `~/.armaraos-lite/prefs.json` | Lite UI prefs only |

## Out of scope (v1)

No new kernel, no edits to the original CLI/dashboard, no Tauri desktop, no full re-skin of operator surfaces.
