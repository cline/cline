import { defaultMcpToolNameTransform } from "@cline/core"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { describe, expect, it } from "vitest"
import type { McpHub } from "@/services/mcp/McpHub"
import { buildToolPolicies, isToolAutoApproved } from "./sdk-tool-policies"

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
})

describe("buildToolPolicies", () => {
	const hubWith = (servers: { name: string; tools: { name: string }[] }[]) =>
		({ getServers: () => servers }) as unknown as McpHub

	it("keys MCP tool policies by the registered tool name", () => {
		const policies = buildToolPolicies(
			DEFAULT_AUTO_APPROVAL_SETTINGS,
			hubWith([{ name: "firecrawl", tools: [{ name: "scrape" }] }]),
		)

		expect(policies.firecrawl__scrape).toEqual({ autoApprove: false })
	})

	it("keys MCP tool policies by the transformed name when the server name is rewritten", () => {
		const longServerName = `server-${"x".repeat(70)}`
		const policies = buildToolPolicies(
			DEFAULT_AUTO_APPROVAL_SETTINGS,
			hubWith([
				{ name: "github.com/user/repo", tools: [{ name: "search_issues" }] },
				{ name: longServerName, tools: [{ name: "run" }] },
			]),
		)
		const keys = Object.keys(policies)

		const marketplaceName = defaultMcpToolNameTransform({ serverName: "github.com/user/repo", toolName: "search_issues" })
		expect(marketplaceName).toMatch(/^github_com_user_repo__search_issues_[0-9a-f]{8}$/)
		expect(keys).toContain(marketplaceName)
		expect(keys).not.toContain("github.com/user/repo__search_issues")
		expect(policies[marketplaceName]).toEqual({ autoApprove: false })

		const longName = defaultMcpToolNameTransform({ serverName: longServerName, toolName: "run" })
		expect(longName.length).toBeLessThanOrEqual(64)
		expect(keys).toContain(longName)
		expect(policies[longName]).toEqual({ autoApprove: false })
	})
})
