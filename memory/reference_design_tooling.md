---
name: reference-design-tooling
description: "User-level tooling installed on the XPS 13: Playwright MCP (driving the dev site headless) + Taste (12 design-reference skills) + Impeccable (polish/critique/craft framework). Install commands recorded so the home PC can mirror them."
metadata:
  node_type: memory
  type: reference
---

Installed 2026-05-21 on the XPS 13. These are **user-machine state**, not in the repo — every new dev machine needs to install them separately.

## Install commands (run once per machine)

```powershell
# Playwright MCP — adds browser_navigate / browser_snapshot / browser_click tools
npm install -g @playwright/mcp@latest
# Then edit ~/.claude.json: add mcpServers.playwright pointing node.exe at the global cli.js
# Exact entry on XPS:
#   "command": "C:\\Program Files\\nodejs\\node.exe",
#   "args": ["C:\\Users\\Colin\\AppData\\Roaming\\npm\\node_modules\\@playwright\\mcp\\cli.js"]
# Adjust paths for the new machine's Node install location.

# Taste — 12 design-reference skills (brandkit, design-taste-frontend, high-end-visual-design, etc.)
npx -y skills add Leonxlnx/taste-skill --global

# Impeccable — polish / critique / craft / shape framework with PRODUCT.md context loader
npx -y skills add pbakaus/impeccable --global
```

Skills land at `~/.agents/skills/<skill-name>/` and are symlinked into Claude Code's skill resolution path.

## Windows gotchas discovered during XPS install

- `claude` CLI doesn't exist in the VSCode-extension version of Claude Code — `claude mcp add` won't work. Edit `~/.claude.json` directly.
- `npx.cmd` is a batch file that calls `node`. If `node` isn't on the MCP server's spawn PATH, the spawn fails silently. **Fix:** point the MCP `command` at `node.exe` with the absolute path to the package's `cli.js`. No PATH lookups, no `.cmd` indirection.
- `npx skills add …` needs git on PATH; otherwise the underlying `git clone` fails with `spawn git ENOENT`.

## What each tool unlocks

- **Playwright MCP** — drive `localhost:3000` headless, take screenshots, read DOM, capture console errors and network requests. Useful for verifying UI changes during polish.
- **Taste** — reference patterns and design-language libraries the agent can consult mid-design (brandkit, minimalist-ui, high-end-visual-design, etc.). Not user-invocable; they show up as available skills the agent picks up automatically.
- **Impeccable** — structured design workflow. Sub-commands: `polish`, `critique`, `craft`, `shape`, `teach`, `document`, `audit`, `bolder`, `quieter`, `distill`, `harden`, `clarify`, `adapt`, `optimize`, `animate`, `colorize`, `typeset`, `layout`, `delight`, `overdrive`, `live`, `extract`, `onboard`. Each loads its own reference methodology before acting.

Related: [[project-design-system-docs]]
