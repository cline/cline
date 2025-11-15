/**
 * Unit Tests for System Prompt Tool Specification Functions
 *
 * This test suite validates the tool conversion functions that transform
 * ClineToolSpec into various provider-specific formats (OpenAI, Anthropic, Google).
 */

import { expect } from "chai"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import { ModelFamily } from "@/shared/prompts"
import type { ClineDefaultTool } from "@/shared/tools"
import {
	type ClineToolSpec,
	openAIToolToAnthropic,
	toOpenAIResponsesAPITool,
	toOpenAIResponseTools,
	toolSpecFunctionDeclarations,
	toolSpecFunctionDefinition,
	toolSpecInputSchema,
} from "../spec"
import type { SystemPromptContext } from "../types"

const mockProviderInfo = {
	providerId: "test",
	model: {
		id: "test-model",
		info: {
			supportsPromptCache: false,
		},
	},
}

const baseContext: SystemPromptContext = {
	cwd: "/test/project",
	ide: "TestIDE",
	supportsBrowserUse: false,
	mcpHub: undefined,
	focusChainSettings: undefined,
	browserSettings: {
		viewport: {
			width: 1280,
			height: 720,
		},
	},
	providerInfo: mockProviderInfo,
	isTesting: true,
	enableNativeToolCalls: false,
}

const mockToolSpec: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: "test_tool" as ClineDefaultTool,
	name: "test_tool",
	description: "A test tool for unit testing",
	parameters: [
		{
			name: "param1",
			required: true,
			instruction: "First parameter",
			type: "string",
		},
		{
			name: "param2",
			required: false,
			instruction: "Second parameter",
			type: "integer",
		},
	],
}

describe("Tool Specification Functions", () => {
	describe("toolSpecFunctionDefinition", () => {
		it("should convert ClineToolSpec to OpenAI ChatCompletionTool", () => {
			const result = toolSpecFunctionDefinition(mockToolSpec, baseContext)

			expect(result).to.have.property("type", "function")
			expect(result).to.have.nested.property("function.name", "test_tool")
			expect(result).to.have.nested.property("function.description", "A test tool for unit testing")
			expect(result).to.have.nested.property("function.strict", false)
			expect(result).to.have.nested.property("function.parameters.type", "object")
			expect(result).to.have.nested.property("function.parameters.properties.param1")
			expect(result).to.have.nested.property("function.parameters.properties.param2")

			if (result.type === "function") {
				expect(result.function.parameters?.required).to.deep.equal(["param1"])
			}
		})

		it("should handle tool without parameters", () => {
			const toolWithoutParams: ClineToolSpec = {
				...mockToolSpec,
				parameters: undefined,
			}

			const result = toolSpecFunctionDefinition(toolWithoutParams, baseContext)

			if (result.type === "function") {
				expect(result.function.parameters?.properties).to.deep.equal({})
				expect(result.function.parameters?.required).to.deep.equal([])
			}
		})

		it("should throw error when context requirements are not met", () => {
			const toolWithContextReq: ClineToolSpec = {
				...mockToolSpec,
				contextRequirements: () => false,
			}

			expect(() => toolSpecFunctionDefinition(toolWithContextReq, baseContext)).to.throw(
				"Tool test_tool does not meet context requirements",
			)
		})

		it("should filter out parameters that don't meet context requirements", () => {
			const toolWithConditionalParams: ClineToolSpec = {
				...mockToolSpec,
				parameters: [
					{
						name: "visible_param",
						required: true,
						instruction: "Always visible",
						type: "string",
					},
					{
						name: "hidden_param",
						required: false,
						instruction: "Hidden param",
						type: "string",
						contextRequirements: () => false,
					},
				],
			}

			const result = toolSpecFunctionDefinition(toolWithConditionalParams, baseContext)

			if (result.type === "function") {
				expect(result.function.parameters?.properties).to.have.property("visible_param")
				expect(result.function.parameters?.properties).to.not.have.property("hidden_param")
			}
		})

		it("should replace browser viewport placeholders in descriptions", () => {
			const toolWithPlaceholders: ClineToolSpec = {
				...mockToolSpec,
				description: "Width: {{BROWSER_VIEWPORT_WIDTH}}, Height: {{BROWSER_VIEWPORT_HEIGHT}}",
			}

			const result = toolSpecFunctionDefinition(toolWithPlaceholders, baseContext)

			if (result.type === "function") {
				expect(result.function.description).to.equal("Width: 1280, Height: 720")
			}
		})

		it("should handle array type parameters", () => {
			const toolWithArray: ClineToolSpec = {
				...mockToolSpec,
				parameters: [
					{
						name: "items",
						required: true,
						instruction: "Array of items",
						type: "array",
						items: { type: "string" },
					},
				],
			}

			const result = toolSpecFunctionDefinition(toolWithArray, baseContext)

			if (result.type === "function") {
				const properties = result.function.parameters?.properties as any
				expect(properties.items).to.have.property("type", "array")
				expect(properties.items).to.have.property("items")
			}
		})

		it("should handle object type parameters", () => {
			const toolWithObject: ClineToolSpec = {
				...mockToolSpec,
				parameters: [
					{
						name: "config",
						required: true,
						instruction: "Configuration object",
						type: "object",
						properties: {
							key1: { type: "string" },
							key2: { type: "number" },
						},
					},
				],
			}

			const result = toolSpecFunctionDefinition(toolWithObject, baseContext)

			if (result.type === "function") {
				const properties = result.function.parameters?.properties as any
				expect(properties.config).to.have.property("type", "object")
				expect(properties.config).to.have.property("properties")
			}
		})

		it("should preserve additional JSON Schema fields", () => {
			const toolWithExtendedSchema: ClineToolSpec = {
				...mockToolSpec,
				parameters: [
					{
						name: "status",
						required: true,
						instruction: "Status value",
						type: "string",
						enum: ["active", "inactive", "pending"],
						minLength: 1,
						maxLength: 20,
					},
				],
			}

			const result = toolSpecFunctionDefinition(toolWithExtendedSchema, baseContext)

			if (result.type === "function") {
				const properties = result.function.parameters?.properties as any
				expect(properties.status).to.have.property("enum")
				expect(properties.status).to.have.property("minLength", 1)
				expect(properties.status).to.have.property("maxLength", 20)
			}
		})
	})

	describe("toolSpecInputSchema", () => {
		it("should convert ClineToolSpec to Anthropic Tool", () => {
			const result = toolSpecInputSchema(mockToolSpec, baseContext)

			expect(result).to.have.property("name", "test_tool")
			expect(result).to.have.property("description", "A test tool for unit testing")
			expect(result).to.have.nested.property("input_schema.type", "object")
			expect(result).to.have.nested.property("input_schema.properties.param1")
			expect(result).to.have.nested.property("input_schema.properties.param2")
			expect(result.input_schema.required).to.deep.equal(["param1"])
		})

		it("should handle tool without parameters", () => {
			const toolWithoutParams: ClineToolSpec = {
				...mockToolSpec,
				parameters: undefined,
			}

			const result = toolSpecInputSchema(toolWithoutParams, baseContext)

			expect(result.input_schema.properties).to.deep.equal({})
			expect(result.input_schema.required).to.deep.equal([])
		})

		it("should throw error when context requirements are not met", () => {
			const toolWithContextReq: ClineToolSpec = {
				...mockToolSpec,
				contextRequirements: () => false,
			}

			expect(() => toolSpecInputSchema(toolWithContextReq, baseContext)).to.throw(
				"Tool test_tool does not meet context requirements",
			)
		})
	})

	describe("toolSpecFunctionDeclarations", () => {
		it("should convert ClineToolSpec to Google Tool", () => {
			const result = toolSpecFunctionDeclarations(mockToolSpec, baseContext)

			expect(result).to.have.property("name", "test_tool")
			expect(result).to.have.property("description", "A test tool for unit testing")
			expect(result).to.have.nested.property("parameters.type", "OBJECT")
			expect(result).to.have.nested.property("parameters.properties.param1")
			expect(result).to.have.nested.property("parameters.properties.param2")
			expect(result.parameters?.required).to.deep.equal(["param1"])
		})

		it("should map parameter types to Google types", () => {
			const toolWithVariousTypes: ClineToolSpec = {
				...mockToolSpec,
				parameters: [
					{
						name: "str_param",
						required: true,
						instruction: "String param",
						type: "string",
					},
					{
						name: "num_param",
						required: false,
						instruction: "Number param",
						type: "integer",
					},
					{
						name: "bool_param",
						required: false,
						instruction: "Boolean param",
						type: "boolean",
					},
					{
						name: "obj_param",
						required: false,
						instruction: "Object param",
						type: "object",
					},
				],
			}

			const result = toolSpecFunctionDeclarations(toolWithVariousTypes, baseContext)

			expect(result.parameters?.properties?.str_param).to.have.property("type", "STRING")
			expect(result.parameters?.properties?.num_param).to.have.property("type", "NUMBER")
			expect(result.parameters?.properties?.bool_param).to.have.property("type", "BOOLEAN")
			expect(result.parameters?.properties?.obj_param).to.have.property("type", "OBJECT")
		})

		it("should skip parameters without names", () => {
			const toolWithUnnamedParam: ClineToolSpec = {
				...mockToolSpec,
				parameters: [
					{
						name: "",
						required: true,
						instruction: "Unnamed param",
						type: "string",
					},
					{
						name: "valid_param",
						required: true,
						instruction: "Valid param",
						type: "string",
					},
				],
			}

			const result = toolSpecFunctionDeclarations(toolWithUnnamedParam, baseContext)

			expect(result.parameters?.properties).to.not.have.property("")
			expect(result.parameters?.properties).to.have.property("valid_param")
		})

		it("should skip $schema property in nested properties", () => {
			const toolWithSchema: ClineToolSpec = {
				...mockToolSpec,
				parameters: [
					{
						name: "config",
						required: true,
						instruction: "Config object",
						type: "object",
						properties: {
							$schema: { type: "string" },
							validProp: { type: "string" },
						},
					},
				],
			}

			const result = toolSpecFunctionDeclarations(toolWithSchema, baseContext)

			expect(result.parameters?.properties?.config.properties).to.not.have.property("$schema")
			expect(result.parameters?.properties?.config.properties).to.have.property("validProp")
		})

		it("should handle enum values in nested properties", () => {
			const toolWithEnum: ClineToolSpec = {
				...mockToolSpec,
				parameters: [
					{
						name: "config",
						required: true,
						instruction: "Config object",
						type: "object",
						properties: {
							status: {
								type: "string",
								enum: ["active", "inactive"],
							},
						},
					},
				],
			}

			const result = toolSpecFunctionDeclarations(toolWithEnum, baseContext)

			expect(result.parameters?.properties?.config.properties?.status).to.have.property("enum")
			expect(result.parameters?.properties?.config.properties?.status.enum).to.deep.equal(["active", "inactive"])
		})
	})

	describe("openAIToolToAnthropic", () => {
		it("should convert OpenAI function tool to Anthropic format", () => {
			const openAITool: ChatCompletionTool = {
				type: "function" as const,
				function: {
					name: "test_function",
					description: "Test function",
					parameters: {
						type: "object" as const,
						properties: {
							param1: { type: "string" },
						},
						required: ["param1"],
					},
				},
			}

			const result = openAIToolToAnthropic(openAITool)

			expect(result).to.have.property("name", "test_function")
			expect(result).to.have.property("description", "Test function")
			expect(result).to.have.nested.property("input_schema.type", "object")
			expect(result).to.have.nested.property("input_schema.properties.param1")
			expect(result.input_schema.required).to.deep.equal(["param1"])
		})

		it("should handle missing description in OpenAI tool", () => {
			const openAITool: ChatCompletionTool = {
				type: "function" as const,
				function: {
					name: "test_function",
					parameters: {
						type: "object" as const,
						properties: {},
					},
				},
			}

			const result = openAIToolToAnthropic(openAITool)

			expect(result).to.have.property("description", "")
		})

		it("should handle missing parameters in OpenAI tool", () => {
			const openAITool: ChatCompletionTool = {
				type: "function" as const,
				function: {
					name: "test_function",
					description: "Test function",
				},
			}

			const result = openAIToolToAnthropic(openAITool)

			expect(result.input_schema.properties).to.deep.equal({})
			expect(result.input_schema.required).to.deep.equal([])
		})

		it("should convert custom tool with text format", () => {
			const openAITool = {
				type: "custom" as const,
				custom: {
					name: "custom_tool",
					description: "Custom tool",
					format: {
						type: "text" as const,
					},
				},
			}

			const result = openAIToolToAnthropic(openAITool as any)

			expect(result).to.have.property("name", "custom_tool")
			expect(result).to.have.property("description", "Custom tool")
			expect(result).to.have.nested.property("input_schema.properties.text")
		})

		it("should convert custom tool with non-text format", () => {
			const openAITool = {
				type: "custom" as const,
				custom: {
					name: "custom_tool",
					description: "Custom tool",
					format: {
						type: "json" as const,
					},
				},
			}

			const result = openAIToolToAnthropic(openAITool as any)

			expect(result).to.have.nested.property("input_schema.properties.grammar")
		})
	})

	describe("toOpenAIResponseTools", () => {
		it("should convert array of OpenAI tools to Response API format", () => {
			const openAITools: ChatCompletionTool[] = [
				{
					type: "function" as const,
					function: {
						name: "tool1",
						description: "First tool",
						parameters: {
							type: "object" as const,
							properties: { param1: { type: "string" } },
						},
						strict: false,
					},
				},
				{
					type: "function" as const,
					function: {
						name: "tool2",
						description: "Second tool",
						parameters: {
							type: "object" as const,
							properties: { param2: { type: "number" } },
						},
					},
				},
			]

			const result = toOpenAIResponseTools(openAITools)

			expect(result).to.have.length(2)
			expect(result[0]).to.have.property("name", "tool1")
			expect(result[0]).to.have.property("strict", false)
			expect(result[1]).to.have.property("name", "tool2")
			expect(result[1]).to.have.property("strict", true) // Default to true
		})

		it("should filter out non-function tools", () => {
			const openAITools: ChatCompletionTool[] = [
				{
					type: "function" as const,
					function: {
						name: "tool1",
						description: "First tool",
						parameters: {
							type: "object" as const,
							properties: {},
						},
					},
				},
			]

			const result = toOpenAIResponseTools(openAITools)

			expect(result).to.have.length(1)
			expect(result[0]).to.have.property("name", "tool1")
		})

		it("should handle null or undefined input", () => {
			const result1 = toOpenAIResponseTools(null as any)
			const result2 = toOpenAIResponseTools(undefined as any)

			expect(result1).to.deep.equal([])
			expect(result2).to.deep.equal([])
		})

		it("should handle empty array", () => {
			const result = toOpenAIResponseTools([])

			expect(result).to.deep.equal([])
		})
	})

	describe("toOpenAIResponsesAPITool", () => {
		it("should convert OpenAI function tool to Response API format", () => {
			const openAITool: ChatCompletionTool = {
				type: "function" as const,
				function: {
					name: "test_tool",
					description: "Test tool",
					strict: true,
					parameters: {
						type: "object" as const,
						properties: {
							param1: { type: "string" },
						},
						required: ["param1"],
					},
				},
			}

			const result = toOpenAIResponsesAPITool(openAITool)

			expect(result).to.have.property("type", "function")
			expect(result).to.have.property("name", "test_tool")
			expect(result).to.have.property("description", "Test tool")
			expect(result).to.have.property("strict", true)

			if (result.type === "function" && result.parameters) {
				expect(result.parameters).to.have.property("type", "object")
				expect(result.parameters).to.have.nested.property("properties.param1")
				expect(result.parameters.required).to.deep.equal(["param1"])
			}
		})

		it("should default strict to false if not provided", () => {
			const openAITool: ChatCompletionTool = {
				type: "function" as const,
				function: {
					name: "test_tool",
					description: "Test tool",
					parameters: {
						type: "object" as const,
						properties: {},
					},
				},
			}

			const result = toOpenAIResponsesAPITool(openAITool)

			expect(result).to.have.property("strict", false)
		})

		it("should handle missing description", () => {
			const openAITool: ChatCompletionTool = {
				type: "function" as const,
				function: {
					name: "test_tool",
					parameters: {
						type: "object" as const,
						properties: {},
					},
				},
			}

			const result = toOpenAIResponsesAPITool(openAITool)

			expect(result).to.have.property("description", "")
		})

		it("should convert custom tool with text format", () => {
			const openAITool = {
				type: "custom" as const,
				custom: {
					name: "custom_tool",
					description: "Custom tool",
					format: {
						type: "text" as const,
					},
				},
			}

			const result = toOpenAIResponsesAPITool(openAITool as any)

			expect(result).to.have.property("type", "function")
			expect(result).to.have.property("name", "custom_tool")
			expect(result).to.have.property("strict", false)

			if (result.type === "function" && result.parameters) {
				expect(result.parameters).to.have.nested.property("properties.text")
				expect(result.parameters.required).to.deep.equal(["text"])
			}
		})

		it("should convert custom tool with non-text format", () => {
			const openAITool = {
				type: "custom" as const,
				custom: {
					name: "custom_tool",
					description: "Custom tool",
					format: {
						type: "grammar" as const,
					},
				},
			}

			const result = toOpenAIResponsesAPITool(openAITool as any)

			if (result.type === "function" && result.parameters) {
				expect(result.parameters).to.have.nested.property("properties.grammar")
				expect(result.parameters.required).to.deep.equal(["text"])
			}
		})
	})
})
