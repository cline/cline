import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { describe, expect, it } from "vitest"
import type { McpHub } from "@/services/mcp/McpHub"
import { isToolAutoApproved } from "./sdk-tool-policies"

function settingsWithUseMcp(useMcp: boolean) {
	return {
		...DEFAULT_AUTO_APPROVAL_SETTINGS,
		actions: { ...DEFAULT_AUTO_APPROVAL_SETTINGS.actions, useMcp },
	}
}

// "weather" has a per-server autoApprove list (forecast is listed, alerts is
// not); "plain" has no list configured.
function hubWithServerList(): McpHub {
	return {
		getServers: () => [
			{
				name: "weather",
				tools: [
					{ name: "forecast", autoApprove: true },
					{ name: "alerts", autoApprove: false },
				],
			},
			{ name: "plain", tools: [{ name: "ping", autoApprove: false }] },
		],
	} as unknown as McpHub
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

	it("auto-approves a tool listed in its server's autoApprove list even when the toggle is off", () => {
		expect(isToolAutoApproved("weather__forecast", settingsWithUseMcp(false), hubWithServerList())).toBe(true)
	})

	it("auto-approves a listed tool when the toggle is on", () => {
		expect(isToolAutoApproved("weather__forecast", settingsWithUseMcp(true), hubWithServerList())).toBe(true)
	})

	it("prompts for an unlisted tool on a server that has a list, even when the toggle is on", () => {
		expect(isToolAutoApproved("weather__alerts", settingsWithUseMcp(true), hubWithServerList())).toBe(false)
	})

	it("prompts for an undiscovered tool on a server that has a list", () => {
		expect(isToolAutoApproved("weather__vanished", settingsWithUseMcp(true), hubWithServerList())).toBe(false)
	})

	it("keeps following the global toggle for servers without a list", () => {
		expect(isToolAutoApproved("plain__ping", settingsWithUseMcp(true), hubWithServerList())).toBe(true)
		expect(isToolAutoApproved("plain__ping", settingsWithUseMcp(false), hubWithServerList())).toBe(false)
	})

	it("falls back to the global toggle for unknown servers", () => {
		expect(isToolAutoApproved("ghost__boo", settingsWithUseMcp(true), hubWithServerList())).toBe(true)
		expect(isToolAutoApproved("ghost__boo", settingsWithUseMcp(false), hubWithServerList())).toBe(false)
	})
})
