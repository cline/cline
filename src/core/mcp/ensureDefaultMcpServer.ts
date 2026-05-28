import { ensureSettingsDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { execa } from "@packages/execa"
import { ShowMessageType } from "@shared/proto/host/window"
import { ExecuteCommandInTerminalRequest } from "@shared/proto/host/workspace"
import { fileExistsAtPath } from "@utils/fs"
import * as fs from "fs/promises"
import os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"

const SERVER_NAME = "ai-hydro"
const CACHE_DIR = path.join(os.homedir(), ".aihydro", "cache")
const ACTIVE_WORKSPACE_FILE = path.join(os.homedir(), ".aihydro", "active_workspace.json")
const PIP_COMMAND = "pip install aihydro-tools"

/**
 * Write the current VS Code workspace root to ~/.aihydro/active_workspace.json.
 *
 * The Python MCP server reads this file in _maybe_set_workspace() so that
 * session.workspace_dir is populated even without per-call _workspace injection.
 * Called on activation and whenever workspace folders change.
 */
async function writeActiveWorkspace(): Promise<void> {
	try {
		// Use HostProvider abstraction to satisfy the no-direct-vscode lint rule.
		const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
		const primaryPath = workspacePaths.paths?.[0]
		if (!primaryPath) {
			return
		}
		const content = JSON.stringify({ workspace: primaryPath, updated_at: new Date().toISOString() }, null, 2)
		await fs.mkdir(path.dirname(ACTIVE_WORKSPACE_FILE), { recursive: true })
		await fs.writeFile(ACTIVE_WORKSPACE_FILE, content, "utf-8")
	} catch {
		// Non-fatal — MCP per-call injection is still the primary path
	}
}

/**
 * Write the active workspace on extension activation and keep it updated
 * whenever workspace folders change.  Returns a disposable to push onto
 * context.subscriptions.
 */
export async function setupActiveWorkspaceTracking(context: vscode.ExtensionContext): Promise<void> {
	await writeActiveWorkspace()
	context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => writeActiveWorkspace()))
}

/**
 * Return candidate paths where pip may have installed `aihydro-mcp`.
 * Checked when `which`/`where` fails (common for user-level pip installs).
 */
function getPipScriptCandidates(): string[] {
	const home = os.homedir()
	const candidates: string[] = []

	if (process.platform === "win32") {
		// User-level: %APPDATA%\Python\Python3XX\Scripts
		const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming")
		const pythonDir = path.join(appData, "Python")
		// Check common Python versions (3.9 through 3.13)
		for (const ver of ["39", "310", "311", "312", "313"]) {
			candidates.push(path.join(pythonDir, `Python${ver}`, "Scripts", "aihydro-mcp.exe"))
		}
		// System-level: C:\PythonXX\Scripts  or  C:\Program Files\PythonXX\Scripts
		for (const ver of ["39", "310", "311", "312", "313"]) {
			candidates.push(path.join("C:", `Python${ver}`, "Scripts", "aihydro-mcp.exe"))
		}
	} else {
		// macOS / Linux user-level
		candidates.push(path.join(home, ".local", "bin", "aihydro-mcp"))
		// Homebrew / system Python
		candidates.push("/usr/local/bin/aihydro-mcp")
		candidates.push("/opt/homebrew/bin/aihydro-mcp")
		// Conda default
		candidates.push(path.join(home, "miniconda3", "bin", "aihydro-mcp"))
		candidates.push(path.join(home, "anaconda3", "bin", "aihydro-mcp"))
		candidates.push("/opt/miniconda3/bin/aihydro-mcp")
	}

	return candidates
}

/**
 * Auto-detect and register the `aihydro-tools` MCP server on extension startup.
 *
 * Detection order:
 * 1. `which`/`where` aihydro-mcp (PATH lookup)
 * 2. Common pip install locations (user-level, system-level, conda)
 * 3. `python -m ai_hydro.mcp` probe (universal fallback)
 * 4. If not found → one-time install notification
 *
 * This runs once at activation, before McpHub reads the settings file.
 */
export async function ensureDefaultMcpServer(context: vscode.ExtensionContext): Promise<void> {
	try {
		// 1. Read current MCP settings
		const settingsDir = await ensureSettingsDirectoryExists()
		const settingsPath = path.join(settingsDir, GlobalFileNames.mcpSettings)

		let config: { mcpServers: Record<string, unknown> } = { mcpServers: {} }
		if (await fileExistsAtPath(settingsPath)) {
			try {
				config = JSON.parse(await fs.readFile(settingsPath, "utf-8"))
			} catch {
				// Malformed JSON — McpHub will handle the error later
				return
			}
		}

		if (!config.mcpServers) {
			config.mcpServers = {}
		}

		// 2. Skip if already registered
		if (config.mcpServers[SERVER_NAME]) {
			return
		}

		// 3. Detect aihydro-mcp: first try PATH, then common pip locations
		let mcpPath: string | undefined

		// 3a. PATH lookup
		const whichCmd = process.platform === "win32" ? "where" : "which"
		try {
			const result = await execa(whichCmd, ["aihydro-mcp"])
			mcpPath = result.stdout?.trim()
		} catch {
			// Not on PATH — fall through to candidate search
		}

		// 3b. Check common pip install directories
		if (!mcpPath) {
			for (const candidate of getPipScriptCandidates()) {
				if (await fileExistsAtPath(candidate)) {
					mcpPath = candidate
					console.log(`[AI-Hydro] Found aihydro-mcp at: ${candidate} (not on PATH)`)
					break
				}
			}
		}

		// 3c. Try `python -m ai_hydro.mcp` as universal fallback
		let pythonModuleFallback = false
		if (!mcpPath) {
			const pythonCandidates = process.platform === "win32" ? ["python", "python3", "py"] : ["python3", "python"]

			for (const py of pythonCandidates) {
				try {
					// Probe: import the package to verify it's installed
					await execa(py, ["-c", "import ai_hydro.mcp"])
					mcpPath = py
					pythonModuleFallback = true
					console.log(`[AI-Hydro] Found ai_hydro.mcp via: ${py} -m ai_hydro.mcp`)
					break
				} catch {
					// This python doesn't have aihydro-tools — try next
				}
			}
		}

		// 3d. Not found anywhere — prompt user
		if (!mcpPath) {
			const dismissed = context.globalState.get<boolean>("aihydroToolsPromptDismissed")
			if (!dismissed) {
				showInstallNotification(context)
			}
			return
		}

		// 4. Register the default server
		await fs.mkdir(CACHE_DIR, { recursive: true })

		const serverConfig = pythonModuleFallback
			? {
					command: mcpPath,
					args: ["-m", "ai_hydro.mcp"],
					cwd: CACHE_DIR,
					timeout: 600,
					env: {
						TMPDIR: CACHE_DIR,
						TEMP: CACHE_DIR,
						TMP: CACHE_DIR,
					},
				}
			: {
					command: mcpPath,
					args: [],
					cwd: CACHE_DIR,
					timeout: 600,
					env: {
						TMPDIR: CACHE_DIR,
						TEMP: CACHE_DIR,
						TMP: CACHE_DIR,
					},
				}

		config.mcpServers[SERVER_NAME] = serverConfig

		await fs.writeFile(settingsPath, JSON.stringify(config, null, 2))
		console.log("[AI-Hydro] Auto-registered aihydro-tools MCP server")
	} catch (error) {
		// Non-fatal — user can still add manually via setup_mcp.py
		console.error("[AI-Hydro] Failed to auto-register MCP server:", error)
	}
}

/**
 * Show a notification prompting the user to install the aihydro-tools Python package.
 * Marked as dismissed after any button click so it only appears once.
 */
async function showInstallNotification(context: vscode.ExtensionContext): Promise<void> {
	try {
		const installNow = "Install Now"
		const copyCommand = "Copy Command"
		const dismiss = "Dismiss"

		const action = await HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message:
				"The aihydro-tools Python package is required for AI-Hydro to function. " +
				"Without it, hydrological tools (watershed delineation, streamflow analysis, modelling, etc.) " +
				"will not be available. Install it now to get started.",
			options: { items: [installNow, copyCommand, dismiss] },
		})

		if (action.selectedOption === installNow) {
			await HostProvider.workspace.executeCommandInTerminal(
				ExecuteCommandInTerminalRequest.create({
					command: PIP_COMMAND,
				}),
			)
		} else if (action.selectedOption === copyCommand) {
			await HostProvider.env.clipboardWriteText({ value: PIP_COMMAND })
			await HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: `Copied to clipboard: ${PIP_COMMAND}`,
				options: { items: [] },
			})
		}

		// Mark as dismissed regardless of choice — user saw the prompt
		await context.globalState.update("aihydroToolsPromptDismissed", true)
	} catch (error) {
		console.error("[AI-Hydro] Failed to show install notification:", error)
	}
}
