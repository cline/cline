// RFC 0001 §3.1 — workspace status bar indicator.
//
// Lives in the VS Code host layer (like VscodeWebviewProvider) because it drives
// the `vscode` API directly; the biome vscode-api rule keeps that API out of
// src/core. Shows the resolved hierarchical workspace anchor and whether it
// inherits from a parent workspace, and exposes the hierarchy actions on click.
// Resolution itself lives in the SDK layer (workspace-hierarchy.ts).

import { basename } from "node:path"
import * as vscode from "vscode"
import {
	describeWorkspaceHierarchy,
	formatWorkspaceStatusBar,
	resolveWorkspaceHierarchyInfo,
	WORKSPACE_STATUS_BAR_COMMAND,
} from "@/sdk/workspace-hierarchy"
import { initializeWorkspaceLayout } from "@/sdk/workspace-scaffold"
import { Logger } from "@/shared/services/Logger"

type HierarchyAction = "view" | "initialize" | "openManifest"

const HIERARCHY_ACTIONS: Array<vscode.QuickPickItem & { action: HierarchyAction }> = [
	{ label: "$(list-tree) View Workspace Hierarchy", action: "view" },
	{ label: "$(new-folder) Create Local Sub-Cline Override", action: "initialize" },
	{ label: "$(json) Open .cline/workspace.json", action: "openManifest" },
]

const LOG_PREFIX = "[VscodeWorkspaceStatusBar]"

export class VscodeWorkspaceStatusBar implements vscode.Disposable {
	private readonly item: vscode.StatusBarItem
	private readonly disposables: vscode.Disposable[] = []

	static create(): VscodeWorkspaceStatusBar {
		return new VscodeWorkspaceStatusBar()
	}

	private constructor() {
		this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
		this.item.command = WORKSPACE_STATUS_BAR_COMMAND
		this.disposables.push(
			this.item,
			vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()),
			vscode.commands.registerCommand(WORKSPACE_STATUS_BAR_COMMAND, () => this.showHierarchyQuickPick()),
		)
		this.refresh()
	}

	/** Folder the indicator reports on; undefined when no folder is open. */
	private getWorkspaceFolderPath(): string | undefined {
		return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
	}

	/** Re-resolve and re-render; hidden when the window has no folder open. */
	refresh(): void {
		const targetPath = this.getWorkspaceFolderPath()
		if (!targetPath) {
			this.item.hide()
			return
		}
		try {
			const content = formatWorkspaceStatusBar(resolveWorkspaceHierarchyInfo(targetPath))
			this.item.text = content.text
			this.item.tooltip = new vscode.MarkdownString(content.tooltip)
			this.item.show()
		} catch (error) {
			Logger.warn(`${LOG_PREFIX} Failed to resolve the workspace hierarchy:`, error)
			this.item.hide()
		}
	}

	private async showHierarchyQuickPick(): Promise<void> {
		const targetPath = this.getWorkspaceFolderPath()
		if (!targetPath) {
			return
		}
		const info = resolveWorkspaceHierarchyInfo(targetPath)
		const picked = await vscode.window.showQuickPick(HIERARCHY_ACTIONS, {
			title: `Cline workspace: ${info.isInitialized ? basename(info.primaryRoot) : "not initialized"}`,
			placeHolder: info.primaryRoot,
		})

		switch (picked?.action) {
			case "view":
				await vscode.window.showInformationMessage(describeWorkspaceHierarchy(info).join("\n\n"), { modal: true })
				return
			case "initialize":
				this.initializeLocalWorkspace(targetPath)
				return
			case "openManifest":
				await this.openWorkspaceManifest(info.isInitialized ? info.primaryRoot : targetPath)
				return
			default:
				return
		}
	}

	/** Create `.cline/` in the open folder so it becomes its own (non-inheriting) root. */
	private initializeLocalWorkspace(targetPath: string): void {
		try {
			initializeWorkspaceLayout({ targetDir: targetPath })
			this.refresh()
			void vscode.window
				.showInformationMessage(`Initialized the Cline workspace in ${targetPath}.`, "Open workspace.json")
				.then((choice) => (choice === "Open workspace.json" ? this.openWorkspaceManifest(targetPath) : undefined))
		} catch (error) {
			Logger.error(`${LOG_PREFIX} Failed to initialize the workspace:`, error)
			void vscode.window.showErrorMessage(`Could not initialize the Cline workspace: ${String(error)}`)
		}
	}

	/**
	 * Reveal `.cline/workspace.json` under `workspaceRoot`. The layout initializer
	 * is idempotent (it never overwrites existing files), so a missing manifest is
	 * created rather than reported as an error.
	 */
	private async openWorkspaceManifest(workspaceRoot: string): Promise<void> {
		try {
			const { workspaceJsonPath } = initializeWorkspaceLayout({ targetDir: workspaceRoot })
			this.refresh()
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(workspaceJsonPath))
			await vscode.window.showTextDocument(document, { preview: false })
		} catch (error) {
			Logger.error(`${LOG_PREFIX} Failed to open the workspace manifest:`, error)
			void vscode.window.showErrorMessage(`Could not open .cline/workspace.json: ${String(error)}`)
		}
	}

	dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose()
		}
		this.disposables.length = 0
	}
}
