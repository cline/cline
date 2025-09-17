import { resolveWorkspacePath } from "@core/workspace"
import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { ClineDefaultTool } from "@shared/tools"
import { getCwd, getDesktopDir } from "@/utils/path"

export class AutoApprove {
	autoApprovalSettings: AutoApprovalSettings
	approveAll: boolean

	constructor(autoApprovalSettings: AutoApprovalSettings, approveAll: boolean) {
		this.autoApprovalSettings = autoApprovalSettings
		this.approveAll = approveAll
	}

	// Check if the tool should be auto-approved based on the settings
	// Returns bool for most tools, and tuple for tools with nested settings
	shouldAutoApproveTool(toolName: ClineDefaultTool): boolean | [boolean, boolean] {
		if (this.approveAll) {
			switch (toolName) {
				case ClineDefaultTool.FILE_READ:
				case ClineDefaultTool.LIST_FILES:
				case ClineDefaultTool.LIST_CODE_DEF:
				case ClineDefaultTool.SEARCH:
				case ClineDefaultTool.NEW_RULE:
				case ClineDefaultTool.FILE_NEW:
				case ClineDefaultTool.FILE_EDIT:
				case ClineDefaultTool.BASH:
					return [true, true]

				case ClineDefaultTool.BROWSER:
				case ClineDefaultTool.WEB_FETCH:
				case ClineDefaultTool.MCP_ACCESS:
				case ClineDefaultTool.MCP_USE:
					return true
			}
		}

		if (this.autoApprovalSettings.enabled) {
			switch (toolName) {
				case ClineDefaultTool.FILE_READ:
				case ClineDefaultTool.LIST_FILES:
				case ClineDefaultTool.LIST_CODE_DEF:
				case ClineDefaultTool.SEARCH:
					return [
						this.autoApprovalSettings.actions.readFiles,
						this.autoApprovalSettings.actions.readFilesExternally ?? false,
					]
				case ClineDefaultTool.NEW_RULE:
				case ClineDefaultTool.FILE_NEW:
				case ClineDefaultTool.FILE_EDIT:
					return [
						this.autoApprovalSettings.actions.editFiles,
						this.autoApprovalSettings.actions.editFilesExternally ?? false,
					]
				case ClineDefaultTool.BASH:
					return [
						this.autoApprovalSettings.actions.executeSafeCommands ?? false,
						this.autoApprovalSettings.actions.executeAllCommands ?? false,
					]
				case ClineDefaultTool.BROWSER:
					return this.autoApprovalSettings.actions.useBrowser
				case ClineDefaultTool.WEB_FETCH:
					return this.autoApprovalSettings.actions.useBrowser
				case ClineDefaultTool.MCP_ACCESS:
				case ClineDefaultTool.MCP_USE:
					return this.autoApprovalSettings.actions.useMcp
			}
		}
		return false
	}

	// Check if the tool should be auto-approved based on the settings
	// and the path of the action. Returns true if the tool should be auto-approved
	// based on the user's settings and the path of the action.
	async shouldAutoApproveToolWithPath(
		blockname: ClineDefaultTool,
		autoApproveActionpath: string | undefined,
	): Promise<boolean> {
		if (this.approveAll) {
			return true
		}

		let isLocalRead: boolean = false
		if (autoApproveActionpath) {
			// Import isLocatedInWorkspace inline to check against ALL workspace roots
			const { isLocatedInWorkspace } = await import("@/utils/path")
			const path = await import("path")

			// If the path is already absolute, use it directly
			// Otherwise, resolve it relative to the primary workspace
			let absolutePath: string
			if (path.isAbsolute(autoApproveActionpath)) {
				// Path is already resolved by the tool handler
				absolutePath = autoApproveActionpath
			} else {
				// Fallback for legacy code paths that might still pass relative paths
				const cwd = await getCwd(getDesktopDir())
				absolutePath = resolveWorkspacePath(
					cwd,
					autoApproveActionpath,
					"AutoApprove.shouldAutoApproveToolWithPath",
				) as string
			}

			// Check if the path is in ANY workspace root, not just the primary one
			// This fixes the multi-workspace bug where files in secondary workspaces
			// were incorrectly treated as external files
			isLocalRead = await isLocatedInWorkspace(absolutePath)
		} else {
			// If we do not get a path for some reason, default to a (safer) false return
			isLocalRead = false
		}

		// Get auto-approve settings for local and external edits
		const autoApproveResult = this.shouldAutoApproveTool(blockname)
		const [autoApproveLocal, autoApproveExternal] = Array.isArray(autoApproveResult)
			? autoApproveResult
			: [autoApproveResult, false]

		if ((isLocalRead && autoApproveLocal) || (!isLocalRead && autoApproveLocal && autoApproveExternal)) {
			return true
		} else {
			return false
		}
	}

	updateSettings(settings: AutoApprovalSettings): void {
		this.autoApprovalSettings = settings
	}

	updateApproveAll(approveAll: boolean): void {
		this.approveAll = approveAll
	}
}
