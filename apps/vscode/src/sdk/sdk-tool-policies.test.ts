import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { describe, expect, it } from "vitest"
import type { McpHub } from "@/services/mcp/McpHub"
import { getMcpSdkToolName } from "./mcp-sdk-tool-name"
import { buildToolPolicies, getPlanModeApproval, isToolAutoApproved } from "./sdk-tool-policies"
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

describe("getPlanModeApproval", () => {
	const mcpHub = {
		getServers: () => [
			{
				name: "ide",
				tools: [
					{ name: "read", annotations: { readOnlyHint: true } },
					{ name: "rename", annotations: { readOnlyHint: false } },
					{ name: "run" },
					{ name: "allowed", allowInPlanMode: true },
					// Allowed by the user and declared read-only: the hint is what the footnote is about.
					{ name: "both", annotations: { readOnlyHint: true }, allowInPlanMode: true },
				],
			},
			{ name: "trusted", allowAllInPlanMode: true, tools: [{ name: "write" }] },
			// A server whose name contains the separator still resolves to its own tool.
			{ name: "a__b", tools: [{ name: "c" }] },
			{ name: MARKETPLACE_SERVER, tools: [{ name: "search" }, { name: "docs", annotations: { readOnlyHint: true } }] },
			{ name: LONG_SERVER, tools: [{ name: "write_file" }] },
		],
	} as unknown as McpHub

	it("asks before a tool with no read-only hint", () => {
		expect(getPlanModeApproval("ide__run", "plan", mcpHub)).toBe("ask")
		expect(getPlanModeApproval("a__b__c", "plan", mcpHub)).toBe("ask")
	})

	it("asks before a tool with no read-only hint whose name the SDK rewrites", () => {
		expect(getPlanModeApproval(getMcpSdkToolName(MARKETPLACE_SERVER, "search"), "plan", mcpHub)).toBe("ask")
		expect(getPlanModeApproval(getMcpSdkToolName(LONG_SERVER, "write_file"), "plan", mcpHub)).toBe("ask")
		expect(getPlanModeApproval(getMcpSdkToolName(MARKETPLACE_SERVER, "docs"), "plan", mcpHub)).toBe("read_only")
	})

	it("follows the tool that has the name when two servers produce it", () => {
		const readOnly = { name: "x", tools: [{ name: "y__z", annotations: { readOnlyHint: true } }] }
		const unhinted = { name: "x__y", tools: [{ name: "z" }] }
		const hubOf = (...servers: object[]) => ({ getServers: () => servers }) as unknown as McpHub

		expect(getPlanModeApproval("x__y__z", "plan", hubOf(readOnly, unhinted))).toBe("read_only")
		expect(getPlanModeApproval("x__y__z", "plan", hubOf(unhinted, readOnly))).toBe("ask")
	})

	it("asks before a tool Plan mode hides, in case an older session still offers it", () => {
		expect(getPlanModeApproval("ide__rename", "plan", mcpHub)).toBe("ask")
	})

	it("marks a declared read-only tool so the call can say why it ran", () => {
		expect(getPlanModeApproval("ide__read", "plan", mcpHub)).toBe("read_only")
		expect(getPlanModeApproval("ide__both", "plan", mcpHub)).toBe("read_only")
	})

	it("changes nothing for a tool or server the user allowed", () => {
		expect(getPlanModeApproval("ide__allowed", "plan", mcpHub)).toBeUndefined()
		expect(getPlanModeApproval("trusted__write", "plan", mcpHub)).toBeUndefined()
	})

	it("changes nothing outside Plan mode", () => {
		expect(getPlanModeApproval("ide__run", "act", mcpHub)).toBeUndefined()
		expect(getPlanModeApproval("ide__run", undefined, mcpHub)).toBeUndefined()
	})

	it("asks before an MCP tool its server no longer lists, as nothing is known about it", () => {
		expect(getPlanModeApproval("ide__unknown", "plan", mcpHub)).toBe("ask")
		expect(getPlanModeApproval("gone__tool", "plan", mcpHub)).toBe("ask")
	})

	it("changes nothing for tools that are not MCP tools", () => {
		expect(getPlanModeApproval("read_files", "plan", mcpHub)).toBeUndefined()
		expect(getPlanModeApproval("ide__run", "plan", undefined)).toBeUndefined()
	})
})
