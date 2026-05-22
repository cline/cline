import { execSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import * as vscode from "vscode"
import { buildKernelProfile, type KernelProfile } from "./KernelProfile"

function venvPythonPath(venvDir: string): string | null {
	const unix = path.join(venvDir, "bin", "python")
	if (fs.existsSync(unix)) {
		return unix
	}
	const win = path.join(venvDir, "Scripts", "python.exe")
	if (fs.existsSync(win)) {
		return win
	}
	return null
}

async function tryPythonExtensionInterpreter(): Promise<string | null> {
	try {
		const ext = vscode.extensions.getExtension("ms-python.python")
		if (!ext?.isActive) {
			await ext?.activate()
		}
		const result = await vscode.commands.executeCommand<string>("python.interpreterPath")
		if (typeof result === "string" && result.trim()) {
			return path.resolve(result.trim())
		}
	} catch {
		// Python extension not installed or command unavailable
	}
	return null
}

function pathOnPath(candidates: string[]): string | null {
	for (const candidate of candidates) {
		try {
			const resolved = execSync(`command -v ${candidate}`, { encoding: "utf8" }).trim()
			if (resolved) {
				return resolved
			}
		} catch {
			// try next
		}
	}
	return null
}

export function getWorkspaceFolderPath(): string | null {
	const folder = vscode.workspace.workspaceFolders?.[0]
	return folder?.uri.fsPath ?? null
}

export function getWorkspaceKey(): string {
	const folder = vscode.workspace.workspaceFolders?.[0]
	return folder?.uri.toString() ?? "__no_workspace__"
}

/**
 * Discover ranked Python environments for HTML Preview kernels.
 */
export async function discoverPythonEnvironments(): Promise<KernelProfile[]> {
	const workspaceFolder = getWorkspaceFolderPath()
	const workspaceKey = getWorkspaceKey()
	if (!workspaceFolder) {
		const fallback = pathOnPath(["python3", "python"])
		if (!fallback) {
			return []
		}
		return [
			buildKernelProfile({
				workspaceKey,
				workspaceFolder: process.cwd(),
				interpreterPath: fallback,
				label: `PATH: ${path.basename(fallback)}`,
				source: "path",
			}),
		]
	}

	const profiles: KernelProfile[] = []
	const seen = new Set<string>()

	const add = (interpreterPath: string, label: string, source: KernelProfile["source"], env?: Record<string, string>) => {
		const resolved = path.resolve(interpreterPath)
		if (seen.has(resolved)) {
			return
		}
		if (!fs.existsSync(resolved)) {
			return
		}
		seen.add(resolved)
		profiles.push(
			buildKernelProfile({
				workspaceKey,
				workspaceFolder,
				interpreterPath: resolved,
				label,
				source,
				env,
			}),
		)
	}

	// 1. User override
	const override = vscode.workspace.getConfiguration("aihydro.htmlPreview").get<string>("pythonInterpreter")
	if (override?.trim()) {
		add(override.trim(), `Custom: ${path.basename(override.trim())}`, "custom")
	}

	// 2. VS Code Python extension + setting
	const fromExtension = await tryPythonExtensionInterpreter()
	if (fromExtension) {
		add(fromExtension, `VS Code: ${path.basename(fromExtension)}`, "vscode")
	}
	const configured = vscode.workspace.getConfiguration("python").get<string>("defaultInterpreterPath")
	if (configured?.trim()) {
		add(configured.trim(), `Settings: ${path.basename(configured.trim())}`, "vscode")
	}

	// 3. Workspace .venv
	const workspaceVenv = venvPythonPath(path.join(workspaceFolder, ".venv"))
	if (workspaceVenv) {
		add(workspaceVenv, "Workspace .venv", "workspace_venv", { VIRTUAL_ENV: path.join(workspaceFolder, ".venv") })
	}

	// 4. Agent-created .aihydro/venv
	const aihydroVenv = venvPythonPath(path.join(workspaceFolder, ".aihydro", "venv"))
	if (aihydroVenv) {
		add(aihydroVenv, "AI-Hydro .aihydro/venv", "aihydro_venv", {
			VIRTUAL_ENV: path.join(workspaceFolder, ".aihydro", "venv"),
		})
	}

	// 5. PATH fallback
	const fallback = pathOnPath(["python3", "python"])
	if (fallback) {
		add(fallback, `PATH: ${path.basename(fallback)}`, "path")
	}

	return profiles
}

export async function resolveDefaultProfile(): Promise<KernelProfile | null> {
	const envs = await discoverPythonEnvironments()
	if (envs.length === 0) {
		return null
	}
	// Prefer aihydro venv > workspace venv > vscode > custom > path
	const rank: Record<KernelProfile["source"], number> = {
		aihydro_venv: 0,
		workspace_venv: 1,
		vscode: 2,
		custom: 3,
		path: 4,
	}
	return [...envs].sort((a, b) => rank[a.source] - rank[b.source])[0] ?? null
}
