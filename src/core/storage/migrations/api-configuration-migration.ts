import * as vscode from "vscode"
import { ApiConfiguration } from "@shared/api"
import { getAllExtensionState, updateApiConfiguration } from "../state"
import { PROVIDER_FIELD_MAPPINGS } from "../provider-field-mappings"

// Define a type that represents the legacy flat structure
// This allows us to access the old properties while migrating
interface LegacyApiConfiguration {
	// Core properties
	apiProvider?: string
	apiModelId?: string
	apiKey?: string // anthropic (legacy)

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
	requestTimeoutMs?: number
}

/**
 * Migration version identifier
 * Increment this when adding new migrations
 *
 * Version 1: Migrate from flat API configuration structure to nested provider-specific structure
 * This migration uses PROVIDER_FIELD_MAPPINGS to dynamically handle all providers,
 * making it more maintainable and ensuring new providers are automatically supported.
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

	// Check if API config already has the nested structure by looking for key indicators
	// We'll check a few representative providers to determine if migration is needed

	// Anthropic (use legacy apiKey as indicator)
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

	// Check for any other legacy fields that might indicate migration is needed
	// This is a more comprehensive check using the provider field mappings
	for (const [providerName, mapping] of Object.entries(PROVIDER_FIELD_MAPPINGS)) {
		// Check if any legacy fields exist but the nested structure doesn't
		const hasLegacyFields =
			("secrets" in mapping &&
				mapping.secrets &&
				Object.values(mapping.secrets).some((legacyKey) => (legacyConfig as any)[legacyKey])) ||
			("globalState" in mapping &&
				mapping.globalState &&
				Object.values(mapping.globalState).some((legacyKey) => (legacyConfig as any)[legacyKey]))

		const hasNestedStructure = (apiConfig as any)[providerName] && Object.keys((apiConfig as any)[providerName]).length > 0

		if (hasLegacyFields && !hasNestedStructure) {
			return true
		}
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
	const updatedConfig: any = {
		...apiConfig, // Keep all original properties for backward compatibility
	}

	// Dynamically build nested provider configurations using PROVIDER_FIELD_MAPPINGS
	for (const [providerName, mapping] of Object.entries(PROVIDER_FIELD_MAPPINGS)) {
		const providerConfig: any = {}

		// Handle secrets fields
		if ("secrets" in mapping && mapping.secrets) {
			for (const [fieldName, legacyKey] of Object.entries(mapping.secrets)) {
				const value = (legacyConfig as any)[legacyKey]
				if (value !== undefined) {
					providerConfig[fieldName] = value
				}
			}
		}

		// Handle global state fields
		if ("globalState" in mapping && mapping.globalState) {
			for (const [fieldName, legacyKey] of Object.entries(mapping.globalState)) {
				const value = (legacyConfig as any)[legacyKey]
				if (value !== undefined) {
					providerConfig[fieldName] = value
				}
			}
		}

		// Only add the provider config if it has any fields
		if (Object.keys(providerConfig).length > 0) {
			updatedConfig[providerName] = providerConfig
		}
	}

	// Handle special case for anthropic legacy apiKey
	if (legacyConfig.apiKey && !updatedConfig.anthropic?.apiKey) {
		if (!updatedConfig.anthropic) {
			updatedConfig.anthropic = {}
		}
		updatedConfig.anthropic.apiKey = legacyConfig.apiKey
	}

	// Preserve core configuration properties
	updatedConfig.apiProvider = legacyConfig.apiProvider
	updatedConfig.apiModelId = legacyConfig.apiModelId
	updatedConfig.thinkingBudgetTokens = legacyConfig.thinkingBudgetTokens
	updatedConfig.reasoningEffort = legacyConfig.reasoningEffort
	updatedConfig.requestTimeoutMs = legacyConfig.requestTimeoutMs

	// Note: favoritedModelIds is NOT part of API configuration - it's stored separately as global state
	// and doesn't need to be migrated here since it was never part of the flat API config structure

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
