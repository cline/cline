import * as vscode from "vscode"

export type PythonExecutionMode = "prompt" | "always" | "never"

/** In-memory approval per workspace folder (resets when VS Code restarts). */
const approvedWorkspaceKeys = new Set<string>()

function workspaceApprovalKey(): string {
	const folder = vscode.workspace.workspaceFolders?.[0]
	return folder?.uri.toString() ?? "__no_workspace__"
}

export function getPythonExecutionMode(): PythonExecutionMode {
	const value = vscode.workspace.getConfiguration("aihydro.htmlPreview").get<string>("pythonExecution", "prompt")
	if (value === "always" || value === "never") {
		return value
	}
	return "prompt"
}

export function isWorkspaceTrustedForPython(): boolean {
	return vscode.workspace.isTrusted
}

export async function ensurePythonExecutionAllowed(): Promise<boolean> {
	if (!vscode.workspace.isTrusted) {
		const choice = await vscode.window.showWarningMessage(
			"This workspace is not trusted. Trust the workspace to run Python in HTML Preview.",
			{ modal: true },
			"Manage Workspace Trust",
		)
		if (choice === "Manage Workspace Trust") {
			await vscode.commands.executeCommand("workbench.trust.manage")
		}
		return false
	}

	const mode = getPythonExecutionMode()
	if (mode === "never") {
		return false
	}
	if (mode === "always") {
		return true
	}

	const key = workspaceApprovalKey()
	if (approvedWorkspaceKeys.has(key)) {
		return true
	}

	const choice = await vscode.window.showWarningMessage(
		"AI-Hydro HTML Preview wants to run Python code on your machine (same trust level as terminal commands). Allow for this workspace?",
		{ modal: true },
		"Allow",
		"Deny",
	)
	if (choice === "Allow") {
		approvedWorkspaceKeys.add(key)
		return true
	}
	return false
}
