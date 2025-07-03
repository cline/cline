import * as vscode from "vscode"
import { ensureRulesDirectoryExists } from "./disk"
import fs from "fs/promises"
import path from "path"
import { updateGlobalState, getAllExtensionState, getGlobalState } from "./state"
import { GlobalStateKey } from "./state-keys"

export async function migrateWorkspaceToGlobalStorage(context: vscode.ExtensionContext) {
	// Keys to migrate from workspace storage back to global storage
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
		"sapAiCoreModelId",

		// Previous mode settings
		"previousModeApiProvider",
		"previousModeModelId",
		"previousModeModelInfo",
		"previousModeVsCodeLmModelSelector",
		"previousModeThinkingBudgetTokens",
		"previousModeReasoningEffort",
		"previousModeAwsBedrockCustomSelected",
		"previousModeAwsBedrockCustomModelBaseId",
		"previousModeSapAiCoreModelId",
	]

	for (const key of keysToMigrate) {
		// Use raw workspace state since these keys shouldn't be in workspace storage
		const workspaceValue = await context.workspaceState.get(key)
		const globalValue = await context.globalState.get(key)

		if (workspaceValue !== undefined && globalValue === undefined) {
			console.log(`[Storage Migration] migrating key: ${key} to global storage. Current value: ${workspaceValue}`)

			// Move to global storage
			await updateGlobalState(context, key as GlobalStateKey, workspaceValue)
			// Remove from workspace storage
			await context.workspaceState.update(key, undefined)
			const newWorkspaceValue = await context.workspaceState.get(key)

			console.log(`[Storage Migration] migrated key: ${key} to global storage. Current value: ${newWorkspaceValue}`)
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
		// Check legacy workspace storage (use raw methods since chatSettings is now global)
		const workspaceChatSettings = (await context.workspaceState.get("chatSettings")) as any

		if (workspaceChatSettings && typeof workspaceChatSettings === "object" && "mode" in workspaceChatSettings) {
			console.log("Cleaning up mode from legacy workspace storage...")

			// Remove mode property from chatSettings
			const { mode, ...cleanedChatSettings } = workspaceChatSettings

			// Save cleaned chatSettings back to workspace storage (will be migrated later)
			await context.workspaceState.update("chatSettings", cleanedChatSettings)

			console.log("Successfully removed mode from legacy workspace storage chatSettings")
		}

		// Also check global storage for any mode cleanup needed
		const globalChatSettings = (await context.globalState.get("chatSettings")) as any

		if (globalChatSettings && typeof globalChatSettings === "object" && "mode" in globalChatSettings) {
			console.log("Cleaning up mode from global storage...")

			// Remove mode property from chatSettings
			const { mode, ...cleanedChatSettings } = globalChatSettings

			// Save cleaned chatSettings back to global storage
			await updateGlobalState(context, "chatSettings", cleanedChatSettings)

			console.log("Successfully removed mode from global storage chatSettings")
		}
	} catch (error) {
		console.error("Failed to cleanup mode from storage:", error)
		// Continue execution - migration failure shouldn't break extension startup
	}
}

export async function migrateWelcomeViewCompleted(context: vscode.ExtensionContext) {
	try {
		// Check if welcomeViewCompleted is already set
		const welcomeViewCompleted = await getGlobalState(context, "welcomeViewCompleted")

		if (welcomeViewCompleted === undefined) {
			console.log("Migrating welcomeViewCompleted setting...")

			// Get all extension state to check for existing API keys
			const extensionState = await getAllExtensionState(context)
			const config = extensionState.apiConfiguration

			// This is the original logic used for checking is the welcome view should be shown
			// It was located in the ExtensionStateContextProvider
			const hasKey = config
				? [
						config.apiKey,
						config.openRouterApiKey,
						config.awsRegion,
						config.vertexProjectId,
						config.openAiApiKey,
						config.ollamaModelId,
						config.lmStudioModelId,
						config.liteLlmApiKey,
						config.geminiApiKey,
						config.openAiNativeApiKey,
						config.deepSeekApiKey,
						config.requestyApiKey,
						config.togetherApiKey,
						config.qwenApiKey,
						config.doubaoApiKey,
						config.mistralApiKey,
						config.vsCodeLmModelSelector,
						config.clineApiKey,
						config.asksageApiKey,
						config.xaiApiKey,
						config.sambanovaApiKey,
						config.sapAiCoreClientId,
					].some((key) => key !== undefined)
				: false

			// Set welcomeViewCompleted based on whether user has keys
			await updateGlobalState(context, "welcomeViewCompleted", hasKey)

			console.log(`Migration: Set welcomeViewCompleted to ${hasKey} based on existing API keys`)
		}
	} catch (error) {
		console.error("Failed to migrate welcomeViewCompleted:", error)
		// Continue execution - migration failure shouldn't break extension startup
	}
}
