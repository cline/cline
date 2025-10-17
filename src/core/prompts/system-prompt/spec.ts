import { Tool as AnthropicTool } from "@anthropic-ai/sdk/resources/index"
import { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import type { ModelFamily } from "@/shared/prompts"
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
				description: param.description || param.instruction,
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
			description: tool.description,
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
				description: param.description || param.instruction,
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
		description: tool.description,
		input_schema: {
			type: "object",
			properties,
			required,
		},
	}

	return toolInputSchema
}

/**
 * Converts an OpenAI ChatCompletionTool into an Anthropic Tool definition
 */
export function openAIToolToAnthropic(openAITool: OpenAITool): AnthropicTool {
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

// export function toOpenAIResponsesAPITool(openAITool: OpenAITool): OpenAITool {
// 	// {
// 	// 	"type": "function",
// 	// 	"function": {
// 	// 		"name": "get_weather",
// 	// 		"description": "Determine weather in my location",
// 	// 		"strict": true,
// 	// 		"parameters": {
// 	// 		"type": "object",
// 	// 		"properties": {
// 	// 			"location": {
// 	// 			"type": "string",
// 	// 			},
// 	// 		},
// 	// 		"additionalProperties": false,
// 	// 		"required": [
// 	// 			"location",
// 	// 			"unit"
// 	// 		]
// 	// 		}
// 	// 	}
// 	// }

// }
