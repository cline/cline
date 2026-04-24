import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { describe, expect, it } from "vitest"
import { buildToolPolicies } from "./sdk-tool-policies"

describe("buildToolPolicies", () => {
	it("maps auto-approval settings and MCP tool policies", () => {
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

		expect(policies.read_files).toEqual({ autoApprove: true })
		expect(policies.editor).toEqual({ autoApprove: false })
		expect(policies.execute_command).toEqual({ autoApprove: true })
		expect(policies.fetch_web_content).toEqual({ autoApprove: false })
		expect(policies.github__search).toEqual({ autoApprove: true })
		expect(policies.github__write).toEqual({ autoApprove: false })
	})
})
