import { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { ToolUseName } from "@core/assistant-message"
import * as path from "path"
import os from "os"
import { getCwd } from "@/utils/path"

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
			const cwd = await getCwd(path.join(os.homedir(), "Desktop"))
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
