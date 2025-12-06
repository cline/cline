import { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/index"
import { FunctionDeclaration as GoogleTool, Type as GoogleToolParamType } from "@google/genai"
import { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { FunctionTool as OpenAIResponseFunctionTool, Tool as OpenAIResponseTool } from "openai/resources/responses/responses"
import { ModelFamily } from "@/shared/prompts"
import type { ClineDefaultTool } from "@/shared/tools"
import type { SystemPromptContext } from "./types"

export interface ClineToolSpec {
	variant: ModelFamily
	id: ClineDefaultTool
	name: string
	description: string
	instruction?: string
	contextRequirements?: (context: SystemPromptContext) => boolean
	parameters?: Array<ClineToolSpecParameter>
}

interface ClineToolSpecParameter {
	name: string
	required: boolean
	instruction: string
	usage?: string
	dependencies?: ClineDefaultTool[]
	description?: string
	contextRequirements?: (context: SystemPromptContext) => boolean
	// TODO: Confirm if "integer" is actually supported across providers
	/**
	 * The type of the parameter. Default to string if not provided.
	 * Supported types: string, boolean, integer, array, object
	 */
	type?: "string" | "boolean" | "integer" | "array" | "object"
	/**
	 * For array types, this defines the schema of array items
	 */
	items?: any
	/**
	 * For object types, this defines the properties
	 */
	properties?: Record<string, any>
	/**
	 * Additional JSON Schema fields to preserve from MCP tools
	 */
	[key: string]: any
}

/**
 * Converts a ClineToolSpec into an OpenAI ChatCompletionTool definition
 * Docs: https://openrouter.ai/docs/features/tool-calling#step-1-inference-request-with-tools
 */
export function toolSpecFunctionDefinition(tool: ClineToolSpec, context: SystemPromptContext): OpenAITool {
	// Check if the tool should be included based on context requirements
	if (tool.contextRequirements && !tool.contextRequirements(context)) {
		throw new Error(`Tool ${tool.name} does not meet context requirements`)
	}

	// Build the properties object for parameters
	const properties: Record<string, any> = {}
	const required: string[] = []

	if (tool.parameters) {
		for (const param of tool.parameters) {
			// Check if parameter should be included based on context requirements
			if (param.contextRequirements && !param.contextRequirements(context)) {
				continue
			}

			// Add to required array if parameter is required
			if (param.required) {
				required.push(param.name)
			}

			// Determine parameter type - use explicit type if provided.
			// Default to string
			const paramType: string = param.type || "string"

			// Build parameter schema
			const paramSchema: any = {
				type: paramType,
				description: replacer(param.instruction, context),
			}

			// Add items for array types
			if (paramType === "array" && param.items) {
				paramSchema.items = param.items
			}

			// Add properties for object types
			if (paramType === "object" && param.properties) {
				paramSchema.properties = param.properties
			}

			// Preserve any additional JSON Schema fields from MCP tools
			// (e.g., enum, format, minimum, maximum, etc.)
			const reservedKeys = new Set([
				"name",
				"required",
				"instruction",
				"usage",
				"dependencies",
				"description",
				"contextRequirements",
				"type",
				"items",
				"properties",
			])
			for (const key in param) {
				if (!reservedKeys.has(key) && param[key] !== undefined) {
					paramSchema[key] = param[key]
				}
			}

			// Add usage example as part of description if available
			// if (param.usage) {
			// 	paramSchema.description += ` Example: ${param.usage}`
			// }

			properties[param.name] = paramSchema
		}
	}

	// Build the ChatCompletionTool object
	const chatCompletionTool: OpenAITool = {
		type: "function",
		function: {
			name: tool.name,
			description: replacer(tool.description, context),
			strict: false,
			parameters: {
				type: "object",
				properties,
				required,
				additionalProperties: false,
			},
		},
	}

	return chatCompletionTool
}

/**
 * Converts a ClineToolSpec into an Anthropic Tool definition
 */
export function toolSpecInputSchema(tool: ClineToolSpec, context: SystemPromptContext): AnthropicTool {
	// Check if the tool should be included based on context requirements
	if (tool.contextRequirements && !tool.contextRequirements(context)) {
		throw new Error(`Tool ${tool.name} does not meet context requirements`)
	}

	// Build the properties object for parameters
	const properties: Record<string, any> = {}
	const required: string[] = []

	if (tool.parameters) {
		for (const param of tool.parameters) {
			// Check if parameter should be included based on context requirements
			if (param.contextRequirements && !param.contextRequirements(context)) {
				continue
			}

			// Add to required array if parameter is required
			if (param.required) {
				required.push(param.name)
			}

			// Determine parameter type - use explicit type if provided.
			// Default to string
			const paramType: string = param.type || "string"

			// Build parameter schema
			const paramSchema: any = {
				type: paramType,
				description: replacer(param.instruction, context),
			}

			// Add items for array types
			if (paramType === "array" && param.items) {
				paramSchema.items = param.items
			}

			// Add properties for object types
			if (paramType === "object" && param.properties) {
				paramSchema.properties = param.properties
			}

			// Preserve any additional JSON Schema fields from MCP tools
			// (e.g., enum, format, minimum, maximum, etc.)
			const reservedKeys = new Set([
				"name",
				"required",
				"instruction",
				"usage",
				"dependencies",
				"description",
				"contextRequirements",
				"type",
				"items",
				"properties",
			])
			for (const key in param) {
				if (!reservedKeys.has(key) && param[key] !== undefined) {
					paramSchema[key] = param[key]
				}
			}

			// Add usage example as part of description if available
			// if (param.usage) {
			// 	paramSchema.description += ` Example: ${param.usage}`
			// }

			properties[param.name] = paramSchema
		}
	}

	// Build the Tool object
	const toolInputSchema: AnthropicTool = {
		name: tool.name,
		description: replacer(tool.description, context),
		input_schema: {
			type: "object",
			properties,
			required,
		},
	}

	return toolInputSchema
}

const GOOGLE_TOOL_PARAM_MAP: Record<string, string> = {
	string: "STRING",
	number: "NUMBER",
	integer: "NUMBER",
	boolean: "BOOLEAN",
	object: "OBJECT",
	array: "STRING",
}

/**
 * Converts a ClineToolSpec into a Google Gemini function.
 * Docs: https://ai.google.dev/gemini-api/docs/function-calling
 */
export function toolSpecFunctionDeclarations(tool: ClineToolSpec, context: SystemPromptContext): GoogleTool {
	// Check if the tool should be included based on context requirements
	if (tool.contextRequirements && !tool.contextRequirements(context)) {
		throw new Error(`Tool ${tool.name} does not meet context requirements`)
	}

	// Build the parameters object for parameters
	const properties: Record<string, any> = {}
	const required: string[] = []

	if (tool.parameters) {
		for (const param of tool.parameters) {
			// Check if parameter should be included based on context requirements
			if (param.contextRequirements && !param.contextRequirements(context)) {
				continue
			}

			if (!param.name) {
				continue
			}

			// Add to required array if parameter is required
			if (param.required) {
				required.push(param.name)
			}

			const paramSchema: any = {
				type: GOOGLE_TOOL_PARAM_MAP[param.type || "string"] || GoogleToolParamType.OBJECT,
			}

			if (param.properties) {
				paramSchema.properties = {}
				for (const [key, prop] of Object.entries<any>(param.properties)) {
					// Skip $schema property
					if (key === "$schema") {
						continue
					}
					paramSchema.properties[key] = {
						type: GOOGLE_TOOL_PARAM_MAP[prop.type || "string"] || GoogleToolParamType.OBJECT,
						description: replacer(param.instruction, context),
					}

					// Handle enum values
					if (prop.enum) {
						paramSchema.properties[key].enum = prop.enum
					}
				}
			}

			properties[param.name] = paramSchema
		}
	}

	const googleTool: GoogleTool = {
		name: tool.name,
		description: replacer(tool.description, context),
		parameters: {
			type: GoogleToolParamType.OBJECT,
			properties,
			required,
		},
	}

	return googleTool
}

/**
 * Converts an OpenAI ChatCompletionTool into an Anthropic Tool definition
 */
export function openAIToolToAnthropic(openAITool: OpenAITool): AnthropicTool {
	if (openAITool.type === "function") {
		const func = openAITool.function
		return {
			name: func.name,
			description: func.description || "",
			input_schema: {
				type: "object",
				properties: func.parameters?.properties || {},
				required: func.parameters?.required || [],
			},
		}
	}

	return {
		name: openAITool.custom.name,
		description: openAITool.custom.description || "",
		input_schema: {
			type: "object",
			required: openAITool.custom.format?.type === "text" ? ["text"] : [],
			properties:
				openAITool.custom.format?.type === "text" ? { text: { type: "string" } } : { grammar: { type: "object" } },
		},
	}
}

/**
 * Converts OpenAI tools to Response API format.
 * Filters for function-type tools and applies Response API defaults.
 */
export function toOpenAIResponseTools(openAITools: OpenAITool[]): OpenAIResponseTool[] {
	if (!openAITools) {
		return []
	}

	return openAITools
		.filter((tool): tool is OpenAITool & { type: "function" } => tool.type === "function")
		.map((tool) => ({
			type: "function" as const,
			name: tool.function.name,
			description: tool.function.description,
			parameters: (tool.function.parameters as { [key: string]: unknown } | null) ?? null,
			strict: tool.function.strict ?? true,
		}))
}

/**
 * Converts an OpenAI ChatCompletionTool into Response API format.
 */
export function toOpenAIResponsesAPITool(openAITool: OpenAITool): OpenAIResponseTool {
	if (openAITool.type === "function") {
		const fn = openAITool.function
		return {
			type: "function",
			name: fn.name,
			description: fn.description || "",
			strict: fn.strict || false,
			parameters: {
				type: "object",
				properties: fn.parameters?.properties || {},
				required: (fn.parameters?.required as string[]) || [],
			},
		} satisfies OpenAIResponseFunctionTool
	}

	// Handle custom tool type
	const custom = openAITool.custom
	const isTextFormat = custom.format?.type === "text"

	return {
		type: "function",
		name: custom.name,
		description: custom.description || "",
		strict: false,
		parameters: {
			type: "object",
			properties: isTextFormat ? { text: { type: "string" } } : { grammar: { type: "object" } },
			required: ["text"],
		},
	} satisfies OpenAIResponseTool
}

/**
 * Replaces template placeholders in description with viewport dimensions.
 */
function replacer(description: string, context: SystemPromptContext): string {
	const width = context.browserSettings?.viewport?.width || 900
	const height = context.browserSettings?.viewport?.height || 600

	return description.replace("{{BROWSER_VIEWPORT_WIDTH}}", String(width)).replace("{{BROWSER_VIEWPORT_HEIGHT}}", String(height))
}
