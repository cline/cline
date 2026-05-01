import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { describe, expect, it } from "vitest"
import { buildToolPolicies, isToolAutoApproved } from "./sdk-tool-policies"

describe("buildToolPolicies", () => {
	it("forces managed tools through the approval callback and evaluates live auto-approval settings", () => {
		const settings: AutoApprovalSettings = {
			version: 1,
			enabled: true,
			favorites: [],
			actions: {
				readFiles: true,
				editFiles: false,
				executeSafeCommands: true,
				executeAllCommands: false,
				useBrowser: false,
				useMcp: true,
			},
			maxRequests: 20,
			enableNotifications: false,
		}
		const mcpHub = {
			getServers: () => [
				{
					name: "github",
					tools: [
						{ name: "search", autoApprove: true },
						{ name: "write", autoApprove: false },
					],
				},
			],
		}

		// biome-ignore lint/suspicious/noExplicitAny: minimal MCP hub fake for policy mapping
		const policies = buildToolPolicies(settings, mcpHub as any)

		expect(policies.read_files).toEqual({ autoApprove: false })
		expect(policies.editor).toEqual({ autoApprove: false })
		expect(policies.execute_command).toEqual({ autoApprove: false })
		expect(policies.fetch_web_content).toEqual({ autoApprove: false })
		expect(policies.github__search).toEqual({ autoApprove: false })
		expect(policies.github__write).toEqual({ autoApprove: false })

		expect(isToolAutoApproved("run_commands", settings, mcpHub as any)).toBe(true)
		expect(isToolAutoApproved("fetch_web_content", settings, mcpHub as any)).toBe(false)
		expect(isToolAutoApproved("github__search", settings, mcpHub as any)).toBe(true)
		expect(isToolAutoApproved("github__write", settings, mcpHub as any)).toBe(false)
	})

	it("does not auto-approve MCP tools when the global MCP action is disabled", () => {
		const settings: AutoApprovalSettings = {
			...makeSettings(),
			actions: { ...makeSettings().actions, useMcp: false },
		}
		const mcpHub = {
			getServers: () => [{ name: "github", tools: [{ name: "search", autoApprove: true }] }],
		}

		expect(isToolAutoApproved("github__search", settings, mcpHub as any)).toBe(false)
	})
})

function makeSettings(): AutoApprovalSettings {
	return {
		version: 1,
		enabled: true,
		favorites: [],
		actions: {
			readFiles: true,
			editFiles: false,
			executeSafeCommands: true,
			executeAllCommands: false,
			useBrowser: false,
			useMcp: true,
		},
		maxRequests: 20,
		enableNotifications: false,
	}
}
