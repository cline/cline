import * as vscode from "vscode"
import { ApiConfiguration } from "@shared/api"
import { getAllExtensionState, updateApiConfiguration } from "../state"

// Define a type that represents the legacy flat structure
// This allows us to access the old properties while migrating
interface LegacyApiConfiguration {
	// Core properties
	apiProvider?: string
	apiModelId?: string
	apiKey?: string // anthropic

	// OpenRouter properties
	openRouterApiKey?: string
	openRouterModelId?: string
	openRouterModelInfo?: any
	openRouterProviderSorting?: string

	// OpenAI properties
	openAiBaseUrl?: string
	openAiApiKey?: string
	openAiModelId?: string
	openAiModelInfo?: any
	openAiHeaders?: Record<string, string>

	// OpenAI Native properties
	openAiNativeApiKey?: string

	// AWS properties
	awsAccessKey?: string
	awsSecretKey?: string
	awsSessionToken?: string
	awsRegion?: string
	awsUseCrossRegionInference?: boolean
	awsBedrockUsePromptCache?: boolean
	awsBedrockEndpoint?: string
	awsProfile?: string
	awsUseProfile?: boolean
	awsBedrockCustomSelected?: boolean
	awsBedrockCustomModelBaseId?: string

	// Vertex properties
	vertexProjectId?: string
	vertexRegion?: string

	// Anthropic properties
	anthropicBaseUrl?: string

	// Ollama properties
	ollamaModelId?: string
	ollamaBaseUrl?: string
	ollamaApiOptionsCtxNum?: string

	// LM Studio properties
	lmStudioModelId?: string
	lmStudioBaseUrl?: string

	// Gemini properties
	geminiApiKey?: string
	geminiBaseUrl?: string

	// LiteLLM properties
	liteLlmBaseUrl?: string
	liteLlmModelId?: string
	liteLlmApiKey?: string
	liteLlmUsePromptCache?: boolean
	liteLlmModelInfo?: any

	// Requesty properties
	requestyApiKey?: string
	requestyModelId?: string
	requestyModelInfo?: any

	// Fireworks properties
	fireworksApiKey?: string
	fireworksModelId?: string
	fireworksModelMaxCompletionTokens?: number
	fireworksModelMaxTokens?: number

	// Together properties
	togetherApiKey?: string
	togetherModelId?: string

	// DeepSeek properties
	deepSeekApiKey?: string

	// Qwen properties
	qwenApiKey?: string
	qwenApiLine?: string

	// Doubao properties
	doubaoApiKey?: string

	// Mistral properties
	mistralApiKey?: string

	// Azure properties
	azureApiVersion?: string

	// VSCode LM properties
	vsCodeLmModelSelector?: any

	// Nebius properties
	nebiusApiKey?: string

	// AskSage properties
	asksageApiKey?: string
	asksageApiUrl?: string

	// XAI properties
	xaiApiKey?: string

	// SambaNova properties
	sambanovaApiKey?: string

	// Cerebras properties
	cerebrasApiKey?: string

	// Cline properties
	clineApiKey?: string

	// General settings
	thinkingBudgetTokens?: number
	reasoningEffort?: string
	favoritedModelIds?: string[]
	requestTimeoutMs?: number
}

/**
 * Migration version identifier
 * Increment this when adding new migrations
 */
export const API_CONFIG_SCHEMA_VERSION = 1

/**
 * Checks if API configuration migration is needed
 * @param apiConfig Current API configuration
 * @returns true if migration is needed, false otherwise
 */
export function needsApiConfigMigration(apiConfig: any): boolean {
	// If no API configuration exists, no migration needed
	if (!apiConfig) {
		return false
	}

	// Cast to legacy type to access old properties
	const legacyConfig = apiConfig as LegacyApiConfiguration

	// Check if API config already has the nested structure
	// by looking for a few key nested properties

	// Check if old format exists but new nested format doesn't

	// Anthropic (use apiKey as indicator)
	if (legacyConfig.apiKey && !apiConfig.anthropic?.apiKey) {
		return true
	}

	// OpenRouter
	if (legacyConfig.openRouterApiKey && !apiConfig.openrouter?.apiKey) {
		return true
	}

	// OpenAI
	if (legacyConfig.openAiApiKey && !apiConfig.openai?.apiKey) {
		return true
	}

	// AWS Bedrock
	if (legacyConfig.awsAccessKey && !apiConfig.aws?.accessKey) {
		return true
	}

	// Ollama
	if (legacyConfig.ollamaModelId && !apiConfig.ollama?.modelId) {
		return true
	}

	// If none of the above conditions match, migration is not needed
	return false
}

/**
 * Migrates API configuration from flat structure to nested structure
 * Preserves original values for backward compatibility
 * @param context VSCode extension context
 * @returns Promise that resolves when migration is complete
 */
export async function migrateApiConfiguration(context: vscode.ExtensionContext): Promise<void> {
	// Get all existing state
	const state = await getAllExtensionState(context)
	const apiConfig = state.apiConfiguration

	// Check if migration is needed
	if (!needsApiConfigMigration(apiConfig)) {
		console.log("[Migration] API configuration migration not needed")
		return
	}

	// Cast to legacy type to access old properties
	const legacyConfig = apiConfig as LegacyApiConfiguration

	console.log("[Migration] Migrating API configuration from flat to nested structure")

	// Create the new nested structure while preserving old values
	const updatedConfig = {
		...apiConfig, // Keep all original properties for backward compatibility

		// Add nested properties
		anthropic: {
			apiKey: legacyConfig.apiKey,
			baseUrl: legacyConfig.anthropicBaseUrl,
		},

		openrouter: {
			apiKey: legacyConfig.openRouterApiKey,
			modelId: legacyConfig.openRouterModelId,
			modelInfo: legacyConfig.openRouterModelInfo,
			providerSorting: legacyConfig.openRouterProviderSorting,
		},

		openai: {
			apiKey: legacyConfig.openAiApiKey,
			modelId: legacyConfig.openAiModelId,
			modelInfo: legacyConfig.openAiModelInfo,
			baseUrl: legacyConfig.openAiBaseUrl,
			headers: legacyConfig.openAiHeaders,
		},

		openaiNative: {
			apiKey: legacyConfig.openAiNativeApiKey,
		},

		aws: {
			accessKey: legacyConfig.awsAccessKey,
			secretKey: legacyConfig.awsSecretKey,
			sessionToken: legacyConfig.awsSessionToken,
			region: legacyConfig.awsRegion,
			useCrossRegionInference: legacyConfig.awsUseCrossRegionInference,
			bedrockUsePromptCache: legacyConfig.awsBedrockUsePromptCache,
			bedrockEndpoint: legacyConfig.awsBedrockEndpoint,
			profile: legacyConfig.awsProfile,
			useProfile: legacyConfig.awsUseProfile,
			bedrockCustomSelected: legacyConfig.awsBedrockCustomSelected,
			bedrockCustomModelBaseId: legacyConfig.awsBedrockCustomModelBaseId,
		},

		vertex: {
			projectId: legacyConfig.vertexProjectId,
			region: legacyConfig.vertexRegion,
		},

		ollama: {
			modelId: legacyConfig.ollamaModelId,
			baseUrl: legacyConfig.ollamaBaseUrl,
			apiOptionsCtxNum: legacyConfig.ollamaApiOptionsCtxNum,
		},

		lmstudio: {
			modelId: legacyConfig.lmStudioModelId,
			baseUrl: legacyConfig.lmStudioBaseUrl,
		},

		gemini: {
			apiKey: legacyConfig.geminiApiKey,
			baseUrl: legacyConfig.geminiBaseUrl,
		},

		litellm: {
			apiKey: legacyConfig.liteLlmApiKey,
			modelId: legacyConfig.liteLlmModelId,
			baseUrl: legacyConfig.liteLlmBaseUrl,
			modelInfo: legacyConfig.liteLlmModelInfo,
			usePromptCache: legacyConfig.liteLlmUsePromptCache,
		},

		fireworks: {
			apiKey: legacyConfig.fireworksApiKey,
			modelId: legacyConfig.fireworksModelId,
			modelMaxCompletionTokens: legacyConfig.fireworksModelMaxCompletionTokens,
			modelMaxTokens: legacyConfig.fireworksModelMaxTokens,
		},

		requesty: {
			apiKey: legacyConfig.requestyApiKey,
			modelId: legacyConfig.requestyModelId,
			modelInfo: legacyConfig.requestyModelInfo,
		},

		together: {
			apiKey: legacyConfig.togetherApiKey,
			modelId: legacyConfig.togetherModelId,
		},

		deepseek: {
			apiKey: legacyConfig.deepSeekApiKey,
		},

		qwen: {
			apiKey: legacyConfig.qwenApiKey,
			apiLine: legacyConfig.qwenApiLine,
		},

		doubao: {
			apiKey: legacyConfig.doubaoApiKey,
		},

		mistral: {
			apiKey: legacyConfig.mistralApiKey,
		},

		azure: {
			apiVersion: legacyConfig.azureApiVersion,
		},

		vscode: {
			modelSelector: legacyConfig.vsCodeLmModelSelector,
		},

		nebius: {
			apiKey: legacyConfig.nebiusApiKey,
		},

		asksage: {
			apiKey: legacyConfig.asksageApiKey,
			apiUrl: legacyConfig.asksageApiUrl,
		},

		xai: {
			apiKey: legacyConfig.xaiApiKey,
		},

		sambanova: {
			apiKey: legacyConfig.sambanovaApiKey,
		},

		cerebras: {
			apiKey: legacyConfig.cerebrasApiKey,
		},

		cline: {
			apiKey: legacyConfig.clineApiKey,
		},

		// Preserve core configuration properties
		apiProvider: legacyConfig.apiProvider,
		apiModelId: legacyConfig.apiModelId,
		thinkingBudgetTokens: legacyConfig.thinkingBudgetTokens,
		reasoningEffort: legacyConfig.reasoningEffort,
		favoritedModelIds: legacyConfig.favoritedModelIds,
		requestTimeoutMs: legacyConfig.requestTimeoutMs,
	}

	// Remove undefined properties to keep the object clean
	Object.keys(updatedConfig).forEach((key) => {
		const nestedConfig = (updatedConfig as any)[key]
		if (nestedConfig && typeof nestedConfig === "object") {
			Object.keys(nestedConfig).forEach((nestedKey) => {
				if (nestedConfig[nestedKey] === undefined) {
					delete nestedConfig[nestedKey]
				}
			})

			// If the nested object is empty, remove it
			if (Object.keys(nestedConfig).length === 0) {
				delete (updatedConfig as any)[key]
			}
		}
	})

	// Update the state with the new nested configuration
	// This keeps the old properties but adds the new nested ones
	// Use 'as ApiConfiguration' to force the type and handle AWS specific enum types
	await updateApiConfiguration(context, updatedConfig as ApiConfiguration)

	console.log("[Migration] API configuration migration completed successfully")
}

/**
 * Runs all necessary migrations based on the current schema version
 * @param context VSCode extension context
 * @param forceRun Force migrations to run regardless of schema version (useful for testing)
 * @returns Promise that resolves when all migrations are complete
 */
export async function runMigrations(context: vscode.ExtensionContext, forceRun: boolean = false): Promise<void> {
	try {
		// Get current schema version
		const currentSchemaVersion = context.globalState.get<number>("apiConfigSchemaVersion") || 0

		// Check if we should force run migrations for development/testing
		const isDevMode = process.env.IS_DEV === "true"
		const shouldForceRun = forceRun || isDevMode

		// Run migrations if needed or if force run is enabled
		if (currentSchemaVersion < API_CONFIG_SCHEMA_VERSION || shouldForceRun) {
			if (shouldForceRun) {
				console.log(`[Migration] DEVELOPMENT MODE: Forcing migration run regardless of schema version`)
			} else {
				console.log(
					`[Migration] Running migrations from schema version ${currentSchemaVersion} to ${API_CONFIG_SCHEMA_VERSION}`,
				)
			}

			// Always run API configuration migration in dev mode or if needed in production
			if (shouldForceRun || currentSchemaVersion < 1) {
				await migrateApiConfiguration(context)
			}

			// Update schema version (even in dev mode to maintain expected behavior)
			await context.globalState.update("apiConfigSchemaVersion", API_CONFIG_SCHEMA_VERSION)
			console.log(`[Migration] Schema version updated to ${API_CONFIG_SCHEMA_VERSION}`)
		} else {
			console.log(`[Migration] No migrations needed. Current schema version: ${currentSchemaVersion}`)
		}
	} catch (error) {
		console.error("[Migration] Error during migration:", error)
		// Don't rethrow error to prevent extension activation failure
	}
}
