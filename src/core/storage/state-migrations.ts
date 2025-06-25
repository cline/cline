import * as vscode from "vscode"
import { ensureRulesDirectoryExists } from "./disk"
import fs from "fs/promises"
import path from "path"
import { getGlobalState, getWorkspaceState, updateGlobalState, updateWorkspaceState } from "./state"
import { GlobalStateKey } from "./state-keys"

export async function migratePlanActGlobalToWorkspaceStorage(context: vscode.ExtensionContext) {
	// Keys that were migrated from global storage to workspace storage
	const keysToMigrate = [
		// Core settings
		"apiProvider",
		"apiModelId",
		"thinkingBudgetTokens",
		"reasoningEffort",
		"chatSettings",
		"vsCodeLmModelSelector",

		// Provider-specific model keys
		"awsBedrockCustomSelected",
		"awsBedrockCustomModelBaseId",
		"openRouterModelId",
		"openRouterModelInfo",
		"openAiModelId",
		"openAiModelInfo",
		"ollamaModelId",
		"lmStudioModelId",
		"liteLlmModelId",
		"liteLlmModelInfo",
		"requestyModelId",
		"requestyModelInfo",
		"togetherModelId",
		"fireworksModelId",

		// Previous mode settings
		"previousModeApiProvider",
		"previousModeModelId",
		"previousModeModelInfo",
		"previousModeVsCodeLmModelSelector",
		"previousModeThinkingBudgetTokens",
		"previousModeReasoningEffort",
		"previousModeAwsBedrockCustomSelected",
		"previousModeAwsBedrockCustomModelBaseId",
	]

	for (const key of keysToMigrate) {
		const globalValue = await getGlobalState(context, key as GlobalStateKey)
		if (globalValue !== undefined) {
			const workspaceValue = await getWorkspaceState(context, key)
			if (workspaceValue === undefined) {
				await updateWorkspaceState(context, key, globalValue)
			}
			// Delete from global storage regardless of whether we copied it
			await updateGlobalState(context, key as GlobalStateKey, undefined)
		}
	}
}

export async function migrateMcpMarketplaceEnableSetting(mcpMarketplaceEnabledRaw: boolean | undefined): Promise<boolean> {
	const config = vscode.workspace.getConfiguration("cline")
	const mcpMarketplaceEnabled = config.get<boolean>("mcpMarketplace.enabled")
	if (mcpMarketplaceEnabled !== undefined) {
		// Remove from VSCode configuration
		await config.update("mcpMarketplace.enabled", undefined, true)

		return !mcpMarketplaceEnabled
	}
	return mcpMarketplaceEnabledRaw ?? true
}

export async function migrateEnableCheckpointsSetting(enableCheckpointsSettingRaw: boolean | undefined): Promise<boolean> {
	const config = vscode.workspace.getConfiguration("cline")
	const enableCheckpoints = config.get<boolean>("enableCheckpoints")
	if (enableCheckpoints !== undefined) {
		// Remove from VSCode configuration
		await config.update("enableCheckpoints", undefined, true)
		return enableCheckpoints
	}
	return enableCheckpointsSettingRaw ?? true
}

export async function migrateCustomInstructionsToGlobalRules(context: vscode.ExtensionContext) {
	try {
		const customInstructions = (await context.globalState.get("customInstructions")) as string | undefined

		if (customInstructions?.trim()) {
			console.log("Migrating custom instructions to global Cline rules...")

			// Create global .clinerules directory if it doesn't exist
			const globalRulesDir = await ensureRulesDirectoryExists()

			// Use a fixed filename for custom instructions
			const migrationFileName = "custom_instructions.md"
			const migrationFilePath = path.join(globalRulesDir, migrationFileName)

			try {
				// Check if file already exists to determine if we should append
				let existingContent = ""
				try {
					existingContent = await fs.readFile(migrationFilePath, "utf8")
				} catch (readError) {
					// File doesn't exist, which is fine
				}

				// Append or create the file with custom instructions
				const contentToWrite = existingContent
					? `${existingContent}\n\n---\n\n${customInstructions.trim()}`
					: customInstructions.trim()

				await fs.writeFile(migrationFilePath, contentToWrite)
				console.log(`Successfully ${existingContent ? "appended to" : "created"} migration file: ${migrationFilePath}`)
			} catch (fileError) {
				console.error("Failed to write migration file:", fileError)
				return
			}

			// Remove customInstructions from global state only after successful file creation
			await context.globalState.update("customInstructions", undefined)
			console.log("Successfully migrated custom instructions to global Cline rules")
		}
	} catch (error) {
		console.error("Failed to migrate custom instructions to global rules:", error)
		// Continue execution - migration failure shouldn't break extension startup
	}
}

export async function migrateModeFromWorkspaceStorageToControllerState(context: vscode.ExtensionContext) {
	try {
		// Get current chatSettings from workspace storage
		const chatSettings = (await getWorkspaceState(context, "chatSettings")) as any

		if (chatSettings && typeof chatSettings === "object" && "mode" in chatSettings) {
			console.log("Cleaning up mode from workspace storage...")

			// Remove mode property from chatSettings
			const { mode, ...cleanedChatSettings } = chatSettings

			// Save cleaned chatSettings back to workspace storage
			await updateWorkspaceState(context, "chatSettings", cleanedChatSettings)

			console.log("Successfully removed mode from workspace storage chatSettings")
		}
	} catch (error) {
		console.error("Failed to cleanup mode from workspace storage:", error)
		// Continue execution - migration failure shouldn't break extension startup
	}
}
