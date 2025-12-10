/**
 * API Secrets Parser Module
 *
 * Parses the ApiHandlerSecrets TypeScript interface from src/shared/api.ts
 * to automatically discover API key fields for all providers.
 *
 * This eliminates the need for manual maintenance of provider-to-API-key mappings.
 */

/**
 * Parses the ApiHandlerSecrets interface from api.ts content
 *
 * @param {string} content - Content of api.ts file
 * @returns {Object} Parsed API key fields with metadata
 * @returns {Object.fields} - Map of field names to their metadata
 * @returns {Object.fieldNames} - Array of all field names
 */
export function parseApiHandlerSecrets(content) {
	// Find the ApiHandlerSecrets interface definition
	const interfaceMatch = content.match(/export interface ApiHandlerSecrets \{([\s\S]*?)\}/m)

	if (!interfaceMatch) {
		throw new Error("Could not find ApiHandlerSecrets interface definition")
	}

	const interfaceContent = interfaceMatch[1]
	const fields = {}
	const fieldNames = []

	// Match field definitions like: fieldName?: string // comment
	const fieldMatches = interfaceContent.matchAll(/^\s*([a-zA-Z][a-zA-Z0-9_]*)\?\s*:\s*([^/\n]+)(?:\/\/\s*(.*))?$/gm)

	for (const match of fieldMatches) {
		const [, name, type, comment] = match

		fields[name] = {
			name,
			type: type.trim(),
			comment: comment?.trim() || "",
			isSecret: true, // All fields in ApiHandlerSecrets are secrets
		}

		fieldNames.push(name)
	}

	return { fields, fieldNames }
}

/**
 * Maps provider IDs to their required API key fields
 *
 * @param {Array<string>} providerIds - List of provider IDs from ApiProvider type
 * @param {Object} apiSecretsFields - Parsed fields from ApiHandlerSecrets
 * @returns {Object} Map of provider ID to array of API key field names
 *
 * Example output:
 * {
 *   "anthropic": ["apiKey"],
 *   "bedrock": ["awsAccessKey", "awsSecretKey"],
 *   "cerebras": ["cerebrasApiKey"],
 *   ...
 * }
 */
export function mapProviderToApiKeys(providerIds, apiSecretsFields) {
	const providerApiKeyMap = {}

	// Track which fields have been assigned to prevent duplicates
	const assignedFields = new Set()

	// First pass: Map provider-specific API key fields
	for (const providerId of providerIds) {
		const apiKeyFields = []

		for (const fieldName of apiSecretsFields.fieldNames) {
			if (assignedFields.has(fieldName)) {
				continue
			}

			const providerFromField = extractProviderFromFieldName(fieldName)

			if (providerFromField === providerId) {
				apiKeyFields.push(fieldName)
				assignedFields.add(fieldName)
			}
		}

		if (apiKeyFields.length > 0) {
			providerApiKeyMap[providerId] = apiKeyFields
		}
	}

	// Second pass: Handle special cases and multi-key providers
	applySpecialCaseMappings(providerApiKeyMap, apiSecretsFields, assignedFields)

	return providerApiKeyMap
}

/**
 * Determines the provider ID from an API key field name
 * Uses pattern matching on common naming conventions
 *
 * @param {string} fieldName - API key field name (e.g., "cerebrasApiKey")
 * @returns {string|null} Provider ID or null if not a provider-specific key
 */
export function extractProviderFromFieldName(fieldName) {
	// Normalize field name to lowercase for matching
	const lowerFieldName = fieldName.toLowerCase()

	// SPECIAL CASES FIRST (before pattern matching)

	// Special case: "apiKey" alone maps to "anthropic" (primary provider)
	if (fieldName === "apiKey") {
		return "anthropic"
	}

	// Special case: clineAccountId maps to "cline"
	if (lowerFieldName === "clineaccountid") {
		return "cline"
	}

	// Special case: authNonce is not provider-specific
	if (lowerFieldName === "authnonce") {
		return null
	}

	// Special case: Vertex fields (not in ApiHandlerSecrets but in ApiHandlerOptions)
	if (lowerFieldName === "vertexprojectid" || lowerFieldName === "vertexregion") {
		return "vertex"
	}

	// Pattern 1: AWS-specific fields (check before generic pattern to avoid false positives)
	if (lowerFieldName.startsWith("aws")) {
		// awsAccessKey, awsSecretKey, awsSessionToken, awsRegion -> bedrock
		if (
			lowerFieldName.includes("accesskey") ||
			lowerFieldName.includes("secretkey") ||
			lowerFieldName.includes("sessiontoken") ||
			lowerFieldName.includes("region")
		) {
			return "bedrock"
		}
		// awsBedrockApiKey is explicitly bedrock
		if (lowerFieldName.includes("bedrock")) {
			return "bedrock"
		}
	}

	// Pattern 2: Vertex-specific fields
	if (lowerFieldName.startsWith("vertex")) {
		return "vertex"
	}

	// Pattern 3: SAP AI Core fields
	if (lowerFieldName.startsWith("sapaicore") || lowerFieldName.startsWith("sapai")) {
		return "sapaicore"
	}

	// Pattern 4: Provider name in the middle (e.g., openAiNativeApiKey) - check before generic pattern
	const providerPatterns = [
		{ pattern: "openainative", providerId: "openai-native" },
		{ pattern: "openrouter", providerId: "openrouter" },
		{ pattern: "openai", providerId: "openai" },
		{ pattern: "gemini", providerId: "gemini" },
		{ pattern: "deepseek", providerId: "deepseek" },
		{ pattern: "ollama", providerId: "ollama" },
		{ pattern: "lmstudio", providerId: "lmstudio" },
		{ pattern: "litellm", providerId: "litellm" },
		{ pattern: "qwen", providerId: "qwen" },
		{ pattern: "doubao", providerId: "doubao" },
		{ pattern: "mistral", providerId: "mistral" },
		{ pattern: "fireworks", providerId: "fireworks" },
		{ pattern: "asksage", providerId: "asksage" },
		{ pattern: "xai", providerId: "xai" },
		{ pattern: "moonshot", providerId: "moonshot" },
		{ pattern: "sambanova", providerId: "sambanova" },
		{ pattern: "cerebras", providerId: "cerebras" },
		{ pattern: "groq", providerId: "groq" },
		{ pattern: "huggingface", providerId: "huggingface" },
		{ pattern: "huawei", providerId: "huawei-cloud-maas" },
		{ pattern: "baseten", providerId: "baseten" },
		{ pattern: "vercel", providerId: "vercel-ai-gateway" },
		{ pattern: "zai", providerId: "zai" },
		{ pattern: "requesty", providerId: "requesty" },
		{ pattern: "together", providerId: "together" },
		{ pattern: "dify", providerId: "dify" },
	]

	for (const { pattern, providerId } of providerPatterns) {
		if (lowerFieldName.includes(pattern)) {
			return providerId
		}
	}

	// Pattern 5: <provider>ApiKey format (most common) - checked LAST to avoid false positives
	if (lowerFieldName.endsWith("apikey")) {
		// Extract from ORIGINAL fieldName to preserve camelCase for normalization
		const providerPart = fieldName.slice(0, -6) // Remove "ApiKey"
		return normalizeProviderName(providerPart)
	}

	return null
}

/**
 * Normalizes provider name extracted from field name to match provider ID format
 *
 * @param {string} providerPart - Provider part extracted from field name
 * @returns {string} Normalized provider ID
 */
function normalizeProviderName(providerPart) {
	// Handle camelCase to kebab-case conversion
	const normalized = providerPart
		.replace(/([A-Z])/g, "-$1")
		.toLowerCase()
		.replace(/^-/, "")

	// Handle special cases
	const specialCases = {
		"open-router": "openrouter",
		"open-ai-native": "openai-native",
		"open-ai": "openai",
		"lite-llm": "litellm",
		"deep-seek": "deepseek",
		"ask-sage": "asksage",
		"hugging-face": "huggingface",
		"huawei-cloud-maas": "huawei-cloud-maas",
		"sap-ai-core": "sapaicore",
		"vercel-ai-gateway": "vercel-ai-gateway",
	}

	return specialCases[normalized] || normalized
}

/**
 * Applies special case mappings for complex provider relationships
 *
 * @param {Object} providerApiKeyMap - Current map being built
 * @param {Object} apiSecretsFields - Parsed API secrets fields
 * @param {Set<string>} assignedFields - Set of already assigned field names
 */
function applySpecialCaseMappings(providerApiKeyMap, apiSecretsFields, assignedFields) {
	// Special case 1: Bedrock needs AWS fields (if not already assigned)
	const awsFields = ["awsAccessKey", "awsSecretKey", "awsRegion"]
	const bedrockFields = providerApiKeyMap["bedrock"] || []

	for (const field of awsFields) {
		if (apiSecretsFields.fieldNames.includes(field) && !bedrockFields.includes(field)) {
			bedrockFields.push(field)
			assignedFields.add(field)
		}
	}

	// Optional: awsSessionToken for temporary credentials
	if (apiSecretsFields.fieldNames.includes("awsSessionToken") && !bedrockFields.includes("awsSessionToken")) {
		bedrockFields.push("awsSessionToken")
		assignedFields.add("awsSessionToken")
	}

	if (bedrockFields.length > 0) {
		providerApiKeyMap["bedrock"] = bedrockFields
	}

	// Special case 2: Vertex needs project ID and region
	if (providerApiKeyMap["vertex"]) {
		// Vertex typically uses application default credentials,
		// but requires project ID and region configuration
		// These are already captured if they exist in ApiHandlerSecrets
	}

	// Special case 3: SAP AI Core multi-key authentication
	if (providerApiKeyMap["sapaicore"]) {
		const sapFields = providerApiKeyMap["sapaicore"]
		const requiredSapFields = ["sapAiCoreClientId", "sapAiCoreClientSecret"]

		for (const field of requiredSapFields) {
			if (apiSecretsFields.fieldNames.includes(field) && !sapFields.includes(field)) {
				sapFields.push(field)
				assignedFields.add(field)
			}
		}
	}
}

/**
 * Generates display name for an API key field
 * Converts camelCase to Title Case with proper spacing
 *
 * @param {string} fieldName - API key field name
 * @returns {string} Human-readable display name
 */
export function generateApiKeyDisplayName(fieldName) {
	// Special cases for known abbreviations
	const specialCases = {
		apiKey: "API Key",
		awsAccessKey: "AWS Access Key",
		awsSecretKey: "AWS Secret Key",
		awsSessionToken: "AWS Session Token",
		awsRegion: "AWS Region",
		awsBedrockApiKey: "AWS Bedrock API Key",
		openRouterApiKey: "OpenRouter API Key",
		openAiApiKey: "OpenAI API Key",
		openAiNativeApiKey: "OpenAI Native API Key",
		geminiApiKey: "Gemini API Key",
		ollamaApiKey: "Ollama API Key",
		deepSeekApiKey: "DeepSeek API Key",
		liteLlmApiKey: "LiteLLM API Key",
		qwenApiKey: "Qwen API Key",
		doubaoApiKey: "Doubao API Key",
		mistralApiKey: "Mistral API Key",
		fireworksApiKey: "Fireworks API Key",
		asksageApiKey: "AskSage API Key",
		xaiApiKey: "X AI API Key",
		moonshotApiKey: "Moonshot API Key",
		sambanovaApiKey: "SambaNova API Key",
		cerebrasApiKey: "Cerebras API Key",
		groqApiKey: "Groq API Key",
		huggingFaceApiKey: "Hugging Face API Key",
		nebiusApiKey: "Nebius API Key",
		basetenApiKey: "Baseten API Key",
		vercelAiGatewayApiKey: "Vercel AI Gateway API Key",
		zaiApiKey: "Z AI API Key",
		requestyApiKey: "Requesty API Key",
		togetherApiKey: "Together AI API Key",
		difyApiKey: "Dify API Key",
		clineAccountId: "Cline Account ID",
		vertexProjectId: "Vertex Project ID",
		vertexRegion: "Vertex Region",
		sapAiCoreClientId: "SAP AI Core Client ID",
		sapAiCoreClientSecret: "SAP AI Core Client Secret",
		huaweiCloudMaasApiKey: "Huawei Cloud MaaS API Key",
		hicapApiKey: "Hicap API Key",
	}

	if (specialCases[fieldName]) {
		return specialCases[fieldName]
	}

	// Generic conversion: camelCase -> Title Case
	return fieldName
		.replace(/([A-Z])/g, " $1")
		.replace(/^./, (str) => str.toUpperCase())
		.trim()
}

/**
 * Validates that all providers have at least one API key field mapped
 *
 * @param {Array<string>} providerIds - All provider IDs
 * @param {Object} providerApiKeyMap - Generated mapping
 * @returns {Object} Validation result with warnings for unmapped providers
 */
export function validateApiKeyMappings(providerIds, providerApiKeyMap) {
	const unmappedProviders = []
	const warnings = []

	for (const providerId of providerIds) {
		if (!providerApiKeyMap[providerId] || providerApiKeyMap[providerId].length === 0) {
			// Some providers don't require API keys - they use alternative authentication:
			const noKeyProviders = ["vscode-lm", "ollama", "lmstudio", "claude-code", "oca", "vertex", "qwen-code"]

			if (!noKeyProviders.includes(providerId)) {
				unmappedProviders.push(providerId)
				warnings.push(`WARNING: Provider "${providerId}" has no API key fields mapped`)
			}
		}
	}

	return {
		valid: unmappedProviders.length === 0,
		unmappedProviders,
		warnings,
		totalProviders: providerIds.length,
		mappedProviders: Object.keys(providerApiKeyMap).length,
	}
}
