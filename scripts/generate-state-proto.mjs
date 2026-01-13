#!/usr/bin/env node
/**
 * Generates proto message definitions from TypeScript source of truth.
 *
 * This script reads the field definitions from src/shared/storage/state-keys.ts
 * and generates the corresponding proto message definitions for Secrets and Settings.
 *
 * Usage: node scripts/generate-state-proto.mjs
 *
 * The generated proto content is written to proto/cline/state.proto,
 * replacing only the Secrets and Settings messages while preserving
 * the rest of the file (services, enums, other messages).
 */

import * as fs from "node:fs/promises"
import { Project, SyntaxKind } from "ts-morph"

const STATE_KEYS_PATH = "src/shared/storage/state-keys.ts"
const STATE_PROTO_PATH = "proto/cline/state.proto"

/**
 * Convert camelCase to snake_case for proto field names
 */
function camelToSnake(str) {
	return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

// Fields that should use int64 instead of int32
const INT64_FIELDS = new Set(["planModeThinkingBudgetTokens", "actModeThinkingBudgetTokens"])

// Fields that should use double instead of int32
const DOUBLE_FIELDS = new Set(["autoCondenseThreshold"])

/**
 * Infer proto type from TypeScript type expression
 * @param {string} typeText - The TypeScript type expression
 * @param {string} [fieldName] - Optional field name for field-specific overrides
 */
function inferProtoType(typeText, fieldName) {
	// Remove 'undefined' from union types
	const cleanType = typeText
		.replace(/\s*\|\s*undefined/g, "")
		.replace(/undefined\s*\|\s*/g, "")
		.trim()

	// Handle common types
	if (cleanType === "string") {
		return "string"
	}
	if (cleanType === "boolean") {
		return "bool"
	}
	if (cleanType === "number") {
		// Some number fields need specific numeric types
		if (fieldName && INT64_FIELDS.has(fieldName)) {
			return "int64"
		}
		if (fieldName && DOUBLE_FIELDS.has(fieldName)) {
			return "double"
		}
		return "int32"
	}

	// Handle Record<string, string> as map<string, string>
	if (/Record\s*<\s*string\s*,\s*string\s*>/.test(cleanType)) {
		return "map<string, string>"
	}

	// Handle specific known types that map to proto messages/enums
	// Order matters! More specific types must come before generic ones
	// (e.g., OpenAiCompatibleModelInfo before ModelInfo)
	// Check known types BEFORE string literals, since types like `"act" as Mode`
	// contain quotes but should map to proto enums
	const knownTypes = [
		// Specific model info types first
		["OpenAiCompatibleModelInfo", "OpenAiCompatibleModelInfo"],
		["LiteLLMModelInfo", "LiteLLMModelInfo"],
		["OcaModelInfo", "OcaModelInfo"],
		// Generic ModelInfo last (catches OpenRouterModelInfo, etc.)
		["ModelInfo", "OpenRouterModelInfo"],
		// Other types - order matters for substring matching
		["AutoApprovalSettings", "AutoApprovalSettings"],
		["BrowserSettings", "BrowserSettings"],
		["DictationSettings", "DictationSettings"],
		["FocusChainSettings", "FocusChainSettings"],
		["OpenaiReasoningEffort", "OpenaiReasoningEffort"],
		["PlanActMode", "PlanActMode"],
		["ApiProvider", "ApiProvider"],
		["LanguageModelChatSelector", "LanguageModelChatSelector"], // Must come before "Mode" check
	]

	for (const [tsType, protoType] of knownTypes) {
		if (cleanType.includes(tsType)) {
			return protoType
		}
	}

	// Check for Mode type separately with word boundary to avoid matching "VsCodeLmModelSelector"
	// This handles TS `Mode` type which maps to proto `PlanActMode`
	if (/\bMode\b/.test(cleanType)) {
		return "PlanActMode"
	}

	// Handle specific string literal unions (treat as string)
	// This comes after known types check since some types like `"act" as Mode` contain quotes
	if (cleanType.includes('"') || cleanType.includes("'")) {
		return "string"
	}

	// Default to string for complex types we can't map
	return "string"
}

/**
 * Parse the SECRETS_KEYS array from state-keys.ts
 */
function parseSecretsKeys(sourceFile) {
	const secretsDecl = sourceFile.getVariableDeclaration("SECRETS_KEYS")
	if (!secretsDecl) {
		throw new Error("Could not find SECRETS_KEYS declaration")
	}

	let initializer = secretsDecl.getInitializer()
	if (!initializer) {
		throw new Error("SECRETS_KEYS has no initializer")
	}

	// Handle 'as const' expression
	if (initializer.getKind() === SyntaxKind.AsExpression) {
		initializer = initializer.getExpression()
	}

	if (initializer.getKind() !== SyntaxKind.ArrayLiteralExpression) {
		throw new Error(`SECRETS_KEYS is not an array literal (got ${SyntaxKind[initializer.getKind()]})`)
	}

	const keys = []
	for (const element of initializer.getElements()) {
		const text = element.getText()
		// Remove quotes and handle special prefixes
		const key = text.replace(/^['"]|['"]$/g, "")
		// Skip prefixed keys like "cline:clineAccountId"
		if (!key.includes(":")) {
			keys.push(key)
		}
	}

	return keys
}

/**
 * Parse field definitions from an object literal in state-keys.ts
 */
function parseFieldDefinitions(sourceFile, variableName) {
	const decl = sourceFile.getVariableDeclaration(variableName)
	if (!decl) {
		throw new Error(`Could not find ${variableName} declaration`)
	}

	const initializer = decl.getInitializer()
	if (!initializer) {
		throw new Error(`${variableName} has no initializer`)
	}

	// Handle 'satisfies' expression
	let objectLiteral = initializer
	if (initializer.getKind() === SyntaxKind.SatisfiesExpression) {
		objectLiteral = initializer.getExpression()
	}

	if (objectLiteral.getKind() !== SyntaxKind.ObjectLiteralExpression) {
		throw new Error(`${variableName} is not an object literal`)
	}

	const fields = []
	for (const prop of objectLiteral.getProperties()) {
		if (prop.getKind() !== SyntaxKind.PropertyAssignment) {
			continue
		}

		const name = prop.getName()
		const propInit = prop.getInitializer()

		if (!propInit || propInit.getKind() !== SyntaxKind.ObjectLiteralExpression) {
			continue
		}

		// Get the 'default' property to infer the type
		const defaultProp = propInit.getProperty("default")
		if (!defaultProp) {
			continue
		}

		let typeText = "string"
		const defaultInit = defaultProp.getInitializer()
		if (defaultInit) {
			// Check for 'as' expression to get the type
			if (defaultInit.getKind() === SyntaxKind.AsExpression) {
				const typeNode = defaultInit.getTypeNode()
				if (typeNode) {
					typeText = typeNode.getText()
				}
			} else {
				// Infer from literal
				const text = defaultInit.getText()
				if (text === "true" || text === "false") {
					typeText = "boolean"
				} else if (/^\d+$/.test(text)) {
					typeText = "number"
				} else if (/^\d+\.\d+$/.test(text)) {
					typeText = "number"
				}
			}
		}

		fields.push({
			name,
			tsType: typeText,
			protoType: inferProtoType(typeText, name),
		})
	}

	return fields
}

/**
 * Convert snake_case to camelCase for mapping proto fields back to TS keys
 */
function snakeToCamel(str) {
	return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

/**
 * Parse field numbers from an existing proto message definition
 * Returns a map of camelCase field names to their field numbers
 */
function parseProtoMessageFieldNumbers(protoContent, messageName) {
	const fieldNumbers = {}

	// Match the message block (handles single-level nesting for now)
	const messageRegex = new RegExp(`message\\s+${messageName}\\s*\\{([^}]*(?:\\{[^}]*\\}[^}]*)*)\\}`, "s")
	const match = protoContent.match(messageRegex)

	if (!match) {
		return fieldNumbers
	}

	const messageBody = match[1]

	// Match field definitions: optional/required/repeated type name = number;
	const fieldRegex = /(?:optional|required|repeated)?\s*\w+\s+(\w+)\s*=\s*(\d+)\s*;/g
	const matches = messageBody.matchAll(fieldRegex)

	for (const fieldMatch of matches) {
		const snakeName = fieldMatch[1]
		const fieldNum = parseInt(fieldMatch[2], 10)
		const camelName = snakeToCamel(snakeName)
		fieldNumbers[camelName] = fieldNum
	}

	return fieldNumbers
}

/**
 * Load field number mappings from existing proto file
 */
async function loadFieldNumbersFromProto() {
	try {
		const protoContent = await fs.readFile(STATE_PROTO_PATH, "utf-8")
		const secrets = parseProtoMessageFieldNumbers(protoContent, "Secrets")
		const settings = parseProtoMessageFieldNumbers(protoContent, "Settings")

		console.log(`  Found ${Object.keys(secrets).length} existing Secrets fields`)
		console.log(`  Found ${Object.keys(settings).length} existing Settings fields`)

		return { Secrets: secrets, Settings: settings }
	} catch {
		// Proto file doesn't exist, start fresh
		return { Secrets: {}, Settings: {} }
	}
}

/**
 * Assign field numbers, preserving existing assignments and adding new ones
 */
function assignFieldNumbers(fields, existingNumbers, startNumber = 1) {
	const result = {}
	let nextNumber = startNumber

	// Find the highest existing number
	for (const num of Object.values(existingNumbers)) {
		if (num >= nextNumber) {
			nextNumber = num + 1
		}
	}

	// Preserve existing assignments
	for (const field of fields) {
		if (existingNumbers[field.name] !== undefined) {
			result[field.name] = existingNumbers[field.name]
		}
	}

	// Assign new numbers for new fields
	for (const field of fields) {
		if (result[field.name] === undefined) {
			result[field.name] = nextNumber++
		}
	}

	return result
}

/**
 * Generate proto message definition
 */
function generateProtoMessage(messageName, fields, fieldNumbers) {
	const lines = [`message ${messageName} {`]

	// Sort fields by field number for consistent output
	const sortedFields = [...fields].sort((a, b) => fieldNumbers[a.name] - fieldNumbers[b.name])

	for (const field of sortedFields) {
		const snakeName = camelToSnake(field.name)
		const fieldNum = fieldNumbers[field.name]
		// Map types cannot have the 'optional' modifier in proto3
		const prefix = field.protoType.startsWith("map<") ? "" : "optional "
		lines.push(`  ${prefix}${field.protoType} ${snakeName} = ${fieldNum};`)
	}

	lines.push("}")
	return lines.join("\n")
}

/**
 * Generate Secrets message from SECRETS_KEYS
 */
function generateSecretsMessage(secretsKeys, fieldNumbers) {
	const fields = secretsKeys.map((key) => ({
		name: key,
		protoType: "string",
	}))

	return generateProtoMessage("Secrets", fields, fieldNumbers)
}

/**
 * Replace a message in the proto file content
 */
function replaceMessage(protoContent, messageName, newMessageContent) {
	// Match the message definition including nested braces
	const messageRegex = new RegExp(`message\\s+${messageName}\\s*\\{[^}]*(?:\\{[^}]*\\}[^}]*)*\\}`, "g")

	if (messageRegex.test(protoContent)) {
		return protoContent.replace(messageRegex, newMessageContent)
	} else {
		// Message doesn't exist, append before the first message or at end
		console.warn(`Warning: ${messageName} message not found in proto file, appending`)
		return protoContent + "\n\n" + newMessageContent
	}
}

async function main() {
	console.log("Generating proto definitions from TypeScript source...")

	// Parse TypeScript source
	const project = new Project({
		tsConfigFilePath: "tsconfig.json",
	})
	const sourceFile = project.addSourceFileAtPath(STATE_KEYS_PATH)

	// Parse definitions
	const secretsKeys = parseSecretsKeys(sourceFile)
	console.log(`Found ${secretsKeys.length} secret keys`)

	const apiHandlerFields = parseFieldDefinitions(sourceFile, "API_HANDLER_SETTINGS_FIELDS")
	const userSettingsFields = parseFieldDefinitions(sourceFile, "USER_SETTINGS_FIELDS")
	const settingsFields = [...apiHandlerFields, ...userSettingsFields]
	console.log(`Found ${settingsFields.length} settings fields`)

	// Load existing field numbers from proto file
	const existingFieldNumbers = await loadFieldNumbersFromProto()

	// Assign field numbers (preserving existing, adding new ones)
	const secretsFieldNumbers = assignFieldNumbers(
		secretsKeys.map((k) => ({ name: k })),
		existingFieldNumbers.Secrets,
		1,
	)
	const settingsFieldNumbers = assignFieldNumbers(settingsFields, existingFieldNumbers.Settings, 1)

	// Generate messages
	const secretsMessage = generateSecretsMessage(secretsKeys, secretsFieldNumbers)
	const settingsMessage = generateProtoMessage("Settings", settingsFields, settingsFieldNumbers)

	// Read existing proto file
	let protoContent = await fs.readFile(STATE_PROTO_PATH, "utf-8")

	// Replace messages
	protoContent = replaceMessage(protoContent, "Secrets", secretsMessage)
	protoContent = replaceMessage(protoContent, "Settings", settingsMessage)

	// Write updated proto file
	await fs.writeFile(STATE_PROTO_PATH, protoContent)
	console.log(`Updated ${STATE_PROTO_PATH}`)

	console.log("\nGeneration complete! Run 'npm run protos' to regenerate TypeScript from protos.")
}

main().catch((error) => {
	console.error("Error:", error)
	process.exit(1)
})
