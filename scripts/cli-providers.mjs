#!/usr/bin/env node

/**
 * CLI Provider Definition Generator
 * ==================================
 *
 * This script generates Go code for the CLI version of Cline by extracting provider
 * metadata from the TypeScript source (src/shared/api.ts) and converting it to Go
 * structs. It serves as the bridge between the VSCode extension's TypeScript API
 * definitions and the CLI's Go-based setup wizard.
 *
 * Purpose:
 * --------
 * - Extract provider configurations, API key requirements, and model definitions
 * - Filter to only include whitelisted providers (ENABLED_PROVIDERS constant)
 * - Generate type-safe Go code with embedded JSON data
 * - Keep the CLI binary lean by excluding unused providers
 *
 * What it generates:
 * ------------------
 * - cli/pkg/generated/providers.go - Go structs and constants for provider metadata
 * - Includes: Provider constants, config fields, model definitions, helper functions
 *
 * How it works:
 * -------------
 * 1. Parses TypeScript API definitions from src/shared/api.ts
 * 2. Extracts provider IDs, configuration fields, and model information
 * 3. Filters config fields and models to only include ENABLED_PROVIDERS
 * 4. Generates Go code with JSON-embedded data for runtime access
 * 5. Includes comprehensive documentation in the generated file
 *
 * Data Filtering:
 * ---------------
 * - Provider list: Filtered to ENABLED_PROVIDERS (currently 9 of 36 providers)
 * - Config fields: Only includes fields where category matches a whitelisted provider
 * - Model definitions: Only includes model maps for whitelisted providers
 * - Result: Non-whitelisted provider data never makes it into the CLI binary
 *
 * Usage:
 * ------
 * npm run cli-providers
 *
 * To modify which providers are included:
 * 1. Edit the ENABLED_PROVIDERS array below
 * 2. Run: npm run cli-providers
 * 3. Verify the output in cli/pkg/generated/providers.go
 *
 * Dependencies:
 * -------------
 * - api-secrets-parser.mjs - Helper module for parsing API key fields
 * - src/shared/api.ts - Source of truth for provider definitions
 *
 * Output:
 * -------
 * The generated Go file includes:
 * - Type definitions (ConfigField, ModelInfo, ProviderDefinition)
 * - Provider constants and AllProviders array
 * - Embedded JSON data for config fields and model definitions
 * - Helper functions for querying provider metadata
 * - Comprehensive documentation for developers
 */

import chalk from "chalk"
import * as fs from "fs/promises"
import * as path from "path"
import { fileURLToPath } from "url"

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..")
const API_DEFINITIONS_FILE = path.resolve(ROOT_DIR, "src", "shared", "api.ts")
const GO_OUTPUT_FILE = path.resolve(ROOT_DIR, "cli", "pkg", "generated", "providers.go")

/**
 * ENABLED_PROVIDERS - Controls which providers are included in the CLI build
 *
 * This list determines which providers from src/shared/api.ts will be included
 * in the generated Go code for the CLI version. This allows us to keep the CLI
 * lean by only including the most commonly used providers.
 *
 * To add or remove providers:
 * 1. Add/remove the provider ID from this array (must match ApiProvider values)
 * 2. Run: npm run cli-providers (or node scripts/cli-providers.mjs)
 * 3. Verify the output in cli/pkg/generated/providers.go
 *
 * Provider IDs must match exactly as defined in the ApiProvider type in api.ts
 */
const ENABLED_PROVIDERS = [
	"anthropic", // Anthropic Claude models
	"openai", // OpenAI-compatible providers
	"openai-native", // OpenAI official API
	"openrouter", // OpenRouter meta-provider
	"xai", // X AI (Grok)
	"bedrock", // AWS Bedrock
	"gemini", // Google Gemini
	"ollama", // Ollama local models
	"cerebras", // Cerebras models
	"oca", // Oracle Code Assist
	"nousResearch", // NousResearch provider
]

/**
 * Extract default model IDs from TypeScript source
 * Uses multiple regex patterns to catch different variable declaration styles
 */
function extractDefaultModelIds(content) {
	const defaultIds = {}

	// Multiple regex patterns to handle different TypeScript patterns
	const patterns = [
		// Pattern 1: With type annotation - export const anthropicDefaultModelId: AnthropicModelId = "model-id"
		/export const (\w+)DefaultModelId\s*:\s*\w+\s*=\s*"([^"]+)"/g,
		// Pattern 2: Without type annotation - export const anthropicDefaultModelId = "model-id"
		/export const (\w+)DefaultModelId\s*=\s*"([^"]+)"/g,
		// Pattern 3: Without export - const anthropicDefaultModelId = "model-id"
		/const (\w+)DefaultModelId\s*=\s*"([^"]+)"/g,
	]

	for (const regex of patterns) {
		// Reset regex state for each pattern
		regex.lastIndex = 0
		let match

		while ((match = regex.exec(content)) !== null) {
			const [, providerPrefix, modelId] = match
			// Map prefix to provider ID (e.g., "anthropic" -> "anthropic", "openAiNative" -> "openai-native")
			const providerId = providerPrefix
				.replace(/([A-Z])/g, "-$1")
				.toLowerCase()
				.replace(/^-/, "")

			// Don't overwrite if already found (first match wins)
			if (!defaultIds[providerId]) {
				// Clean up model ID - remove any suffix like ":1m"
				const cleanModelId = modelId.split(":")[0]
				defaultIds[providerId] = cleanModelId
			}
		}
	}

	return defaultIds
}

/**
 * Parse TypeScript API definitions and extract provider information
 */
async function parseApiDefinitions() {
	console.log(chalk.cyan("Reading TypeScript API definitions..."))

	const content = await fs.readFile(API_DEFINITIONS_FILE, "utf-8")

	// Extract ApiProvider type definition
	const providerTypeMatch = content.match(/export type ApiProvider =\s*([\s\S]*?)(?=\n\nexport|\n\ninterface|\ninterface)/m)
	if (!providerTypeMatch) {
		throw new Error("Could not find ApiProvider type definition")
	}

	// Parse provider IDs from the union type
	const providerTypeContent = providerTypeMatch[1]
	const providerIds = []
	const providerMatches = providerTypeContent.matchAll(/\|\s*"([^"]+)"/g)
	for (const match of providerMatches) {
		providerIds.push(match[1])
	}

	// Also get the first provider (without |)
	const firstProviderMatch = providerTypeContent.match(/"([^"]+)"/)
	if (firstProviderMatch && !providerIds.includes(firstProviderMatch[1])) {
		providerIds.unshift(firstProviderMatch[1])
	}

	console.log(
		chalk.green(
			`Found ${providerIds.length} total providers: ${providerIds.slice(0, 5).join(", ")}${providerIds.length > 5 ? "..." : ""}`,
		),
	)

	// Filter to only enabled providers
	const totalProvidersFound = providerIds.length
	const filteredProviderIds = providerIds.filter((id) => ENABLED_PROVIDERS.includes(id))
	const disabledCount = totalProvidersFound - filteredProviderIds.length

	console.log(chalk.cyan(`Filtering to ${filteredProviderIds.length} enabled providers (${disabledCount} disabled)`))
	console.log(chalk.green(`   Enabled: ${filteredProviderIds.join(", ")}`))

	// Validate that all enabled providers exist in the source
	const missingProviders = ENABLED_PROVIDERS.filter((id) => !providerIds.includes(id))
	if (missingProviders.length > 0) {
		console.log(
			chalk.yellow(
				`   WARNING: ${missingProviders.length} enabled provider(s) not found in api.ts: ${missingProviders.join(", ")}`,
			),
		)
	}

	// Parse ApiHandlerSecrets to auto-discover API key fields
	const { parseApiHandlerSecrets, mapProviderToApiKeys, validateApiKeyMappings } = await import("./api-secrets-parser.mjs")
	const apiSecretsFields = parseApiHandlerSecrets(content)
	const providerApiKeyMap = mapProviderToApiKeys(providerIds, apiSecretsFields)

	// Validate the mapping
	const validation = validateApiKeyMappings(providerIds, providerApiKeyMap)
	console.log(chalk.green(`   Mapped API keys for ${validation.mappedProviders}/${validation.totalProviders} providers`))
	if (validation.warnings.length > 0) {
		validation.warnings.forEach((warning) => console.log(chalk.yellow(`   ${warning}`)))
	}

	// Extract ApiHandlerOptions interface to understand configuration fields
	const optionsMatch = content.match(/export interface ApiHandlerOptions \{([\s\S]*?)\}/m)
	if (!optionsMatch) {
		throw new Error("Could not find ApiHandlerOptions interface")
	}

	const optionsContent = optionsMatch[1]
	const configFields = parseConfigurationFields(optionsContent, providerApiKeyMap, apiSecretsFields)

	// Extract model definitions for each provider
	const modelDefinitions = extractModelDefinitions(content)

	// Extract default model IDs from TypeScript constants
	const defaultModelIds = extractDefaultModelIds(content)

	console.log(chalk.green(`   Extracted ${Object.keys(defaultModelIds).length} default model IDs`))

	// Filter config fields to only include whitelisted providers
	const filteredConfigFields = configFields.filter(
		(field) =>
			// Include fields for whitelisted providers
			filteredProviderIds.includes(field.category) ||
			// Include general fields that apply to all providers
			field.category === "general",
	)

	// Filter model definitions to only include whitelisted providers
	const filteredModelDefinitions = Object.fromEntries(
		Object.entries(modelDefinitions).filter(([providerId]) => filteredProviderIds.includes(providerId)),
	)

	console.log(
		chalk.cyan(
			`   Filtered config fields: ${configFields.length} -> ${filteredConfigFields.length} (${configFields.length - filteredConfigFields.length} excluded)`,
		),
	)
	console.log(
		chalk.cyan(
			`   Filtered model definitions: ${Object.keys(modelDefinitions).length} -> ${Object.keys(filteredModelDefinitions).length} (${Object.keys(modelDefinitions).length - Object.keys(filteredModelDefinitions).length} excluded)`,
		),
	)

	return {
		providers: filteredProviderIds,
		configFields: filteredConfigFields,
		modelDefinitions: filteredModelDefinitions,
		defaultModelIds,
		providerApiKeyMap,
	}
}

/**
 * Parse configuration fields from ApiHandlerOptions and ApiHandlerSecrets
 */
function parseConfigurationFields(optionsContent, providerApiKeyMap, apiSecretsFields) {
	const fields = []

	// FIRST: Add API key fields from ApiHandlerSecrets
	// These are the actual authentication fields that need to be collected
	for (const fieldName of apiSecretsFields.fieldNames) {
		const fieldInfo = apiSecretsFields.fields[fieldName]
		const lowerName = fieldName.toLowerCase()

		// Determine which provider this field belongs to
		let category = "general"
		for (const [providerId, apiKeys] of Object.entries(providerApiKeyMap)) {
			if (apiKeys.includes(fieldName)) {
				category = providerId
				break
			}
		}

		// All API key fields are required for their respective provider
		const required = true
		const fieldType = "password"
		const placeholder = "Enter your API key"

		fields.push({
			name: fieldName,
			type: fieldInfo.type,
			comment: fieldInfo.comment || "",
			category,
			required,
			fieldType,
			placeholder,
		})
	}

	// SECOND: Add configuration fields from ApiHandlerOptions
	// Match field definitions like: fieldName?: type // comment
	const fieldMatches = optionsContent.matchAll(/^\s*([a-zA-Z][a-zA-Z0-9_]*)\?\s*:\s*([^/\n]+)(?:\/\/\s*(.*))?$/gm)

	for (const match of fieldMatches) {
		const [, name, type, comment] = match

		// Skip mode-specific fields (we'll handle those separately)
		if (name.includes("planMode") || name.includes("actMode")) {
			continue
		}

		const lowerName = name.toLowerCase()

		// Determine field category based on provider-specific prefixes FIRST
		let category = "general"
		let required = false
		let fieldType = "string"
		let placeholder = ""

		// Check for provider-specific prefixes to categorize appropriately
		const providerPrefixes = [
			"anthropic",
			"openrouter",
			"aws",
			"bedrock",
			"vertex",
			"openai",
			"ollama",
			"lmstudio",
			"gemini",
			"deepseek",
			"qwen",
			"doubao",
			"mistral",
			"litellm",
			"moonshot",
			"nebius",
			"fireworks",
			"asksage",
			"xai",
			"sambanova",
			"cerebras",
			"sapaicore",
			"groq",
			"huggingface",
			"huawei",
			"dify",
			"baseten",
			"vercel",
			"zai",
			"requesty",
			"together",
			"claudecode",
			"cline",
		]

		// If field name starts with or contains a provider prefix, categorize it as provider-specific
		for (const prefix of providerPrefixes) {
			if (lowerName.startsWith(prefix) || lowerName.includes(prefix)) {
				category = prefix
				break
			}
		}

		// Set field type metadata for UI rendering
		if (lowerName.includes("apikey")) {
			fieldType = "password"
			placeholder = "Enter your API key"
		} else if (lowerName.includes("key") && !lowerName.includes("apikey")) {
			fieldType = "password"
			placeholder = "Enter your key"
		} else if (lowerName.includes("url") || lowerName.includes("endpoint")) {
			fieldType = "url"
			placeholder = "https://api.example.com"
		} else if (lowerName.includes("region")) {
			fieldType = "select"
		} else if (lowerName.includes("model")) {
			// model fields stay with their provider category
		}

		// Check if this field is required for any provider using the auto-discovered API key map
		// A field is marked as required if it appears in any provider's required fields list
		for (const [providerId, requiredFields] of Object.entries(providerApiKeyMap)) {
			if (requiredFields.includes(name)) {
				required = true
				break
			}
		}

		fields.push({
			name,
			type: type.trim(),
			comment: comment?.trim() || "",
			category,
			required,
			fieldType,
			placeholder,
		})
	}

	return fields
}

/**
 * Extract model definitions for each provider
 */
function extractModelDefinitions(content) {
	const modelDefinitions = {}

	// Find all model constant definitions like: export const anthropicModels = {
	const modelMatches = content.matchAll(/export const (\w+)Models = \{([\s\S]*?)\} as const/g)

	for (const match of modelMatches) {
		const [, providerPrefix, modelsContent] = match

		// Parse individual model entries
		const models = {}
		const modelEntryMatches = modelsContent.matchAll(/"([^"]+)":\s*\{([\s\S]*?)\},?/g)

		for (const modelMatch of modelEntryMatches) {
			const [, modelId, modelContent] = modelMatch

			// Parse model properties
			const modelInfo = parseModelInfo(modelContent)
			models[modelId] = modelInfo
		}

		// Map provider prefix to actual provider ID
		const providerMapping = {
			anthropic: "anthropic",
			claudeCode: "claude-code",
			bedrock: "bedrock",
			vertex: "vertex",
			openAiNative: "openai-native",
			gemini: "gemini",
			deepSeek: "deepseek",
			huggingFace: "huggingface",
			qwen: "qwen",
			doubao: "doubao",
			mistral: "mistral",
			xai: "xai",
			sambanova: "sambanova",
			cerebras: "cerebras",
			sapAiCore: "sapaicore",
			moonshot: "moonshot",
			huaweiCloudMaas: "huawei-cloud-maas",
			baseten: "baseten",
			fireworks: "fireworks",
			groq: "groq",
			nebius: "nebius",
			askSage: "asksage",
			qwenCode: "qwen-code",
		}

		const providerId = providerMapping[providerPrefix] || providerPrefix.toLowerCase()
		if (Object.keys(models).length > 0) {
			modelDefinitions[providerId] = models
		}
	}

	return modelDefinitions
}

/**
 * Parse model information from model definition content
 */
function parseModelInfo(modelContent) {
	const info = {}

	// Parse numeric properties
	const numericProps = ["maxTokens", "contextWindow", "inputPrice", "outputPrice", "cacheWritesPrice", "cacheReadsPrice"]
	for (const prop of numericProps) {
		const match = modelContent.match(new RegExp(`${prop}:\\s*([0-9_,]+)`))
		if (match) {
			info[prop] = parseInt(match[1].replace(/[_,]/g, ""), 10)
		}
	}

	// Parse boolean properties
	const booleanProps = ["supportsImages", "supportsPromptCache"]
	for (const prop of booleanProps) {
		const match = modelContent.match(new RegExp(`${prop}:\\s*(true|false)`))
		if (match) {
			info[prop] = match[1] === "true"
		}
	}

	// Parse description
	const descMatch = modelContent.match(/description:\s*"([^"]*)"/)
	if (descMatch) {
		info.description = descMatch[1]
	}

	return info
}

/**
 * Generate Go structs from parsed data
 */
function generateGoCode(data) {
	console.log(chalk.cyan("Generating Go code..."))

	const { providers, configFields, modelDefinitions } = data

	// Generate provider constants
	const providerConstants = providers.map((p) => `\t${p.toUpperCase().replace(/-/g, "_")} = "${p}"`).join("\n")

	// Generate configuration field definitions
	const configFieldsJson = JSON.stringify(configFields, null, 2)
		.split("\n")
		.map((line) => `\t${line}`)
		.join("\n")

	// Generate model definitions
	const modelDefinitionsJson = JSON.stringify(modelDefinitions, null, 2)
		.split("\n")
		.map((line) => `\t${line}`)
		.join("\n")

	// Generate provider metadata
	const providerMetadata = generateProviderMetadata(providers, configFields, modelDefinitions, data.defaultModelIds)

	return `// AUTO-GENERATED FILE - DO NOT MODIFY DIRECTLY
// Generated by scripts/generate-provider-definitions.mjs
// Source: src/shared/api.ts
//
// ============================================================================
// DATA CONTRACT & DOCUMENTATION
// ============================================================================
//
// This file provides structured provider metadata extracted from TypeScript source.
// It serves as the bridge between the VSCode extension's TypeScript API definitions
// and the CLI's Go-based setup wizard.
//
// CORE STRUCTURES
// ===============
//
// ConfigField: Individual configuration fields with type, category, and validation metadata
//   - Name:        Field name as it appears in ApiHandlerOptions (e.g., "cerebrasApiKey")
//   - Type:        TypeScript type (e.g., "string", "number")
//   - Comment:     Inline comment from TypeScript source
//   - Category:    Provider categorization (e.g., "cerebras", "general")
//   - Required:    Whether this field MUST be collected for any provider
//   - FieldType:   UI field type hint ("password", "url", "string", "select")
//   - Placeholder: Suggested placeholder text for UI input
//
// ModelInfo: Model capabilities, pricing, and limits
//   - MaxTokens:         Maximum output tokens
//   - ContextWindow:     Total context window size
//   - SupportsImages:    Whether model accepts image inputs
//   - SupportsPromptCache: Whether model supports prompt caching
//   - InputPrice:        Cost per 1M input tokens (USD)
//   - OutputPrice:       Cost per 1M output tokens (USD)
//   - CacheWritesPrice:  Cost per 1M cached tokens written (USD)
//   - CacheReadsPrice:   Cost per 1M cached tokens read (USD)
//   - Description:       Human-readable model description
//
// ProviderDefinition: Complete provider metadata including required/optional fields
//   - ID:                Provider identifier (e.g., "cerebras", "anthropic")
//   - Name:              Human-readable display name (e.g., "Cerebras", "Anthropic (Claude)")
//   - RequiredFields:    Fields that MUST be collected (filtered by category + overrides)
//   - OptionalFields:    Fields that MAY be collected (filtered by category + overrides)
//   - Models:            Map of model IDs to ModelInfo
//   - DefaultModelID:    Recommended default model from TypeScript source
//   - HasDynamicModels:  Whether provider supports runtime model discovery
//   - SetupInstructions: User-facing setup guidance
//
// FIELD FILTERING LOGIC
// =====================
//
// Fields are categorized during parsing based on provider-specific prefixes in field names:
//   - "cerebrasApiKey" → category="cerebras"
//   - "awsAccessKey" → category="aws" (used by bedrock)
//   - "requestTimeoutMs" → category="general" (applies to all providers)
//
// The getFieldsByProvider() function filters fields using this priority:
//   1. Check field_overrides.go via GetFieldOverride() for manual corrections
//   2. Match field.Category against provider ID (primary filtering)
//   3. Apply hardcoded switch cases for complex provider relationships
//   4. Include universal fields (requestTimeoutMs, ulid, clineAccountId) for all providers
//
// Required vs Optional:
//   - Fields are marked as required if they appear in the providerRequiredFields map
//     in the generator script (scripts/generate-provider-definitions.mjs)
//   - getFieldsByProvider() respects the required parameter to separate required/optional
//
// MODEL SELECTION
// ===============
//
// DefaultModelID extraction priority:
//   1. Exact match from TypeScript constant (e.g., cerebrasDefaultModelId = "llama-3.3-70b")
//   2. Pattern matching on model IDs ("latest", "default", "sonnet", "gpt-4", etc.)
//   3. First model in the models map
//
// Models map contains full capability and pricing data extracted from TypeScript model
// definitions (e.g., cerebrasModels, anthropicModels).
//
// HasDynamicModels indicates providers that support runtime model discovery via API
// (e.g., OpenRouter, Ollama, LM Studio). For these providers, the models map may be
// incomplete or a representative sample.
//
// USAGE EXAMPLE
// =============
//
//   def, err := GetProviderDefinition("cerebras")
//   if err != nil {
//       return err
//   }
//
//   // Collect required fields from user
//   for _, field := range def.RequiredFields {
//       value := promptUser(field.Name, field.Placeholder, field.FieldType == "password")
//       config[field.Name] = value
//   }
//
//   // Use default model or let user choose
//   if def.DefaultModelID != "" {
//       config["modelId"] = def.DefaultModelID
//   }
//
// EXTENDING & OVERRIDING
// ======================
//
// DO NOT modify this generated file directly. Changes will be lost on regeneration.
//
// To fix incorrect field categorization:
//   - Edit cli/pkg/generated/field_overrides.go
//   - Add entries to GetFieldOverride() function
//   - Example: Force "awsSessionToken" to be relevant for "bedrock"
//
// To change required fields:
//   - Edit providerRequiredFields map in scripts/generate-provider-definitions.mjs
//   - Rerun: npm run generate-provider-definitions
//
// To add new providers:
//   - Add to ApiProvider type in src/shared/api.ts
//   - Add fields to ApiHandlerOptions with provider-specific prefixes
//   - Optionally add model definitions (e.g., export const newProviderModels = {...})
//   - Rerun generator
//
// To fix default model extraction:
//   - Ensure TypeScript source has: export const <provider>DefaultModelId = "model-id"
//   - Or update extractDefaultModelIds() patterns in generator script
//
// For upstream changes:
//   - Submit pull request to src/shared/api.ts in the main repository
//
// ============================================================================

package generated

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Provider constants
const (
${providerConstants}
)

// AllProviders returns a slice of enabled provider IDs for the CLI build.
// This is a filtered subset of all providers available in the VSCode extension.
// To modify which providers are included, edit ENABLED_PROVIDERS in scripts/cli-providers.mjs
var AllProviders = []string{
${providers.map((p) => `\t"${p}",`).join("\n")}
}

// ConfigField represents a configuration field requirement
type ConfigField struct {
	Name        string \`json:"name"\`
	Type        string \`json:"type"\`
	Comment     string \`json:"comment"\`
	Category    string \`json:"category"\`
	Required    bool   \`json:"required"\`
	FieldType   string \`json:"fieldType"\`
	Placeholder string \`json:"placeholder"\`
}

// ModelInfo represents model capabilities and pricing
type ModelInfo struct {
	MaxTokens        int     \`json:"maxTokens,omitempty"\`
	ContextWindow    int     \`json:"contextWindow,omitempty"\`
	SupportsImages   bool    \`json:"supportsImages"\`
	SupportsPromptCache bool \`json:"supportsPromptCache"\`
	InputPrice       float64 \`json:"inputPrice,omitempty"\`
	OutputPrice      float64 \`json:"outputPrice,omitempty"\`
	CacheWritesPrice float64 \`json:"cacheWritesPrice,omitempty"\`
	CacheReadsPrice  float64 \`json:"cacheReadsPrice,omitempty"\`
	Description      string  \`json:"description,omitempty"\`
}

// ProviderDefinition represents a provider's metadata and requirements
type ProviderDefinition struct {
	ID              string                 \`json:"id"\`
	Name            string                 \`json:"name"\`
	RequiredFields  []ConfigField          \`json:"requiredFields"\`
	OptionalFields  []ConfigField          \`json:"optionalFields"\`
	Models          map[string]ModelInfo   \`json:"models"\`
	DefaultModelID  string                 \`json:"defaultModelId"\`
	HasDynamicModels bool                  \`json:"hasDynamicModels"\`
	SetupInstructions string               \`json:"setupInstructions"\`
}

// Raw configuration fields data (parsed from TypeScript)
var rawConfigFields = \`${configFieldsJson.replace(/`/g, '` + "`" + `')}\`

// Raw model definitions data (parsed from TypeScript)
var rawModelDefinitions = \`${modelDefinitionsJson.replace(/`/g, '` + "`" + `')}\`

// GetConfigFields returns all configuration fields
func GetConfigFields() ([]ConfigField, error) {
	var fields []ConfigField
	if err := json.Unmarshal([]byte(rawConfigFields), &fields); err != nil {
		return nil, fmt.Errorf("failed to parse config fields: %w", err)
	}
	return fields, nil
}

// GetModelDefinitions returns all model definitions
func GetModelDefinitions() (map[string]map[string]ModelInfo, error) {
	var models map[string]map[string]ModelInfo
	if err := json.Unmarshal([]byte(rawModelDefinitions), &models); err != nil {
		return nil, fmt.Errorf("failed to parse model definitions: %w", err)
	}
	return models, nil
}

// GetProviderDefinition returns the definition for a specific provider
func GetProviderDefinition(providerID string) (*ProviderDefinition, error) {
	definitions, err := GetProviderDefinitions()
	if err != nil {
		return nil, err
	}
	
	def, exists := definitions[providerID]
	if !exists {
		return nil, fmt.Errorf("provider %s not found", providerID)
	}
	
	return &def, nil
}

// GetProviderDefinitions returns all provider definitions
func GetProviderDefinitions() (map[string]ProviderDefinition, error) {
	configFields, err := GetConfigFields()
	if err != nil {
		return nil, err
	}
	
	modelDefinitions, err := GetModelDefinitions()
	if err != nil {
		return nil, err
	}
	
	definitions := make(map[string]ProviderDefinition)
	
${providerMetadata}
	
	return definitions, nil
}

// IsValidProvider checks if a provider ID is valid
func IsValidProvider(providerID string) bool {
	for _, p := range AllProviders {
		if p == providerID {
			return true
		}
	}
	return false
}

// GetProviderDisplayName returns a human-readable name for a provider
func GetProviderDisplayName(providerID string) string {
	displayNames := map[string]string{
${providers.map((p) => `\t\t"${p}": "${getProviderDisplayName(p)}",`).join("\n")}
	}
	
	if name, exists := displayNames[providerID]; exists {
		return name
	}
	return providerID
}

// getFieldsByProvider filters configuration fields by provider and requirement
// Uses category field as primary filter with override support
func getFieldsByProvider(providerID string, allFields []ConfigField, required bool) []ConfigField {
	var fields []ConfigField
	
	for _, field := range allFields {
		fieldName := strings.ToLower(field.Name)
		fieldCategory := strings.ToLower(field.Category)
		providerName := strings.ToLower(providerID)
		
		isRelevant := false
		
		// Priority 1: Check manual overrides FIRST (from GetFieldOverride in this package)
		if override, hasOverride := GetFieldOverride(providerID, field.Name); hasOverride {
			isRelevant = override
		} else if fieldCategory == providerName {
			// Priority 2: Direct category match (primary filtering mechanism)
			isRelevant = true
		} else if fieldCategory == "aws" && providerID == "bedrock" {
			// Priority 3: Handle provider-specific category relationships
			// AWS fields are used by Bedrock provider
			isRelevant = true
		} else if fieldCategory == "openai" && providerID == "openai-native" {
			// OpenAI fields used by openai-native
			isRelevant = true
		} else if fieldCategory == "general" {
			// Priority 4: Universal fields that apply to all providers
			// Note: ulid is excluded as it's auto-generated and users should not set it
			universalFields := []string{"requesttimeoutms", "clineaccountid"}
			for _, universal := range universalFields {
				if fieldName == universal {
					isRelevant = true
					break
				}
			}
		}
		
		if isRelevant && field.Required == required {
			fields = append(fields, field)
		}
	}
	
	return fields
}
`
}

/**
 * Generate provider metadata for each provider
 */
function generateProviderMetadata(providers, configFields, modelDefinitions, defaultModelIds) {
	return providers
		.map((providerId) => {
			const displayName = getProviderDisplayName(providerId)
			const models = modelDefinitions[providerId] || {}
			const defaultModelId = getDefaultModelId(providerId, models, defaultModelIds)
			const hasDynamicModels = hasDynamicModelsSupport(providerId)
			const setupInstructions = getSetupInstructions(providerId)

			return `\t// ${displayName}
	definitions["${providerId}"] = ProviderDefinition{
		ID:              "${providerId}",
		Name:            "${displayName}",
		RequiredFields:  getFieldsByProvider("${providerId}", configFields, true),
		OptionalFields:  getFieldsByProvider("${providerId}", configFields, false),
		Models:          modelDefinitions["${providerId}"],
		DefaultModelID:  "${defaultModelId}",
		HasDynamicModels: ${hasDynamicModels},
		SetupInstructions: \`${setupInstructions}\`,
	}`
		})
		.join("\n\n")
}

/**
 * Get human-readable display name for a provider
 */
function getProviderDisplayName(providerId) {
	const displayNames = {
		anthropic: "Anthropic (Claude)",
		"claude-code": "Claude Code",
		openrouter: "OpenRouter",
		bedrock: "AWS Bedrock",
		vertex: "Google Vertex AI",
		openai: "OpenAI Compatible",
		ollama: "Ollama",
		lmstudio: "LM Studio",
		gemini: "Google Gemini",
		"openai-native": "OpenAI",
		requesty: "Requesty",
		together: "Together AI",
		deepseek: "DeepSeek",
		qwen: "Qwen",
		"qwen-code": "Qwen Code",
		doubao: "Doubao",
		mistral: "Mistral AI",
		"vscode-lm": "VSCode Language Models",
		cline: "Cline",
		litellm: "LiteLLM",
		moonshot: "Moonshot AI",
		nebius: "Nebius AI",
		fireworks: "Fireworks AI",
		asksage: "AskSage",
		xai: "X AI (Grok)",
		sambanova: "SambaNova",
		cerebras: "Cerebras",
		sapaicore: "SAP AI Core",
		groq: "Groq",
		huggingface: "Hugging Face",
		"huawei-cloud-maas": "Huawei Cloud MaaS",
		dify: "Dify",
		baseten: "Baseten",
		"vercel-ai-gateway": "Vercel AI Gateway",
		zai: "Z AI",
	}

	return displayNames[providerId] || providerId.charAt(0).toUpperCase() + providerId.slice(1)
}

/**
 * Get default model ID for a provider
 */
function getDefaultModelId(providerId, models, defaultModelIds) {
	// First, check if we have an extracted default from TypeScript source
	if (defaultModelIds && defaultModelIds[providerId]) {
		return defaultModelIds[providerId]
	}

	// Fallback to pattern matching if no explicit default was found
	const modelIds = Object.keys(models)
	if (modelIds.length === 0) return ""

	// Look for common default patterns
	const defaultPatterns = ["latest", "default", "sonnet", "gpt-4", "claude-3", "gemini-pro"]

	for (const pattern of defaultPatterns) {
		const match = modelIds.find((id) => id.toLowerCase().includes(pattern))
		if (match) return match
	}

	// Return first model if no pattern matches
	return modelIds[0]
}

/**
 * Check if provider supports dynamic model fetching
 */
function hasDynamicModelsSupport(providerId) {
	// Providers that support dynamic model fetching
	const dynamicProviders = [
		"openrouter",
		"openai",
		"openai-native",
		"ollama",
		"lmstudio",
		"litellm",
		"together",
		"fireworks",
		"groq",
	]

	return dynamicProviders.includes(providerId)
}

/**
 * Get setup instructions for a provider
 */
function getSetupInstructions(providerId) {
	const instructions = {
		anthropic: "Get your API key from https://console.anthropic.com/",
		openrouter: "Get your API key from https://openrouter.ai/keys",
		bedrock: "Configure AWS credentials with Bedrock access permissions",
		vertex: "Set up Google Cloud project with Vertex AI API enabled",
		openai: "Get your API key from https://platform.openai.com/api-keys",
		"openai-native": "Get your API key from your API provider",
		ollama: "Install Ollama locally and ensure it's running on the specified port",
		lmstudio: "Install LM Studio and start the local server",
		gemini: "Get your API key from https://makersuite.google.com/app/apikey",
		deepseek: "Get your API key from https://platform.deepseek.com/",
		qwen: "Get your API key from Alibaba Cloud DashScope",
		doubao: "Get your API key from ByteDance Volcano Engine",
		mistral: "Get your API key from https://console.mistral.ai/",
		xai: "Get your API key from https://console.x.ai/",
		groq: "Get your API key from https://console.groq.com/keys",
		cerebras: "Get your API key from https://cloud.cerebras.ai/",
		fireworks: "Get your API key from https://fireworks.ai/",
	}

	return instructions[providerId] || `Configure ${getProviderDisplayName(providerId)} API credentials`
}

/**
 * Main function to generate provider definitions
 */
async function main() {
	try {
		console.log(chalk.cyan("Starting provider definitions generation..."))

		// Parse TypeScript API definitions
		const data = await parseApiDefinitions()

		// Generate Go code
		const goCode = generateGoCode(data)

		// Ensure output directory exists
		const outputDir = path.dirname(GO_OUTPUT_FILE)
		await fs.mkdir(outputDir, { recursive: true })

		// Write Go file
		await fs.writeFile(GO_OUTPUT_FILE, goCode)

		console.log(chalk.green(`Successfully generated provider definitions:`))
		console.log(chalk.green(`   Output: ${GO_OUTPUT_FILE}`))
		console.log(chalk.green(`   Providers: ${data.providers.length}`))
		console.log(chalk.green(`   Config fields: ${data.configFields.length}`))
		console.log(chalk.green(`   Model definitions: ${Object.keys(data.modelDefinitions).length} providers`))
	} catch (error) {
		console.error(chalk.red("ERROR generating provider definitions:"), error.message)
		if (error.stack) {
			console.error(chalk.gray(error.stack))
		}
		process.exit(1)
	}
}

// Add helper function to the generated Go code
const helperFunction = `
// getFieldsByProvider filters configuration fields by provider and requirement
func getFieldsByProvider(providerID string, allFields []ConfigField, required bool) []ConfigField {
	var fields []ConfigField
	
	for _, field := range allFields {
		// Check if field is relevant to this provider
		fieldName := strings.ToLower(field.Name)
		providerName := strings.ToLower(providerID)
		
		isRelevant := false
		
		// Direct provider name match
		if strings.Contains(fieldName, providerName) {
			isRelevant = true
		}
		
		// Provider-specific field mappings
		switch providerID {
		case "anthropic":
			isRelevant = strings.Contains(fieldName, "apikey") || strings.Contains(fieldName, "anthropic")
		case "openrouter":
			isRelevant = strings.Contains(fieldName, "openrouter")
		case "bedrock":
			isRelevant = strings.Contains(fieldName, "aws") || strings.Contains(fieldName, "bedrock")
		case "vertex":
			isRelevant = strings.Contains(fieldName, "vertex")
		case "openai", "openai-native":
			isRelevant = strings.Contains(fieldName, "openai")
		case "ollama":
			isRelevant = strings.Contains(fieldName, "ollama")
		case "lmstudio":
			isRelevant = strings.Contains(fieldName, "lmstudio")
		case "gemini":
			isRelevant = strings.Contains(fieldName, "gemini")
		}
		
		// General fields that apply to all providers
		if field.Category == "general" {
			isRelevant = true
		}
		
		if isRelevant && field.Required == required {
			fields = append(fields, field)
		}
	}
	
	return fields
}`

// Run if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	main()
}
