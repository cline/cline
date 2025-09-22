import { resolveWorkspacePath } from "@core/workspace"
import { ClineDefaultTool } from "@shared/tools"
import type { StateManager } from "@/core/storage/StateManager"
import { getCwd, getDesktopDir, isLocatedInPath } from "@/utils/path"

export class AutoApprove {
	private stateManager: StateManager

	constructor(stateManager: StateManager) {
		this.stateManager = stateManager
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
				case ClineDefaultTool.BASH:
					return [true, true]

				case ClineDefaultTool.BROWSER:
				case ClineDefaultTool.WEB_FETCH:
				case ClineDefaultTool.MCP_ACCESS:
				case ClineDefaultTool.MCP_USE:
					return true
			}
		}

		const autoApprovalSettings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")

		if (autoApprovalSettings.enabled) {
			switch (toolName) {
				case ClineDefaultTool.FILE_READ:
				case ClineDefaultTool.LIST_FILES:
				case ClineDefaultTool.LIST_CODE_DEF:
				case ClineDefaultTool.SEARCH:
					return [autoApprovalSettings.actions.readFiles, autoApprovalSettings.actions.readFilesExternally ?? false]
				case ClineDefaultTool.NEW_RULE:
				case ClineDefaultTool.FILE_NEW:
				case ClineDefaultTool.FILE_EDIT:
					return [autoApprovalSettings.actions.editFiles, autoApprovalSettings.actions.editFilesExternally ?? false]
				case ClineDefaultTool.BASH:
					return [
						autoApprovalSettings.actions.executeSafeCommands ?? false,
						autoApprovalSettings.actions.executeAllCommands ?? false,
					]
				case ClineDefaultTool.BROWSER:
					return autoApprovalSettings.actions.useBrowser
				case ClineDefaultTool.WEB_FETCH:
					return autoApprovalSettings.actions.useBrowser
				case ClineDefaultTool.MCP_ACCESS:
				case ClineDefaultTool.MCP_USE:
					return autoApprovalSettings.actions.useMcp
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
		if (this.stateManager.getGlobalSettingsKey("yoloModeToggled")) {
			return true
		}

		let isLocalRead: boolean = false
		if (autoApproveActionpath) {
			const cwd = await getCwd(getDesktopDir())
			// When called with a string cwd, resolveWorkspacePath returns a string
			const absolutePath = resolveWorkspacePath(
				cwd,
				autoApproveActionpath,
				"AutoApprove.shouldAutoApproveToolWithPath",
			) as string
			isLocalRead = isLocatedInPath(cwd, absolutePath)
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
		}
		return false
	}
}
