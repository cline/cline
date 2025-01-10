# 🚀 MCP Quickstart Guide

## ❓ What's an MCP Server?

Think of MCP servers as special helpers that give Cline extra powers! They let Cline do cool things like fetch web pages or work with your files.

## ⚠️ IMPORTANT: System Requirements

STOP! Before proceeding, you MUST verify these requirements:


### Required Software

- ✅ Latest Node.js (v18 or newer)
  - Check by running: `node --version`
  - Install from: <https://nodejs.org/>

- ✅ Latest Python (v3.8 or newer)
  - Check by running: `python --version`
  - Install from: <https://python.org/>

- ✅ UV Package Manager
  - After installing Python, run: `pip install uv`
  - Verify with: `uv --version`

❗ If any of these commands fail or show older versions, please install/update before continuing!

## 🎯 Quick Steps (Only After Requirements Are Met!)

### 1. 🛠️ Install Your First MCP Server

Open Cline's MCP settings and replace its contents with this code:

For Windows:

```json
{
  "mcpServers": {
      "mcp-installer": {
        "command": "cmd.exe",
        "args": [
          "/c",
          "npx",
          "-y",
          "@anaisbetts/mcp-installer"
        ]
      }
    }
}
```

For Mac and Linux:

```json
{
  "mcpServers": {
    "mcp-installer": {
      "command": "npx",
      "args": [
        "@anaisbetts/mcp-installer"
      ]
    }
  }
}
```

After saving the file:

1. Cline will detect the change automatically
2. The MCP installer will be downloaded and installed
3. Cline will start the MCP installer
4. You'll see the server status in Cline's MCP settings UI:

<img src="../assets/docs/cline-mcp-server-panel-mcp-installer.png" alt="MCP Server Panel with Installer" width="400" />


### 2. 🔄 Set Up with Cline

Now let's give Cline the power to work with your files! Ask Cline:

```bash
"install the MCP server named mcp-server-fetch"
```

### 4. ✅ Verify Everything Works

Ask Cline to test both servers:

```bash
"generate a status report of the mcp servers in the chat only."
```

That's it! 🎉 You've just given Cline some awesome new abilities!

Here's how your MCP server panel should look with all servers installed:

<img src="../assets/docs/cline-mcp-server-panel.png" alt="MCP Server Panel with All Servers" width="400" />


## 🤔 What Next?

Now that you have the MCP installer, you can ask Cline to add more servers from:

1. NPM Registry: <https://www.npmjs.com/search?q=%40modelcontextprotocol>
2. Python Package Index: <https://pypi.org/search/?q=mcp+server-&o=>

Try asking Cline to install any server you find! For example:

- "Fetch me the weather from weather.com"
- "List the files on my desktop"

Cline can do all this and more with MCP servers! 🌟
