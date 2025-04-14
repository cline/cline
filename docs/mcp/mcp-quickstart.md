# 🚀 MCP Quickstart Guide

## ❓ What's an MCP Server?

Think of MCP servers as special helpers that give Cline extra powers! They let Cline do cool things like fetch web pages or work with your files.

## ⚠️ IMPORTANT: System Requirements

STOP! Before proceeding, you MUST verify these requirements:

### Required Software

-   ✅ Latest Node.js (v18 or newer)

    -   Check by running: `node --version`
    -   Install from: <https://nodejs.org/>

-   ✅ Latest Python (v3.8 or newer)

    -   Check by running: `python --version`
    -   Install from: <https://python.org/>

-   ✅ UV Package Manager
    -   After installing Python, run: `pip install uv`
    -   Verify with: `uv --version`

❗ If any of these commands fail or show older versions, please install/update before continuing!

⚠️ If you run into other errors, see the "Troubleshooting" section below.

## 🎯 Quick Steps (Only After Requirements Are Met!)

### 1. 🛠️ Install Your First MCP Server

1. From the Cline extension, click the `MCP Server` tab
1. Click the `Edit MCP Settings` button

 <img src="https://github.com/user-attachments/assets/abf908b1-be98-4894-8dc7-ef3d27943a47" alt="MCP Server Panel" width="400" />

1. The MCP settings files should be display in a tab in VS Code.
1. Replace the file's contents with this code:

For Windows:

```json
{
	"mcpServers": {
		"mcp-installer": {
			"command": "cmd.exe",
			"args": ["/c", "npx", "-y", "@anaisbetts/mcp-installer"]
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
			"args": ["@anaisbetts/mcp-installer"]
		}
	}
}
```

After saving the file:

1. Cline will detect the change automatically
2. The MCP installer will be downloaded and installed
3. Cline will start the MCP installer
4. You'll see the server status in Cline's MCP settings UI:

<img src="https://github.com/user-attachments/assets/2abbb3de-e902-4ec2-a5e5-9418ed34684e" alt="MCP Server Panel with Installer" width="400" />

## 🤔 What Next?

Now that you have the MCP installer, you can ask Cline to add more servers from:

1. NPM Registry: <https://www.npmjs.com/search?q=%40modelcontextprotocol>
2. Python Package Index: <https://pypi.org/search/?q=mcp+server-&o=>

For example, you can ask Cline to install the `mcp-server-fetch` package found on the Python Package Index:

```bash
"install the MCP server named `mcp-server-fetch`
- ensure the mcp settings are updated.
- use uvx or python to run the server."
```

You should witness Cline:

1. Install the `mcp-server-fetch` python package
1. Update the mcp setting json file
1. Start the server and start the server

The mcp settings file should now look like this:

_For a Windows machine:_

```json
{
	"mcpServers": {
		"mcp-installer": {
			"command": "cmd.exe",
			"args": ["/c", "npx", "-y", "@anaisbetts/mcp-installer"]
		},
		"mcp-server-fetch": {
			"command": "uvx",
			"args": ["mcp-server-fetch"]
		}
	}
}
```

You you can always check the status of your server by going to clients MCP server tab. See the image above

That's it! 🎉 You've just given Cline some awesome new abilities!

## 📝 Troubleshooting

### 1. I'm Using `asdf` and Get "unknown command: npx"

There is some slightly bad news. You should still be able to get things to work, but will have to do a bit more manual work unless MCP server packaging evolves a bit. One option is to uninstall `asdf` , but we will assume you do not want to do that.

Instead, you will need to follow the instructions above to "Edit MCP Settings". Then, as [this post](https://dev.to/cojiroooo/mcp-using-node-on-asdf-382n) describes, you need to add and "env" entry to each server's configs.

```json
"env": {
        "PATH": "/Users/<user_name>/.asdf/shims:/usr/bin:/bin",
        "ASDF_DIR": "<path_to_asdf_bin_dir>",
        "ASDF_DATA_DIR": "/Users/<user_name>/.asdf",
        "ASDF_NODEJS_VERSION": "<your_node_version>"
      }
```

The `path_to_asdf_bin_dir` can often be found in your shell config (e.g. `.zshrc`). If you are using Homebrew, you can use `echo ${HOMEBREW_PREFIX}` to find the start of the directory and then append `/opt/asdf/libexec`.

Now for some good news. While not perfect, you can get Cline to do this for you fairly reliably for subsequent server install. Add the following to your "Custom Instructions" in the Cline settings (top-right toolbar button):

> When installing MCP servers and editing the cline_mcp_settings.json, if the server requires use of `npx` as the command, you must copy the "env" entry from the "mcp-installer" entry and add it to the new entry. This is vital to getting the server to work properly when in use.

### 2. I'm Still Getting an Error When I Run the MCP Installer

If you're getting an error when you run the MCP installer, you can try the following:

-   Check the MCP settings file for errors
-   Read the MCP server's documentation to ensure the MCP setting file is using the correct command and arguments. 👈
-   Use a terminal and run the command with its arguments directly. This will allow you to see the same errors that Cline is seeing.
