import { expect } from "chai"
import type { McpHub } from "@/services/mcp/McpHub"
import type { McpServer } from "@/shared/mcp"
import { mockProviderInfo } from "../../__tests__/integration.test"
import type { PromptVariant, SystemPromptContext } from "../../types"
import { getMcp } from "../mcp"

function buildContext(servers: McpServer[]): SystemPromptContext {
	return {
		cwd: "/test/project",
		ide: "TestIde",
		supportsBrowserUse: true,
		mcpHub: {
			getServers: () => servers,
			getMcpServersPath: () => "/test/mcp-servers",
			getSettingsDirectoryPath: () => "/test/settings",
		} as unknown as McpHub,
		focusChainSettings: { enabled: true, remindClineInterval: 6 },
		browserSettings: { viewport: { width: 1280, height: 720 } },
		isTesting: true,
		providerInfo: mockProviderInfo,
	} as SystemPromptContext
}

const variant = {} as PromptVariant

describe("MCP component - server instructions", () => {
	it("renders server-level instructions when present", async () => {
		const servers: McpServer[] = [
			{
				name: "test-server",
				config: '{"command": "test"}',
				status: "connected",
				instructions: "Always greet the user before answering.",
				tools: [{ name: "test_tool", description: "A test tool" }],
			},
		]

		const result = (await getMcp(variant, buildContext(servers))) ?? ""
		expect(result).to.contain("### Instructions")
		expect(result).to.contain("Always greet the user before answering.")
	})

	it("omits the Instructions section when no instructions are provided", async () => {
		const servers: McpServer[] = [
			{
				name: "test-server",
				config: '{"command": "test"}',
				status: "connected",
				tools: [{ name: "test_tool", description: "A test tool" }],
			},
		]

		const result = (await getMcp(variant, buildContext(servers))) ?? ""
		expect(result).to.not.contain("### Instructions")
	})

	it("ignores blank instructions", async () => {
		const servers: McpServer[] = [
			{
				name: "test-server",
				config: '{"command": "test"}',
				status: "connected",
				instructions: "   \n  ",
				tools: [{ name: "test_tool", description: "A test tool" }],
			},
		]

		const result = (await getMcp(variant, buildContext(servers))) ?? ""
		expect(result).to.not.contain("### Instructions")
	})
})
