import fs from "fs/promises"
import * as path from "path"
import { resolveWorkspacePath } from "@core/workspace"
import { isMultiRootEnabled } from "@core/workspace/multi-root-utils"
import { ClineDefaultTool } from "@shared/tools"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { getCwd, getDesktopDir, isLocatedInPath, isLocatedInWorkspace } from "@/utils/path"

export class AutoApprove {
	private stateManager: StateManager
	// Cache for workspace paths - populated on first access and reused for the task lifetime
	// NOTE: This assumes that the task has a fixed set of workspace roots(which is currently true).
	private workspacePathsCache: { paths: string[] } | null = null
	private isMultiRootScenarioCache: boolean | null = null

	constructor(stateManager: StateManager) {
		this.stateManager = stateManager
	}

	/**
	 * Get workspace information with caching to avoid repeated API calls
	 * Cache is task-scoped since each task gets a new AutoApprove instance
	 */
	private async getWorkspaceInfo(): Promise<{
		workspacePaths: { paths: string[] }
		isMultiRootScenario: boolean
	}> {
		// Check if we already have cached values
		if (this.workspacePathsCache === null || this.isMultiRootScenarioCache === null) {
			// First time - fetch and cache for the lifetime of this task
			this.workspacePathsCache = await HostProvider.workspace.getWorkspacePaths({})
			this.isMultiRootScenarioCache = isMultiRootEnabled(this.stateManager) && this.workspacePathsCache.paths.length > 1
		}

		return {
			workspacePaths: this.workspacePathsCache,
			isMultiRootScenario: this.isMultiRootScenarioCache,
		}
	}

	// Check if the tool should be auto-approved based on the settings
	// Returns bool for most tools, and tuple for tools with nested settings
	shouldAutoApproveTool(toolName: ClineDefaultTool): boolean | [boolean, boolean] {
		if (this.stateManager.getGlobalSettingsKey("yoloModeToggled")) {
			switch (toolName) {
				case ClineDefaultTool.FILE_READ:
				case ClineDefaultTool.LIST_FILES:
				case ClineDefaultTool.LIST_CODE_DEF:
				case ClineDefaultTool.SEARCH:
				case ClineDefaultTool.NEW_RULE:
				case ClineDefaultTool.FILE_NEW:
				case ClineDefaultTool.FILE_EDIT:
				case ClineDefaultTool.APPLY_PATCH:
				case ClineDefaultTool.BASH:
				case ClineDefaultTool.USE_SUBAGENTS:
					return [true, true]

				case ClineDefaultTool.BROWSER:
				case ClineDefaultTool.WEB_FETCH:
				case ClineDefaultTool.WEB_SEARCH:
				case ClineDefaultTool.MCP_ACCESS:
				case ClineDefaultTool.MCP_USE:
					return true
			}
		}

		if (this.stateManager.getGlobalSettingsKey("autoApproveAllToggled")) {
			switch (toolName) {
				case ClineDefaultTool.FILE_READ:
				case ClineDefaultTool.LIST_FILES:
				case ClineDefaultTool.LIST_CODE_DEF:
				case ClineDefaultTool.SEARCH:
				case ClineDefaultTool.NEW_RULE:
				case ClineDefaultTool.FILE_NEW:
				case ClineDefaultTool.FILE_EDIT:
				case ClineDefaultTool.APPLY_PATCH:
				case ClineDefaultTool.BASH:
				case ClineDefaultTool.USE_SUBAGENTS:
					return [true, true]
				case ClineDefaultTool.BROWSER:
				case ClineDefaultTool.WEB_FETCH:
				case ClineDefaultTool.WEB_SEARCH:
				case ClineDefaultTool.MCP_ACCESS:
				case ClineDefaultTool.MCP_USE:
					return true
			}
		}

		const autoApprovalSettings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")

		switch (toolName) {
			case ClineDefaultTool.FILE_READ:
			case ClineDefaultTool.LIST_FILES:
			case ClineDefaultTool.LIST_CODE_DEF:
			case ClineDefaultTool.SEARCH:
			case ClineDefaultTool.USE_SUBAGENTS:
				return [autoApprovalSettings.actions.readFiles, autoApprovalSettings.actions.readFilesExternally ?? false]
			case ClineDefaultTool.NEW_RULE:
			case ClineDefaultTool.FILE_NEW:
			case ClineDefaultTool.FILE_EDIT:
			case ClineDefaultTool.APPLY_PATCH:
				return [autoApprovalSettings.actions.editFiles, autoApprovalSettings.actions.editFilesExternally ?? false]
			case ClineDefaultTool.BASH:
				return [
					autoApprovalSettings.actions.executeSafeCommands ?? false,
					autoApprovalSettings.actions.executeAllCommands ?? false,
				]
			case ClineDefaultTool.BROWSER:
				return autoApprovalSettings.actions.useBrowser
			case ClineDefaultTool.WEB_FETCH:
			case ClineDefaultTool.WEB_SEARCH:
				return autoApprovalSettings.actions.useBrowser
			case ClineDefaultTool.MCP_ACCESS:
			case ClineDefaultTool.MCP_USE:
				return autoApprovalSettings.actions.useMcp
		}
		return false
	}

	/**
	 * Check if a path is accessed via a symlink that exists within the workspace.
	 * This walks up the path tree to find any symlinks and verifies they are in the workspace.
	 */
	private async isPathViaWorkspaceSymlink(filePath: string): Promise<boolean> {
		try {
			const { workspacePaths } = await this.getWorkspaceInfo()

			// Normalize the path
			const normalizedPath = path.normalize(filePath)
			const parts = normalizedPath.split(path.sep)

			// Check each directory in the path (from root to leaf)
			let currentPath = ""
			for (const part of parts) {
				currentPath = currentPath ? path.join(currentPath, part) : part
				if (!currentPath || currentPath === path.sep) continue

				try {
					const stats = await fs.lstat(currentPath)
					if (stats.isSymbolicLink()) {
						// Found a symlink - check if it's in any workspace
						for (const wsPath of workspacePaths.paths) {
							if (currentPath.startsWith(wsPath + path.sep) || currentPath === wsPath) {
								// The symlink is within a workspace folder - allow it
								return true
							}
						}
					}
				} catch {
					// Path component doesn't exist or can't be accessed, skip
					continue
				}
			}
			return false
		} catch {
			return false
		}
	}

	// Check if the tool should be auto-approved based on the settings
	// and the path of the action. Returns true if the tool should be auto-approved
	// based on the user's settings and the path of the action.
	async shouldAutoApproveToolWithPath(
		blockname: ClineDefaultTool,
		autoApproveActionpath: string | undefined,
	): Promise<boolean> {
		if (this.stateManager.getGlobalSettingsKey("yoloModeToggled")) {
			return true
		}
		if (this.stateManager.getGlobalSettingsKey("autoApproveAllToggled")) {
			return true
		}

		let isLocalPath = false
		if (autoApproveActionpath) {
			// Use cached workspace info instead of fetching every time
			const { isMultiRootScenario } = await this.getWorkspaceInfo()

			if (isMultiRootScenario) {
				// Multi-root: check if file is in ANY workspace
				isLocalPath = await isLocatedInWorkspace(autoApproveActionpath)
			} else {
				// Single-root: use existing logic
				const cwd = await getCwd(getDesktopDir())
				// When called with a string cwd, resolveWorkspacePath returns a string
				const absolutePath = resolveWorkspacePath(
					cwd,
					autoApproveActionpath,
					"AutoApprove.shouldAutoApproveToolWithPath",
				) as string
				isLocalPath = isLocatedInPath(cwd, absolutePath)
			}

			// If not local, check if accessed via a workspace symlink and setting is enabled
			const autoApprovalSettings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")
			if (!isLocalPath && autoApprovalSettings.actions.editSymlinkedFiles) {
				const isViaSymlink = await this.isPathViaWorkspaceSymlink(autoApproveActionpath)
				if (isViaSymlink) {
					isLocalPath = true
				}
			}
		} else {
			// If we do not get a path for some reason, default to a (safer) false return
			isLocalPath = false
		}

		// Get auto-approve settings for local and external edits
		const autoApproveResult = this.shouldAutoApproveTool(blockname)
		const [autoApproveLocal, autoApproveExternal] = Array.isArray(autoApproveResult)
			? autoApproveResult
			: [autoApproveResult, false]

		if ((isLocalPath && autoApproveLocal) || (!isLocalPath && autoApproveLocal && autoApproveExternal)) {
			return true
		}
		return false
	}
}
