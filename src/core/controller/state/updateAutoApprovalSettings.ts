import { Empty } from "@shared/proto/cline/common"
import { AutoApprovalSettingsRequest } from "@shared/proto/cline/state"
import { Controller } from ".."

/**
 * Updates the auto approval settings
 * @param controller The controller instance
 * @param request The auto approval settings request
 * @returns Empty response
 */
export async function updateAutoApprovalSettings(controller: Controller, request: AutoApprovalSettingsRequest): Promise<Empty> {
	const currentSettings = (await controller.getStateToPostToWebview()).autoApprovalSettings
	const incomingVersion = request.version
	const currentVersion = currentSettings?.version ?? 1

	// Only update if incoming version is higher
	if (incomingVersion > currentVersion) {
		// Merge with current settings to preserve unspecified fields
		const settings = {
			...currentSettings,
			...(request.version !== undefined && { version: request.version }),
			...(request.enableNotifications !== undefined && { enableNotifications: request.enableNotifications }),
			actions: {
				...currentSettings.actions,
				...(request.actions
					? Object.fromEntries(Object.entries(request.actions).filter(([_, v]) => v !== undefined))
					: {}),
			},
		}

		// Check if any action flags were disabled and reset corresponding tool policies
		if (request.actions) {
			const updatedToolPolicies = { ...currentSettings.toolPolicies }

			// If readFiles was disabled, reset all read-related tool policies
			if (request.actions.readFiles === false) {
				updatedToolPolicies.readFile = "ask_everytime"
				updatedToolPolicies.listFilesTopLevel = "ask_everytime"
				updatedToolPolicies.listFilesRecursive = "ask_everytime"
				updatedToolPolicies.listCodeDefinitionNames = "ask_everytime"
				updatedToolPolicies.searchFiles = "ask_everytime"
			}

			// If editFiles was disabled, reset all edit-related tool policies
			if (request.actions.editFiles === false) {
				updatedToolPolicies.editedExistingFile = "ask_everytime"
				updatedToolPolicies.newFileCreated = "ask_everytime"
			}

			// If executeSafeCommands was disabled, reset safe command policy
			if (request.actions.executeSafeCommands === false) {
				updatedToolPolicies.executeSafeCommand = "ask_everytime"
			}

			// If executeAllCommands was disabled, reset risky command policy
			if (request.actions.executeAllCommands === false) {
				updatedToolPolicies.executeRiskyCommand = "ask_everytime"
			}

			// If useBrowser was disabled, reset browser policy
			if (request.actions.useBrowser === false) {
				updatedToolPolicies.useBrowser = "ask_everytime"
			}

			// If useMcp was disabled, reset MCP policies
			if (request.actions.useMcp === false) {
				updatedToolPolicies.useMcpTool = "ask_everytime"
				updatedToolPolicies.accessMcpResource = "ask_everytime"
			}

			settings.toolPolicies = updatedToolPolicies
		}

		controller.stateManager.setGlobalState("autoApprovalSettings", settings)

		await controller.postStateToWebview()
	}

	return Empty.create()
}
