import * as vscode from "vscode"

export type PythonExecutionMode = "prompt" | "always" | "never"

export type PythonExecutionPrompt = "manage-workspace-trust" | "python-execution"

export interface PythonExecutionPermissionInput {
	workspaceTrusted: boolean
	mode: PythonExecutionMode
	workspaceKey: string
	approvedWorkspaceKeys: Set<string>
	requestDecision: (prompt: PythonExecutionPrompt) => Promise<boolean>
}

/** In-memory approval per workspace folder (resets when VS Code restarts). */
const approvedWorkspaceKeys = new Set<string>()

function workspaceApprovalKey(): string {
	const folder = vscode.workspace.workspaceFolders?.[0]
	return folder?.uri.toString() ?? "__no_workspace__"
}

/**
 * Deterministic policy core used by the VS Code adapter below. The injected
 * prompt makes allow and deny behavior executable-testable without automating
 * a native modal, while the production wrapper still owns the real UI.
 */
export async function resolvePythonExecutionPermission(input: PythonExecutionPermissionInput): Promise<boolean> {
	if (!input.workspaceTrusted) {
		await input.requestDecision("manage-workspace-trust")
		return false
	}
	if (input.mode === "never") {
		return false
	}
	if (input.mode === "always") {
		return true
	}
	if (input.approvedWorkspaceKeys.has(input.workspaceKey)) {
		return true
	}

	const allowed = await input.requestDecision("python-execution")
	if (allowed) {
		input.approvedWorkspaceKeys.add(input.workspaceKey)
	}
	return allowed
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
	return resolvePythonExecutionPermission({
		workspaceTrusted: vscode.workspace.isTrusted,
		mode: getPythonExecutionMode(),
		workspaceKey: workspaceApprovalKey(),
		approvedWorkspaceKeys,
		requestDecision: async (prompt) => {
			if (prompt === "manage-workspace-trust") {
				// Do not hold the kernel RPC open on a native modal. The preview
				// already shows Restricted Mode; return the visible denial now and
				// offer trust management asynchronously.
				void vscode.window
					.showWarningMessage(
						"This workspace is not trusted. Trust the workspace to run Python in HTML Preview.",
						"Manage Workspace Trust",
					)
					.then((choice) => {
						if (choice === "Manage Workspace Trust") {
							void vscode.commands.executeCommand("workbench.trust.manage")
						}
					})
				return false
			}

			const choice = await vscode.window.showWarningMessage(
				"AI-Hydro HTML Preview wants to run Python code on your machine (same trust level as terminal commands). Allow for this workspace?",
				{ modal: true },
				"Allow",
				"Deny",
			)
			return choice === "Allow"
		},
	})
}
