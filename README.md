# ArmaraOS Lite

> ArmaraOS is a personal AI workspace where assistants can chat with you, complete tasks and run automations on your behalf.

**ArmaraOS Lite** is a lighter consumer shell over a running [ArmaraOS](https://armaraos.com/download) daemon. It does **not** replace `armaraos` / `armaraos-cli`, and it does not modify those repos.

## Why Lite exists

The full ArmaraOS dashboard exposes graph memory, missions, trajectories, failures, proposals, orchestration, MCP, runtime, logs, and channels all at once — useful for operators, heavy for everyday use.

Lite keeps the main experience simple:

1. Tell an assistant what you want done  
2. Watch it work  
3. Approve anything important  

Primary navigation: **Home · Assistants · Automations · Activity · Settings**. Technical tools live under **Advanced**.

## Requirements

- Node.js 22+
- A running ArmaraOS daemon (`armaraos start`), discovered via `~/.armaraos/daemon.json`

## Install & run

Lite sits on top of the same ArmaraOS CLI users already install from [armaraos.com/download](https://armaraos.com/download). It does not ship inside that installer yet.

**1. Install and start ArmaraOS**

```bash
# macOS / Linux / WSL
curl -sSfL https://ainativelang.com/install.sh | sh
armaraos start

# Windows (PowerShell)
# irm https://ainativelang.com/install.ps1 | iex
```

**2. Install Lite from this repo** (Node.js 22+)

```bash
git clone https://github.com/sbhooley/armaraos-lite.git
cd armaraos-lite
npm install
npm link          # optional — puts armaraos-lite on your PATH
armaraos-lite     # or: npm start
```

By default opens the **Lite** workspace at **http://127.0.0.1:4210** (proxies `/api` to the daemon). You can also open the **classic** operator dashboard on the daemon URL.

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
