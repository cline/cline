---
title: "Build Remote Agent"
sidebarTitle: "Build Remote Agent"
description: "Pair a phone running Build Remote Agent to spectate a Cline desktop session (gbr/1)."
---

# Pair a phone with Build Remote Agent

Cline can use **Build Remote Agent** as a pairing device: the paid iOS/Android
app spectates (and can inject into) this desktop agent through the free MIT
`gbr-agent`. Phone and PC never open ports to each other.

Website: https://grokbuildremote.com/
Agent: https://github.com/LinespottingOrg/GrokBuildRemote-Agents (MIT)
Protocol: `gbr/1` · need agent **v0.6.0+**

Independent product by Linespotting AB. Not affiliated with xAI or SpaceX.

This is **not** Cline Kanban remote access (`:3484` / Tailscale). Kanban stays
a web task board. Build Remote Agent is loopback Bot API + MCP only.

## Install + pair

```bash
# macOS / Linux
curl -fsSL https://grokbuildremote.com/install.sh | bash
gbr-agent version          # must print v0.6.0 or newer
gbr-agent pair             # QR in browser + printed 8-char code
gbr-agent run              # leave running
```

```powershell
# Windows
irm https://grokbuildremote.com/install.ps1 | iex
gbr-agent version
gbr-agent pair
gbr-agent run
```

Phone: open Build Remote Agent → **Scan QR from computer** (or type the 8-char
code). Sessions appear in the app. **Unpair** in Settings before changing PCs.
Force-close is not enough.

## MCP snippet

Add to `~/.cline/mcp.json` (CLI) or **Cline panel → MCP Servers → Configure**:

```json
{
  "mcpServers": {
    "gbr": {
      "command": "node",
      "args": [
        "GrokBuildRemote-Agents/mcp/gbr-mcp/bin/gbr-mcp.js"
      ],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Replace the path with your clone of
[GrokBuildRemote-Agents](https://github.com/LinespottingOrg/GrokBuildRemote-Agents).

```bash
git clone https://github.com/LinespottingOrg/GrokBuildRemote-Agents.git
cd GrokBuildRemote-Agents/mcp/gbr-mcp && npm install
node bin/gbr-mcp.js --diagnose
```

Or `cline mcp` → Add server → stdio → `node` + the `gbr-mcp.js` path above.

## Attach (only these)

| How | Where |
|-----|--------|
| Bot API | `http://127.0.0.1:8788` after `gbr-agent run` |
| MCP | `gbr-mcp` stdio (same JSON as Bot API) |

```bash
curl -sS http://127.0.0.1:8788/health
curl -sS http://127.0.0.1:8788/v1/sessions
```

Phone is spectator + veto. Orchestration stays in Cline.

Do not commit mailbox keys. Phone **Settings → Bot API** is the only place the
relay key is copied.

See [MCP](./mcp-overview) for the rest of Cline's MCP UI.
