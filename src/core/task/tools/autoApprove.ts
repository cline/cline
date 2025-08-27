/**
 * TODO: Refactor Auto-Approval Behavior for Consistency
 *
 * CURRENT ISSUE:
 * The auto-approval logic is currently split and inconsistent between two execution contexts:
 *
 * 1. UIHelpers (used in handlePartialBlock):
 *    - Makes approval decisions during streaming/partial updates
 *    - Uses shouldAutoApproveToolWithPath() and other helper methods
 *    - Logic is embedded in the UIHelpers factory pattern
 *
 * 2. Execute functions (used in handleCompleteBlock):
 *    - Makes approval decisions after tool completion
 *    - Uses different approval patterns and checks
 *    - Logic is scattered across individual tool handlers
 *
 * This split creates several problems:
 * - Inconsistent approval behavior between streaming and final execution
 * - Duplicate approval logic that can drift apart
 * - Harder to maintain and reason about approval flow
 * - Potential for approval bypasses or double-approvals
 *
 * PROPOSED SOLUTION:
 * - Consolidate all auto-approval logic into this AutoApprove class
 * - Create a single source of truth for approval decisions
 * - Ensure both partial and complete blocks use the same approval flow
 * - Make approval behavior predictable and testable
 *
 * AFFECTED FILES TO REFACTOR:
 * - src/core/task/tools/types/UIHelpers.ts (shouldAutoApproveToolWithPath logic)
 * - src/core/task/tools/handlers/* (individual handler approval logic)
 * - src/core/task/ToolExecutor.ts (approval flow coordination)
 */

import { ToolUseName } from "@core/assistant-message"
import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import * as path from "path"
import { getCwd, getDesktopDir } from "@/utils/path"

export class AutoApprove {
	autoApprovalSettings: AutoApprovalSettings

	constructor(autoApprovalSettings: AutoApprovalSettings) {
		this.autoApprovalSettings = autoApprovalSettings
	}

	// Check if the tool should be auto-approved based on the settings
	// Returns bool for most tools, and tuple for tools with nested settings
	shouldAutoApproveTool(toolName: ToolUseName): boolean | [boolean, boolean] {
		if (this.autoApprovalSettings.enabled) {
			switch (toolName) {
				case "read_file":
				case "list_files":
				case "list_code_definition_names":
				case "search_files":
					return [
						this.autoApprovalSettings.actions.readFiles,
						this.autoApprovalSettings.actions.readFilesExternally ?? false,
					]
				case "new_rule":
				case "write_to_file":
				case "replace_in_file":
					return [
						this.autoApprovalSettings.actions.editFiles,
						this.autoApprovalSettings.actions.editFilesExternally ?? false,
					]
				case "execute_command":
					return [
						this.autoApprovalSettings.actions.executeSafeCommands ?? false,
						this.autoApprovalSettings.actions.executeAllCommands ?? false,
					]
				case "browser_action":
					return this.autoApprovalSettings.actions.useBrowser
				case "web_fetch":
					return this.autoApprovalSettings.actions.useBrowser
				case "access_mcp_resource":
				case "use_mcp_tool":
					return this.autoApprovalSettings.actions.useMcp
			}
		}
		return false
	}

	// Check if the tool should be auto-approved based on the settings
	// and the path of the action. Returns true if the tool should be auto-approved
	// based on the user's settings and the path of the action.
	async shouldAutoApproveToolWithPath(blockname: ToolUseName, autoApproveActionpath: string | undefined): Promise<boolean> {
		let isLocalRead: boolean = false
		if (autoApproveActionpath) {
			const cwd = await getCwd(getDesktopDir())
			const absolutePath = path.resolve(cwd, autoApproveActionpath)
			isLocalRead = absolutePath.startsWith(cwd)
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
}
