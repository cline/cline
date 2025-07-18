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
		"groqModelId",
		"groqModelInfo",
		"huggingFaceModelId",
		"huggingFaceModelInfo",

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

			// Move to global storage using raw VSCode method to avoid type errors
			await context.globalState.update(key, workspaceValue)
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

export async function migrateLegacyApiConfigurationToModeSpecific(context: vscode.ExtensionContext) {
	try {
		// Check if migration is needed - if planModeApiProvider already exists, skip migration
		const planModeApiProvider = await context.globalState.get("planModeApiProvider")
		if (planModeApiProvider !== undefined) {
			console.log("Legacy API configuration migration already completed, skipping...")
			return
		}

		console.log("Starting legacy API configuration migration to mode-specific keys...")

		// Get the planActSeparateModelsSetting to determine migration strategy
		const planActSeparateModelsSetting = (await context.globalState.get("planActSeparateModelsSetting")) as
			| boolean
			| undefined

		// Read legacy values directly
		const apiProvider = await context.globalState.get("apiProvider")
		const apiModelId = await context.globalState.get("apiModelId")
		const thinkingBudgetTokens = await context.globalState.get("thinkingBudgetTokens")
		const reasoningEffort = await context.globalState.get("reasoningEffort")
		const vsCodeLmModelSelector = await context.globalState.get("vsCodeLmModelSelector")
		const awsBedrockCustomSelected = await context.globalState.get("awsBedrockCustomSelected")
		const awsBedrockCustomModelBaseId = await context.globalState.get("awsBedrockCustomModelBaseId")
		const openRouterModelId = await context.globalState.get("openRouterModelId")
		const openRouterModelInfo = await context.globalState.get("openRouterModelInfo")
		const openAiModelId = await context.globalState.get("openAiModelId")
		const openAiModelInfo = await context.globalState.get("openAiModelInfo")
		const ollamaModelId = await context.globalState.get("ollamaModelId")
		const lmStudioModelId = await context.globalState.get("lmStudioModelId")
		const liteLlmModelId = await context.globalState.get("liteLlmModelId")
		const liteLlmModelInfo = await context.globalState.get("liteLlmModelInfo")
		const requestyModelId = await context.globalState.get("requestyModelId")
		const requestyModelInfo = await context.globalState.get("requestyModelInfo")
		const togetherModelId = await context.globalState.get("togetherModelId")
		const fireworksModelId = await context.globalState.get("fireworksModelId")
		const sapAiCoreModelId = await context.globalState.get("sapAiCoreModelId")
		const groqModelId = await context.globalState.get("groqModelId")
		const groqModelInfo = await context.globalState.get("groqModelInfo")
		const huggingFaceModelId = await context.globalState.get("huggingFaceModelId")
		const huggingFaceModelInfo = await context.globalState.get("huggingFaceModelInfo")

		// Read previous mode values
		const previousModeApiProvider = await context.globalState.get("previousModeApiProvider")
		const previousModeModelId = await context.globalState.get("previousModeModelId")
		const previousModeModelInfo = await context.globalState.get("previousModeModelInfo")
		const previousModeVsCodeLmModelSelector = await context.globalState.get("previousModeVsCodeLmModelSelector")
		const previousModeThinkingBudgetTokens = await context.globalState.get("previousModeThinkingBudgetTokens")
		const previousModeReasoningEffort = await context.globalState.get("previousModeReasoningEffort")
		const previousModeAwsBedrockCustomSelected = await context.globalState.get("previousModeAwsBedrockCustomSelected")
		const previousModeAwsBedrockCustomModelBaseId = await context.globalState.get("previousModeAwsBedrockCustomModelBaseId")
		const previousModeSapAiCoreModelId = await context.globalState.get("previousModeSapAiCoreModelId")

		// Migrate based on planActSeparateModelsSetting
		if (planActSeparateModelsSetting === false) {
			console.log("Migrating with separate models DISABLED - using current values for both modes")

			// Use current values for both plan and act modes
			if (apiProvider !== undefined) {
				await context.globalState.update("planModeApiProvider", apiProvider)
				await context.globalState.update("actModeApiProvider", apiProvider)
			}
			if (apiModelId !== undefined) {
				await context.globalState.update("planModeApiModelId", apiModelId)
				await context.globalState.update("actModeApiModelId", apiModelId)
			}
			if (thinkingBudgetTokens !== undefined) {
				await context.globalState.update("planModeThinkingBudgetTokens", thinkingBudgetTokens)
				await context.globalState.update("actModeThinkingBudgetTokens", thinkingBudgetTokens)
			}
			if (reasoningEffort !== undefined) {
				await context.globalState.update("planModeReasoningEffort", reasoningEffort)
				await context.globalState.update("actModeReasoningEffort", reasoningEffort)
			}
			if (vsCodeLmModelSelector !== undefined) {
				await context.globalState.update("planModeVsCodeLmModelSelector", vsCodeLmModelSelector)
				await context.globalState.update("actModeVsCodeLmModelSelector", vsCodeLmModelSelector)
			}
			if (awsBedrockCustomSelected !== undefined) {
				await context.globalState.update("planModeAwsBedrockCustomSelected", awsBedrockCustomSelected)
				await context.globalState.update("actModeAwsBedrockCustomSelected", awsBedrockCustomSelected)
			}
			if (awsBedrockCustomModelBaseId !== undefined) {
				await context.globalState.update("planModeAwsBedrockCustomModelBaseId", awsBedrockCustomModelBaseId)
				await context.globalState.update("actModeAwsBedrockCustomModelBaseId", awsBedrockCustomModelBaseId)
			}
			if (openRouterModelId !== undefined) {
				await context.globalState.update("planModeOpenRouterModelId", openRouterModelId)
				await context.globalState.update("actModeOpenRouterModelId", openRouterModelId)
			}
			if (openRouterModelInfo !== undefined) {
				await context.globalState.update("planModeOpenRouterModelInfo", openRouterModelInfo)
				await context.globalState.update("actModeOpenRouterModelInfo", openRouterModelInfo)
			}
			if (openAiModelId !== undefined) {
				await context.globalState.update("planModeOpenAiModelId", openAiModelId)
				await context.globalState.update("actModeOpenAiModelId", openAiModelId)
			}
			if (openAiModelInfo !== undefined) {
				await context.globalState.update("planModeOpenAiModelInfo", openAiModelInfo)
				await context.globalState.update("actModeOpenAiModelInfo", openAiModelInfo)
			}
			if (ollamaModelId !== undefined) {
				await context.globalState.update("planModeOllamaModelId", ollamaModelId)
				await context.globalState.update("actModeOllamaModelId", ollamaModelId)
			}
			if (lmStudioModelId !== undefined) {
				await context.globalState.update("planModeLmStudioModelId", lmStudioModelId)
				await context.globalState.update("actModeLmStudioModelId", lmStudioModelId)
			}
			if (liteLlmModelId !== undefined) {
				await context.globalState.update("planModeLiteLlmModelId", liteLlmModelId)
				await context.globalState.update("actModeLiteLlmModelId", liteLlmModelId)
			}
			if (liteLlmModelInfo !== undefined) {
				await context.globalState.update("planModeLiteLlmModelInfo", liteLlmModelInfo)
				await context.globalState.update("actModeLiteLlmModelInfo", liteLlmModelInfo)
			}
			if (requestyModelId !== undefined) {
				await context.globalState.update("planModeRequestyModelId", requestyModelId)
				await context.globalState.update("actModeRequestyModelId", requestyModelId)
			}
			if (requestyModelInfo !== undefined) {
				await context.globalState.update("planModeRequestyModelInfo", requestyModelInfo)
				await context.globalState.update("actModeRequestyModelInfo", requestyModelInfo)
			}
			if (togetherModelId !== undefined) {
				await context.globalState.update("planModeTogetherModelId", togetherModelId)
				await context.globalState.update("actModeTogetherModelId", togetherModelId)
			}
			if (fireworksModelId !== undefined) {
				await context.globalState.update("planModeFireworksModelId", fireworksModelId)
				await context.globalState.update("actModeFireworksModelId", fireworksModelId)
			}
			if (sapAiCoreModelId !== undefined) {
				await context.globalState.update("planModeSapAiCoreModelId", sapAiCoreModelId)
				await context.globalState.update("actModeSapAiCoreModelId", sapAiCoreModelId)
			}
			if (groqModelId !== undefined) {
				await context.globalState.update("planModeGroqModelId", groqModelId)
				await context.globalState.update("actModeGroqModelId", groqModelId)
			}
			if (groqModelInfo !== undefined) {
				await context.globalState.update("planModeGroqModelInfo", groqModelInfo)
				await context.globalState.update("actModeGroqModelInfo", groqModelInfo)
			}
			if (huggingFaceModelId !== undefined) {
				await context.globalState.update("planModeHuggingFaceModelId", huggingFaceModelId)
				await context.globalState.update("actModeHuggingFaceModelId", huggingFaceModelId)
			}
			if (huggingFaceModelInfo !== undefined) {
				await context.globalState.update("planModeHuggingFaceModelInfo", huggingFaceModelInfo)
				await context.globalState.update("actModeHuggingFaceModelInfo", huggingFaceModelInfo)
			}
		} else {
			console.log("Migrating with separate models ENABLED - using current->plan, previous->act")

			// Use current values for plan mode
			if (apiProvider !== undefined) {
				await context.globalState.update("planModeApiProvider", apiProvider)
			}
			if (apiModelId !== undefined) {
				await context.globalState.update("planModeApiModelId", apiModelId)
			}
			if (thinkingBudgetTokens !== undefined) {
				await context.globalState.update("planModeThinkingBudgetTokens", thinkingBudgetTokens)
			}
			if (reasoningEffort !== undefined) {
				await context.globalState.update("planModeReasoningEffort", reasoningEffort)
			}
			if (vsCodeLmModelSelector !== undefined) {
				await context.globalState.update("planModeVsCodeLmModelSelector", vsCodeLmModelSelector)
			}
			if (awsBedrockCustomSelected !== undefined) {
				await context.globalState.update("planModeAwsBedrockCustomSelected", awsBedrockCustomSelected)
			}
			if (awsBedrockCustomModelBaseId !== undefined) {
				await context.globalState.update("planModeAwsBedrockCustomModelBaseId", awsBedrockCustomModelBaseId)
			}
			if (openRouterModelId !== undefined) {
				await context.globalState.update("planModeOpenRouterModelId", openRouterModelId)
			}
			if (openRouterModelInfo !== undefined) {
				await context.globalState.update("planModeOpenRouterModelInfo", openRouterModelInfo)
			}
			if (openAiModelId !== undefined) {
				await context.globalState.update("planModeOpenAiModelId", openAiModelId)
			}
			if (openAiModelInfo !== undefined) {
				await context.globalState.update("planModeOpenAiModelInfo", openAiModelInfo)
			}
			if (ollamaModelId !== undefined) {
				await context.globalState.update("planModeOllamaModelId", ollamaModelId)
			}
			if (lmStudioModelId !== undefined) {
				await context.globalState.update("planModeLmStudioModelId", lmStudioModelId)
			}
			if (liteLlmModelId !== undefined) {
				await context.globalState.update("planModeLiteLlmModelId", liteLlmModelId)
			}
			if (liteLlmModelInfo !== undefined) {
				await context.globalState.update("planModeLiteLlmModelInfo", liteLlmModelInfo)
			}
			if (requestyModelId !== undefined) {
				await context.globalState.update("planModeRequestyModelId", requestyModelId)
			}
			if (requestyModelInfo !== undefined) {
				await context.globalState.update("planModeRequestyModelInfo", requestyModelInfo)
			}
			if (togetherModelId !== undefined) {
				await context.globalState.update("planModeTogetherModelId", togetherModelId)
			}
			if (fireworksModelId !== undefined) {
				await context.globalState.update("planModeFireworksModelId", fireworksModelId)
			}
			if (sapAiCoreModelId !== undefined) {
				await context.globalState.update("planModeSapAiCoreModelId", sapAiCoreModelId)
			}
			if (groqModelId !== undefined) {
				await context.globalState.update("planModeGroqModelId", groqModelId)
			}
			if (groqModelInfo !== undefined) {
				await context.globalState.update("planModeGroqModelInfo", groqModelInfo)
			}
			if (huggingFaceModelId !== undefined) {
				await context.globalState.update("planModeHuggingFaceModelId", huggingFaceModelId)
			}
			if (huggingFaceModelInfo !== undefined) {
				await context.globalState.update("planModeHuggingFaceModelInfo", huggingFaceModelInfo)
			}

			// Use previous values for act mode (with fallback to current values)
			if (previousModeApiProvider !== undefined) {
				await context.globalState.update("actModeApiProvider", previousModeApiProvider)
			} else if (apiProvider !== undefined) {
				await context.globalState.update("actModeApiProvider", apiProvider)
			}
			if (previousModeModelId !== undefined) {
				await context.globalState.update("actModeApiModelId", previousModeModelId)
			} else if (apiModelId !== undefined) {
				await context.globalState.update("actModeApiModelId", apiModelId)
			}
			if (previousModeThinkingBudgetTokens !== undefined) {
				await context.globalState.update("actModeThinkingBudgetTokens", previousModeThinkingBudgetTokens)
			} else if (thinkingBudgetTokens !== undefined) {
				await context.globalState.update("actModeThinkingBudgetTokens", thinkingBudgetTokens)
			}
			if (previousModeReasoningEffort !== undefined) {
				await context.globalState.update("actModeReasoningEffort", previousModeReasoningEffort)
			} else if (reasoningEffort !== undefined) {
				await context.globalState.update("actModeReasoningEffort", reasoningEffort)
			}
			if (previousModeVsCodeLmModelSelector !== undefined) {
				await context.globalState.update("actModeVsCodeLmModelSelector", previousModeVsCodeLmModelSelector)
			} else if (vsCodeLmModelSelector !== undefined) {
				await context.globalState.update("actModeVsCodeLmModelSelector", vsCodeLmModelSelector)
			}
			if (previousModeAwsBedrockCustomSelected !== undefined) {
				await context.globalState.update("actModeAwsBedrockCustomSelected", previousModeAwsBedrockCustomSelected)
			} else if (awsBedrockCustomSelected !== undefined) {
				await context.globalState.update("actModeAwsBedrockCustomSelected", awsBedrockCustomSelected)
			}
			if (previousModeAwsBedrockCustomModelBaseId !== undefined) {
				await context.globalState.update("actModeAwsBedrockCustomModelBaseId", previousModeAwsBedrockCustomModelBaseId)
			} else if (awsBedrockCustomModelBaseId !== undefined) {
				await context.globalState.update("actModeAwsBedrockCustomModelBaseId", awsBedrockCustomModelBaseId)
			}
			if (previousModeSapAiCoreModelId !== undefined) {
				await context.globalState.update("actModeSapAiCoreModelId", previousModeSapAiCoreModelId)
			} else if (sapAiCoreModelId !== undefined) {
				await context.globalState.update("actModeSapAiCoreModelId", sapAiCoreModelId)
			}

			// For fields without previous variants, use current values for act mode
			if (previousModeModelInfo !== undefined) {
				await context.globalState.update("actModeOpenRouterModelInfo", previousModeModelInfo)
			} else if (openRouterModelInfo !== undefined) {
				await context.globalState.update("actModeOpenRouterModelInfo", openRouterModelInfo)
			}
			if (openRouterModelId !== undefined) {
				await context.globalState.update("actModeOpenRouterModelId", openRouterModelId)
			}
			if (openAiModelId !== undefined) {
				await context.globalState.update("actModeOpenAiModelId", openAiModelId)
			}
			if (openAiModelInfo !== undefined) {
				await context.globalState.update("actModeOpenAiModelInfo", openAiModelInfo)
			}
			if (ollamaModelId !== undefined) {
				await context.globalState.update("actModeOllamaModelId", ollamaModelId)
			}
			if (lmStudioModelId !== undefined) {
				await context.globalState.update("actModeLmStudioModelId", lmStudioModelId)
			}
			if (liteLlmModelId !== undefined) {
				await context.globalState.update("actModeLiteLlmModelId", liteLlmModelId)
			}
			if (liteLlmModelInfo !== undefined) {
				await context.globalState.update("actModeLiteLlmModelInfo", liteLlmModelInfo)
			}
			if (requestyModelId !== undefined) {
				await context.globalState.update("actModeRequestyModelId", requestyModelId)
			}
			if (requestyModelInfo !== undefined) {
				await context.globalState.update("actModeRequestyModelInfo", requestyModelInfo)
			}
			if (togetherModelId !== undefined) {
				await context.globalState.update("actModeTogetherModelId", togetherModelId)
			}
			if (fireworksModelId !== undefined) {
				await context.globalState.update("actModeFireworksModelId", fireworksModelId)
			}
			if (groqModelId !== undefined) {
				await context.globalState.update("actModeGroqModelId", groqModelId)
			}
			if (groqModelInfo !== undefined) {
				await context.globalState.update("actModeGroqModelInfo", groqModelInfo)
			}
			if (huggingFaceModelId !== undefined) {
				await context.globalState.update("actModeHuggingFaceModelId", huggingFaceModelId)
			}
			if (huggingFaceModelInfo !== undefined) {
				await context.globalState.update("actModeHuggingFaceModelInfo", huggingFaceModelInfo)
			}
		}

		// Clean up legacy keys after successful migration
		console.log("Cleaning up legacy keys...")
		await context.globalState.update("apiProvider", undefined)
		await context.globalState.update("apiModelId", undefined)
		await context.globalState.update("thinkingBudgetTokens", undefined)
		await context.globalState.update("reasoningEffort", undefined)
		await context.globalState.update("vsCodeLmModelSelector", undefined)
		await context.globalState.update("awsBedrockCustomSelected", undefined)
		await context.globalState.update("awsBedrockCustomModelBaseId", undefined)
		await context.globalState.update("openRouterModelId", undefined)
		await context.globalState.update("openRouterModelInfo", undefined)
		await context.globalState.update("openAiModelId", undefined)
		await context.globalState.update("openAiModelInfo", undefined)
		await context.globalState.update("ollamaModelId", undefined)
		await context.globalState.update("lmStudioModelId", undefined)
		await context.globalState.update("liteLlmModelId", undefined)
		await context.globalState.update("liteLlmModelInfo", undefined)
		await context.globalState.update("requestyModelId", undefined)
		await context.globalState.update("requestyModelInfo", undefined)
		await context.globalState.update("togetherModelId", undefined)
		await context.globalState.update("fireworksModelId", undefined)
		await context.globalState.update("sapAiCoreModelId", undefined)
		await context.globalState.update("groqModelId", undefined)
		await context.globalState.update("groqModelInfo", undefined)
		await context.globalState.update("huggingFaceModelId", undefined)
		await context.globalState.update("huggingFaceModelInfo", undefined)
		await context.globalState.update("previousModeApiProvider", undefined)
		await context.globalState.update("previousModeModelId", undefined)
		await context.globalState.update("previousModeModelInfo", undefined)
		await context.globalState.update("previousModeVsCodeLmModelSelector", undefined)
		await context.globalState.update("previousModeThinkingBudgetTokens", undefined)
		await context.globalState.update("previousModeReasoningEffort", undefined)
		await context.globalState.update("previousModeAwsBedrockCustomSelected", undefined)
		await context.globalState.update("previousModeAwsBedrockCustomModelBaseId", undefined)
		await context.globalState.update("previousModeSapAiCoreModelId", undefined)

		console.log("Successfully migrated legacy API configuration to mode-specific keys")
	} catch (error) {
		console.error("Failed to migrate legacy API configuration to mode-specific keys:", error)
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
						config.planModeOllamaModelId,
						config.planModeLmStudioModelId,
						config.actModeOllamaModelId,
						config.actModeLmStudioModelId,
						config.liteLlmApiKey,
						config.geminiApiKey,
						config.openAiNativeApiKey,
						config.deepSeekApiKey,
						config.requestyApiKey,
						config.togetherApiKey,
						config.qwenApiKey,
						config.doubaoApiKey,
						config.mistralApiKey,
						config.planModeVsCodeLmModelSelector,
						config.actModeVsCodeLmModelSelector,
						config.clineAccountId,
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
