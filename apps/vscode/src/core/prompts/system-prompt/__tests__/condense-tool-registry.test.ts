import { expect } from "chai"
import { beforeEach, describe, it } from "mocha"
import type { ApiProviderInfo } from "@/core/api"
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getSystemPrompt } from "../index"
import { ClineToolSet } from "../registry/ClineToolSet"
import { PromptRegistry } from "../registry/PromptRegistry"
import type { SystemPromptContext } from "../types"

const mockProviderInfo: ApiProviderInfo = {
	providerId: "test",
	model: { id: "test-model", info: { supportsPromptCache: false } as any },
	mode: "act",
}

const makeContext = (overrides: Partial<SystemPromptContext> = {}): SystemPromptContext => ({
	cwd: "/test/project",
	ide: "TestIde",
	supportsBrowserUse: true,
	isTesting: true,
	providerInfo: mockProviderInfo,
	...overrides,
})

const toolNamesFrom = (tools: Awaited<ReturnType<typeof getSystemPrompt>>["tools"]): string[] =>
	(tools ?? [])
		.map((tool: any) => tool?.function?.name ?? tool?.name)
		.filter((name): name is string => typeof name === "string")

describe("condense tool registry", () => {
	beforeEach(() => {
		PromptRegistry.dispose()
	})

	it("condense tool spec is registered in ClineToolSet after PromptRegistry init", () => {
		PromptRegistry.getInstance()
		const tool = ClineToolSet.getToolByNameWithFallback(ClineDefaultTool.CONDENSE, ModelFamily.GENERIC)

		expect(tool).to.exist
		expect(tool?.config.name).to.equal("condense")
		expect(tool?.config.id).to.equal(ClineDefaultTool.CONDENSE)
	})

	it("getSystemPrompt includes condense in native tools for GPT-5 provider", async () => {
		const context: SystemPromptContext = makeContext({
			providerInfo: {
				providerId: "openai",
				model: { id: "gpt-5", info: { supportsPromptCache: false } as any },
				mode: "act",
			} satisfies ApiProviderInfo,
			enableNativeToolCalls: true,
		})

		const { tools } = await getSystemPrompt(context)
		const toolNames = toolNamesFrom(tools)

		expect(toolNames).to.include("condense")
	})

	it("getSystemPrompt includes condense tool description in system prompt for GPT-5 XML mode", async () => {
		const context: SystemPromptContext = makeContext({
			providerInfo: {
				providerId: "openai",
				model: { id: "gpt-5", info: { supportsPromptCache: false } as any },
				mode: "act",
			} satisfies ApiProviderInfo,
			enableNativeToolCalls: false,
		})

		const { systemPrompt } = await getSystemPrompt(context)

		expect(systemPrompt).to.include("condense")
	})

	it("getSystemPrompt includes condense in native tools for Claude next-gen provider", async () => {
		const context: SystemPromptContext = makeContext({
			providerInfo: {
				providerId: "anthropic",
				model: { id: "claude-opus-4-6", info: { supportsPromptCache: false } as any },
				mode: "act",
			} satisfies ApiProviderInfo,
			enableNativeToolCalls: true,
		})

		const { tools } = await getSystemPrompt(context)
		const toolNames = toolNamesFrom(tools)

		expect(toolNames).to.include("condense")
	})
})
