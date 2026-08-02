import { expect } from "chai"
import { describe, it } from "mocha"
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { toolSpecFunctionDeclarations, toolSpecFunctionDefinition, toolSpecInputSchema } from "../spec"
import type { SystemPromptContext } from "../types"

const mockContext: SystemPromptContext = {
	cwd: "/test/project",
	ide: "TestIde",
	supportsBrowserUse: true,
	clineWebToolsEnabled: true,
	subagentsEnabled: true,
	providerInfo: { providerId: "test", model: { id: "test-model", info: { supportsPromptCache: false } }, mode: "act" },
	enableNativeToolCalls: false,
	isTesting: true,
}

const makeTool = (overrides?: Partial<ClineToolSpec>): ClineToolSpec => ({
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.FILE_READ,
	name: "read_file",
	description: "Read a file",
	parameters: [
		{
			name: "path",
			required: true,
			instruction: "The path of the file to read relative to {{CWD}}",
		},
		{
			name: "optional_param",
			required: false,
			instruction: "An optional parameter",
		},
	],
	...overrides,
})

describe("toolSpecFunctionDeclarations (Gemini)", () => {
	it("includes parameter descriptions from instruction field", () => {
		const result = toolSpecFunctionDeclarations(makeTool(), mockContext)

		const pathParam = result.parameters?.properties?.["path"] as any
		expect(pathParam).to.exist
		expect(pathParam.description).to.be.a("string")
		expect(pathParam.description).to.include("path of the file to read")
	})

	it("includes descriptions for all parameters", () => {
		const result = toolSpecFunctionDeclarations(makeTool(), mockContext)

		const props = result.parameters?.properties as any
		expect(props["path"].description).to.be.a("string").and.not.be.empty
		expect(props["optional_param"].description).to.be.a("string").and.not.be.empty
	})

	it("handles function-type instructions", () => {
		const tool = makeTool({
			parameters: [
				{
					name: "dynamic",
					required: true,
					instruction: (ctx: SystemPromptContext) => `Dynamic value: ${ctx.cwd}`,
				},
			],
		})
		const result = toolSpecFunctionDeclarations(tool, mockContext)

		const param = result.parameters?.properties?.["dynamic"] as any
		expect(param.description).to.equal("Dynamic value: /test/project")
	})

	it("omits description when instruction is empty", () => {
		const tool = makeTool({
			parameters: [{ name: "empty", required: false, instruction: "" }],
		})
		const result = toolSpecFunctionDeclarations(tool, mockContext)

		const param = result.parameters?.properties?.["empty"] as any
		expect(param.description).to.be.undefined
	})
})

const makeNestedMcpTool = (): ClineToolSpec =>
	makeTool({
		name: "create_workflow",
		description: "Create a workflow",
		parameters: [
			{
				name: "definition",
				required: ["rules", "steps"],
				instruction: "The workflow definition",
				type: "object",
				properties: {
					rules: {
						type: "array",
						items: {
							type: "object",
							properties: { rule_no: { type: "string", description: "The rule number" } },
							required: ["rule_no"],
						},
					},
					steps: {
						type: "array",
						items: {
							type: "object",
							properties: { step_no: { type: "string" } },
							required: ["step_no"],
						},
					},
				},
			} as any,
		],
	})

describe("toolSpecFunctionDeclarations (Gemini) nested MCP schemas", () => {
	it("converts an array<object> parameter to the schema the issue expects", () => {
		const result = toolSpecFunctionDeclarations(makeNestedMcpTool(), mockContext)

		expect(result.parameters?.properties?.["definition"]).to.deep.equal({
			type: "OBJECT",
			description: "The workflow definition",
			properties: {
				rules: {
					type: "ARRAY",
					items: {
						type: "OBJECT",
						properties: { rule_no: { type: "STRING", description: "The rule number" } },
						required: ["rule_no"],
					},
				},
				steps: {
					type: "ARRAY",
					items: {
						type: "OBJECT",
						properties: { step_no: { type: "STRING" } },
						required: ["step_no"],
					},
				},
			},
			required: ["rules", "steps"],
		})
	})

	it("maps a nullable type union to its non-null member", () => {
		const tool = makeTool({
			parameters: [{ name: "note", required: false, instruction: "An optional note", type: ["string", "null"] } as any],
		})
		const result = toolSpecFunctionDeclarations(tool, mockContext)

		const note = result.parameters?.properties?.["note"] as any
		expect(note.type).to.equal("STRING")
	})

	it("carries items for a top-level array parameter", () => {
		const tool = makeTool({
			parameters: [
				{
					name: "tags",
					required: true,
					instruction: "A list of tags",
					type: "array",
					items: { type: "string" },
				},
			],
		})
		const result = toolSpecFunctionDeclarations(tool, mockContext)

		const tags = result.parameters?.properties?.["tags"] as any
		expect(tags.type).to.equal("ARRAY")
		expect(tags.items).to.deep.equal({ type: "STRING" })
	})

	it("falls back to string items when an array declares none", () => {
		const tool = makeTool({
			parameters: [{ name: "tags", required: true, instruction: "A list of tags", type: "array" }],
		})
		const result = toolSpecFunctionDeclarations(tool, mockContext)

		const tags = result.parameters?.properties?.["tags"] as any
		expect(tags.type).to.equal("ARRAY")
		expect(tags.items).to.deep.equal({ type: "STRING" })
	})

	it("describes a nested property from its own description, not the parent instruction", () => {
		const tool = makeTool({
			parameters: [
				{
					name: "config",
					required: true,
					instruction: "The parent instruction",
					type: "object",
					properties: { retries: { type: "integer", description: "How many times to retry" } },
				},
			],
		})
		const result = toolSpecFunctionDeclarations(tool, mockContext)

		const retries = (result.parameters?.properties?.["config"] as any).properties.retries
		expect(retries.type).to.equal("NUMBER")
		expect(retries.description).to.equal("How many times to retry")
	})
})

describe("Gemini and Anthropic parameter descriptions match", () => {
	it("both converters produce the same description text", () => {
		const tool = makeTool()
		const gemini = toolSpecFunctionDeclarations(tool, mockContext)
		const anthropic = toolSpecInputSchema(tool, mockContext)

		const geminiDesc = (gemini.parameters?.properties?.["path"] as any)?.description
		const anthropicDesc = (anthropic.input_schema as any).properties["path"]?.description

		expect(geminiDesc).to.equal(anthropicDesc)
	})
})

describe("native tool placeholder replacement", () => {
	it("replaces CWD and MULTI_ROOT_HINT placeholders in descriptions", () => {
		const context: SystemPromptContext = {
			...mockContext,
			isMultiRootEnabled: true,
		}
		const tool = makeTool({
			parameters: [
				{
					name: "path",
					required: true,
					instruction: "Path (relative to {{CWD}}){{MULTI_ROOT_HINT}}",
				},
			],
		})

		const openAI = toolSpecFunctionDefinition(tool, context)
		const anthropic = toolSpecInputSchema(tool, context)
		const gemini = toolSpecFunctionDeclarations(tool, context)

		const openAIDesc = ((openAI as any).function.parameters.properties.path as any).description as string
		const anthropicDesc = ((anthropic as any).input_schema.properties.path as any).description as string
		const geminiDesc = (gemini.parameters?.properties?.["path"] as any)?.description as string

		for (const desc of [openAIDesc, anthropicDesc, geminiDesc]) {
			expect(desc).to.include("/test/project")
			expect(desc).to.include("Use @workspace:path syntax")
			expect(desc).to.not.include("{{CWD}}")
			expect(desc).to.not.include("{{MULTI_ROOT_HINT}}")
		}
	})
})
