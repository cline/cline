import { ToolApprovalPolicy } from "../../../shared/AutoApprovalSettings"
import { Empty } from "../../../shared/proto/cline/common"
import { SetToolApprovalPolicyRequest } from "../../../shared/proto/cline/task"
import { Controller } from ".."

/**
 * Sets the approval policy for a specific tool
 * @param controller The controller instance
 * @param request The request containing the tool name and policy
 * @returns Empty response
 */
export async function setToolApprovalPolicy(controller: Controller, request: SetToolApprovalPolicyRequest): Promise<Empty> {
	const { toolName, policy } = request

	// Validate policy value
	const validPolicies: ToolApprovalPolicy[] = ["ask_everytime", "auto_approve", "never_allow"]
	if (!validPolicies.includes(policy as ToolApprovalPolicy)) {
		throw new Error(`Invalid policy: ${policy}. Must be one of: ${validPolicies.join(", ")}`)
	}

	// Get current auto approval settings
	const currentSettings = (await controller.getStateToPostToWebview()).autoApprovalSettings

	// Map tool names to their corresponding action flags
	const getActionFlag = (toolName: string): keyof typeof currentSettings.actions | null => {
		switch (toolName) {
			case "readFile":
			case "listFilesTopLevel":
			case "listFilesRecursive":
			case "listCodeDefinitionNames":
			case "searchFiles":
				return "readFiles"
			case "editedExistingFile":
			case "newFileCreated":
				return "editFiles"
			case "executeSafeCommand":
				return "executeSafeCommands"
			case "executeRiskyCommand":
				return "executeAllCommands"
			case "useBrowser":
				return "useBrowser"
			case "useMcpTool":
			case "accessMcpResource":
				return "useMcp"
			default:
				return null
		}
	}

	// Update tool policies
	const updatedSettings = {
		...currentSettings,
		toolPolicies: {
			...currentSettings.toolPolicies,
			[toolName]: policy as ToolApprovalPolicy,
		},
		version: currentSettings.version + 1, // Increment version for race condition prevention
	}

	// If setting to auto_approve, also enable the corresponding legacy action flag
	if (policy === "auto_approve") {
		const actionFlag = getActionFlag(toolName)
		if (actionFlag) {
			updatedSettings.actions = {
				...updatedSettings.actions,
				[actionFlag]: true,
			}
		}
	}

	// Save to global state
	controller.stateManager.setGlobalState("autoApprovalSettings", updatedSettings)

	// Notify all webviews of the update
	await controller.postStateToWebview()

	return Empty.create()
}
