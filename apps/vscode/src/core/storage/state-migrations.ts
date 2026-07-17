import fs from "fs/promises"
import path from "path"
import * as vscode from "vscode"
import { Logger } from "@/shared/services/Logger"
import { ensureRulesDirectoryExists } from "./disk"

export async function migrateWorkspaceToGlobalStorage(context: vscode.ExtensionContext) {
	// Keys to migrate from workspace storage back to global storage
	const keysToMigrate = [
		// Core settings
		"apiProvider",
		"apiModelId",
		"thinkingBudgetTokens",
		"reasoningEffort",
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
			Logger.log(`[Storage Migration] migrating key: ${key} to global storage. Current value: ${workspaceValue}`)

			// Move to global storage using raw VSCode method to avoid type errors
			await context.globalState.update(key, workspaceValue)
			// Remove from workspace storage
			await context.workspaceState.update(key, undefined)
			const newWorkspaceValue = await context.workspaceState.get(key)

			Logger.log(`[Storage Migration] migrated key: ${key} to global storage. Current value: ${newWorkspaceValue}`)
		}
	}
}

export async function migrateTaskHistoryToFile(_context: vscode.ExtensionContext) {
	// TODO migrate to sdk location
}

export async function migrateCustomInstructionsToGlobalRules(context: vscode.ExtensionContext) {
	try {
		const customInstructions = (await context.globalState.get("customInstructions")) as string | undefined

		if (customInstructions?.trim()) {
			Logger.log("Migrating custom instructions to global Cline rules...")

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
				} catch (_readError) {
					// File doesn't exist, which is fine
				}

				// Append or create the file with custom instructions
				const contentToWrite = existingContent
					? `${existingContent}\n\n---\n\n${customInstructions.trim()}`
					: customInstructions.trim()

				await fs.writeFile(migrationFilePath, contentToWrite)
				Logger.log(`Successfully ${existingContent ? "appended to" : "created"} migration file: ${migrationFilePath}`)
			} catch (fileError) {
				Logger.error("Failed to write migration file:", fileError)
				return
			}

			// Remove customInstructions from global state only after successful file creation
			await context.globalState.update("customInstructions", undefined)
			Logger.log("Successfully migrated custom instructions to global Cline rules")
		}
	} catch (error) {
		Logger.error("Failed to migrate custom instructions to global rules:", error)
		// Continue execution - migration failure shouldn't break extension startup
	}
}

export async function migrateWelcomeViewCompleted(context: vscode.ExtensionContext) {
	try {
		// Check if welcomeViewCompleted is already set
		const welcomeViewCompleted = context.globalState.get("welcomeViewCompleted")

		if (welcomeViewCompleted === undefined) {
			Logger.log("Migrating welcomeViewCompleted setting...")

			// Fetch API keys directly from secrets
			const apiKey = await context.secrets.get("apiKey")
			const openRouterApiKey = await context.secrets.get("openRouterApiKey")
			const clineAccountId = await context.secrets.get("clineAccountId")
			const openAiApiKey = await context.secrets.get("openAiApiKey")
			const ollamaApiKey = await context.secrets.get("ollamaApiKey")
			const liteLlmApiKey = await context.secrets.get("liteLlmApiKey")
			const geminiApiKey = await context.secrets.get("geminiApiKey")
			const openAiNativeApiKey = await context.secrets.get("openAiNativeApiKey")
			const deepSeekApiKey = await context.secrets.get("deepSeekApiKey")
			const requestyApiKey = await context.secrets.get("requestyApiKey")
			const togetherApiKey = await context.secrets.get("togetherApiKey")
			const qwenApiKey = await context.secrets.get("qwenApiKey")
			const doubaoApiKey = await context.secrets.get("doubaoApiKey")
			const mistralApiKey = await context.secrets.get("mistralApiKey")
			const asksageApiKey = await context.secrets.get("asksageApiKey")
			const xaiApiKey = await context.secrets.get("xaiApiKey")
			const novitaApiKey = await context.secrets.get("novitaApiKey")
			const sambanovaApiKey = await context.secrets.get("sambanovaApiKey")
			const sapAiCoreClientId = await context.secrets.get("sapAiCoreClientId")
			const difyApiKey = await context.secrets.get("difyApiKey")
			const hicapApiKey = await context.secrets.get("hicapApiKey")
			// OpenAI Codex OAuth credentials
			const openAiCodexCredentials = await context.secrets.get("openai-codex-oauth-credentials")

			// Fetch configuration values from global state
			const awsRegion = context.globalState.get("awsRegion")
			const vertexProjectId = context.globalState.get("vertexProjectId")
			const planModeOllamaModelId = context.globalState.get("planModeOllamaModelId")
			const planModeLmStudioModelId = context.globalState.get("planModeLmStudioModelId")
			const actModeOllamaModelId = context.globalState.get("actModeOllamaModelId")
			const actModeLmStudioModelId = context.globalState.get("actModeLmStudioModelId")
			const planModeVsCodeLmModelSelector = context.globalState.get("planModeVsCodeLmModelSelector")
			const actModeVsCodeLmModelSelector = context.globalState.get("actModeVsCodeLmModelSelector")

			// This is the original logic used for checking if the welcome view should be shown
			// It was located in the ExtensionStateContextProvider
			const hasKey = [
				apiKey,
				openRouterApiKey,
				awsRegion,
				vertexProjectId,
				openAiApiKey,
				ollamaApiKey,
				planModeOllamaModelId,
				planModeLmStudioModelId,
				actModeOllamaModelId,
				actModeLmStudioModelId,
				liteLlmApiKey,
				geminiApiKey,
				openAiNativeApiKey,
				deepSeekApiKey,
				requestyApiKey,
				togetherApiKey,
				qwenApiKey,
				doubaoApiKey,
				mistralApiKey,
				planModeVsCodeLmModelSelector,
				actModeVsCodeLmModelSelector,
				clineAccountId,
				asksageApiKey,
				xaiApiKey,
				novitaApiKey,
				sambanovaApiKey,
				sapAiCoreClientId,
				difyApiKey,
				hicapApiKey,
				openAiCodexCredentials,
			].some((key) => key !== undefined)

			// Set welcomeViewCompleted based on whether user has keys
			await context.globalState.update("welcomeViewCompleted", hasKey)

			Logger.log(`Migration: Set welcomeViewCompleted to ${hasKey} based on existing API keys`)
		}
	} catch (error) {
		Logger.error("Failed to migrate welcomeViewCompleted:", error)
		// Continue execution - migration failure shouldn't break extension startup
	}
}

export async function cleanupMcpMarketplaceCatalogFromGlobalState(context: vscode.ExtensionContext) {
	try {
		// Check if mcpMarketplaceCatalog exists in global state
		const mcpMarketplaceCatalog = await context.globalState.get("mcpMarketplaceCatalog")

		if (mcpMarketplaceCatalog !== undefined) {
			Logger.log("Cleaning up mcpMarketplaceCatalog from global state...")

			// Delete it from global state
			await context.globalState.update("mcpMarketplaceCatalog", undefined)

			Logger.log("Successfully removed mcpMarketplaceCatalog from global state")
		}
	} catch (error) {
		Logger.error("Failed to cleanup mcpMarketplaceCatalog from global state:", error)
		// Continue execution - cleanup failure shouldn't break extension startup
	}
}

export async function cleanupOldApiKey(context: vscode.ExtensionContext) {
	try {
		// Old API Keys were introduced in March 2025 and later replaced with tokens
		// Now that we have new API keys that are prefixed with `sk_`,
		// we need to clean up the old ones to free the secret storage
		await context.secrets.delete("clineApiKey")
	} catch (error) {
		Logger.error("Failed to cleanup old clineApiKey", error)
	}
}
