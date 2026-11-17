import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { describe, expect, it } from "vitest"
import type { McpHub } from "@/services/mcp/McpHub"
import { getMcpSdkToolName } from "./mcp-sdk-tool-name"
import { buildToolPolicies, isToolAutoApproved } from "./sdk-tool-policies"
import { createVscodeExtraTools } from "./vscode-runtime-builder"

// Names the SDK rewrites: characters a provider rejects, and one too long to keep its separator.
const MARKETPLACE_SERVER = "github.com/upstash/context7-mcp"
const LONG_SERVER = "github.com/modelcontextprotocol/servers/tree/main/src/filesystem"

const useMcp = (enabled: boolean) => ({
	...DEFAULT_AUTO_APPROVAL_SETTINGS,
	actions: { ...DEFAULT_AUTO_APPROVAL_SETTINGS.actions, useMcp: enabled },
})

describe("buildToolPolicies", () => {
	it("sends every MCP tool a session registers through the approval callback", async () => {
		const tool = (name: string) => ({ name, inputSchema: { type: "object" } })
		const mcpHub = {
			getServers: () => [
				{ name: "ide", config: "{}", tools: [tool("run")] },
				{ name: MARKETPLACE_SERVER, config: "{}", tools: [tool("resolve-library-id")] },
				{ name: "Home Assistant", config: "{}", tools: [tool("turn on")] },
				{ name: LONG_SERVER, config: "{}", tools: [tool("read_file"), tool("write_file")] },
				{ name: "a__b", config: "{}", tools: [tool("c")] },
			],
		} as unknown as McpHub

		const registered = (await createVscodeExtraTools(mcpHub, {})).map((registeredTool) => registeredTool.name)
		const policies = buildToolPolicies(DEFAULT_AUTO_APPROVAL_SETTINGS, mcpHub)

		expect(registered).toHaveLength(6)
		for (const name of registered) {
			expect(policies[name], name).toEqual({ autoApprove: false })
		}
	})
})

describe("isToolAutoApproved", () => {
	it("does not auto-approve command tools by default", () => {
		expect(isToolAutoApproved("run_commands", DEFAULT_AUTO_APPROVAL_SETTINGS)).toBe(false)
	})

	it("uses executeSafeCommands as the single command approval flag", () => {
		const settings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				executeSafeCommands: false,
				executeAllCommands: true,
			},
		}

		expect(isToolAutoApproved("run_commands", settings)).toBe(false)
	})

	it("auto-approves all MCP tools when the Use MCP servers toggle is on", () => {
		const settings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: { ...DEFAULT_AUTO_APPROVAL_SETTINGS.actions, useMcp: true },
		}

		expect(isToolAutoApproved("firecrawl__scrape", settings)).toBe(true)
	})

	it("prompts for MCP tools when the Use MCP servers toggle is off", () => {
		const settings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: { ...DEFAULT_AUTO_APPROVAL_SETTINGS.actions, useMcp: false },
		}

		expect(isToolAutoApproved("firecrawl__scrape", settings)).toBe(false)
	})

	it("applies the Use MCP servers toggle to a tool whose rewritten name has no separator", () => {
		const mcpHub = { getServers: () => [{ name: LONG_SERVER, tools: [{ name: "read_file" }] }] } as unknown as McpHub
		const sdkName = getMcpSdkToolName(LONG_SERVER, "read_file")

		expect(sdkName).not.toContain("__")
		expect(isToolAutoApproved(sdkName, useMcp(true), mcpHub)).toBe(true)
		expect(isToolAutoApproved(sdkName, useMcp(false), mcpHub)).toBe(false)
	})
})
