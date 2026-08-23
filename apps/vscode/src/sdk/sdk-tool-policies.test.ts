import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import type { McpTool } from "@shared/mcp"
import { describe, expect, it } from "vitest"
import type { McpHub } from "@/services/mcp/McpHub"
import { buildToolPolicies, isToolAutoApproved } from "./sdk-tool-policies"

function stubHub(serverName: string, tools: McpTool[]): McpHub {
	return { getServers: () => [{ name: serverName, tools }] } as unknown as McpHub
}

function settingsWithUseMcp(useMcp: boolean) {
	return {
		...DEFAULT_AUTO_APPROVAL_SETTINGS,
		actions: { ...DEFAULT_AUTO_APPROVAL_SETTINGS.actions, useMcp },
	}
}

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

	it("auto-approves MCP tools when the Use MCP servers toggle is on, without per-tool flags", () => {
		const hub = stubHub("firecrawl", [{ name: "scrape", autoApprove: false }])
		expect(isToolAutoApproved("firecrawl__scrape", settingsWithUseMcp(true), hub)).toBe(true)
	})

	it("auto-approves per-tool flagged MCP tools even when the Use MCP servers toggle is off", () => {
		const hub = stubHub("firecrawl", [{ name: "scrape", autoApprove: true }])
		expect(isToolAutoApproved("firecrawl__scrape", settingsWithUseMcp(false), hub)).toBe(true)
	})

	it("prompts for MCP tools when both the toggle and the per-tool flag are off", () => {
		const hub = stubHub("firecrawl", [{ name: "scrape", autoApprove: false }])
		expect(isToolAutoApproved("firecrawl__scrape", settingsWithUseMcp(false), hub)).toBe(false)
	})

	it("matches MCP tools whose SDK name was sanitized by the name transform", () => {
		// Marketplace-style server names contain characters the SDK name transform
		// sanitizes and hash-suffixes, so the SDK tool name differs from `server__tool`.
		const hub = stubHub("github.com/upstash/context7-mcp", [{ name: "resolve-library-id", autoApprove: true }])
		const [sdkName] = Object.keys(buildToolPolicies(DEFAULT_AUTO_APPROVAL_SETTINGS, hub)).filter((name) =>
			name.includes("context7"),
		)
		expect(sdkName).not.toBe("github.com/upstash/context7-mcp__resolve-library-id")
		expect(isToolAutoApproved(sdkName, settingsWithUseMcp(false), hub)).toBe(true)
	})

	it("does not auto-approve unknown tool names", () => {
		const hub = stubHub("firecrawl", [{ name: "scrape", autoApprove: true }])
		expect(isToolAutoApproved("otherserver__scrape", settingsWithUseMcp(true), hub)).toBe(false)
	})
})

describe("buildToolPolicies", () => {
	it("keys MCP policies by the registered SDK tool name so the SDK always asks", () => {
		const hub = stubHub("github.com/upstash/context7-mcp", [{ name: "resolve-library-id" }])
		const policies = buildToolPolicies(DEFAULT_AUTO_APPROVAL_SETTINGS, hub)
		expect(policies["github_com_upstash_context7-mcp__resolve-library-id_2338e8c6"]).toEqual({ autoApprove: false })
	})
})
