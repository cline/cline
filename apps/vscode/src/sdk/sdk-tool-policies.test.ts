import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import type { McpHub } from "@/services/mcp/McpHub"
import { describe, expect, it } from "vitest"
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

// Minimal stand-in for the hub: only the surface the policy code reads.
function fakeHub(): McpHub {
	return {
		getServers: () => [
			{
				name: "db",
				tools: [
					{ name: "search_rows", autoApprove: true },
					{ name: "drop_all_tables", autoApprove: false },
				],
			},
			{
				name: "files",
				tools: [{ name: "read_note", autoApprove: true }],
			},
		],
	} as unknown as McpHub
}

function settings(useMcp: boolean): AutoApprovalSettings {
	return { actions: { useMcp } } as AutoApprovalSettings
}

describe("MCP per-tool autoApprove (cline/cline#15574)", () => {
	it("buildToolPolicies approves only listed tools", () => {
		const policies = buildToolPolicies(settings(true), fakeHub())
		expect(policies["db__search_rows"]).toEqual({ autoApprove: true })
		expect(policies["db__drop_all_tables"]).toEqual({ autoApprove: false })
		expect(policies["files__read_note"]).toEqual({ autoApprove: true })
	})

	it("buildToolPolicies approves nothing when the global toggle is off", () => {
		const policies = buildToolPolicies(settings(false), fakeHub())
		expect(policies["db__search_rows"]).toEqual({ autoApprove: false })
		expect(policies["files__read_note"]).toEqual({ autoApprove: false })
	})

	it("isToolAutoApproved: listed runs silent, unlisted prompts", () => {
		const hub = fakeHub()
		expect(isToolAutoApproved("db__search_rows", settings(true), hub)).toBe(true)
		expect(isToolAutoApproved("db__drop_all_tables", settings(true), hub)).toBe(false)
	})

	it("isToolAutoApproved: listed still prompts when the global toggle is off", () => {
		expect(isToolAutoApproved("db__search_rows", settings(false), fakeHub())).toBe(false)
	})

	it("isToolAutoApproved: unknown server/tool fails closed (prompts)", () => {
		const hub = fakeHub()
		expect(isToolAutoApproved("nope__search_rows", settings(true), hub)).toBe(false)
		expect(isToolAutoApproved("db__no_such_tool", settings(true), hub)).toBe(false)
	})

	it("isToolAutoApproved without a hub keeps the legacy global behavior", () => {
		expect(isToolAutoApproved("db__search_rows", settings(true))).toBe(true)
		expect(isToolAutoApproved("db__search_rows", settings(false))).toBe(false)
	})
})
