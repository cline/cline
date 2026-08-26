import { describe, expect, it } from "vitest"
import { parseOrganizationRemoteConfigResponse, parseRemoteConfigDiscovery, parseRemoteConfigValue } from "./contracts"
import organizationResponseFixture from "./fixtures/organization-remote-config-response.json"
import discoveryFixture from "./fixtures/user-remote-config-discovery.json"

describe("remote-config API contracts", () => {
	it("parses discovery and preserves all managed instruction types", () => {
		const discovery = parseRemoteConfigDiscovery(discoveryFixture)
		const config = parseRemoteConfigValue(discovery.value)

		expect(discovery.organizationId).toBe("org-contract")
		expect(config.globalRules?.[0]?.name).toBe("Contract Rule")
		expect(config.globalWorkflows?.[0]?.name).toBe("Contract Workflow")
		expect(config.globalSkills?.[0]?.name).toBe("Contract Skill")
		expect(config.allowedMCPServers?.[0]?.id).toBe("https://github.com/example/contract-mcp")
		expect(config.openTelemetryEnabled).toBe(true)
	})

	it("parses the organization response envelope and preserves host policy fields", () => {
		const result = parseOrganizationRemoteConfigResponse(organizationResponseFixture)

		expect(result.enabled).toBe(true)
		expect(result.remoteConfig?.version).toBe("contract-v2")
		expect(result.remoteConfig?.globalRules?.[0]?.name).toBe("Fetched Rule")
		expect(result.remoteConfig?.globalWorkflows?.[0]?.name).toBe("Fetched Workflow")
		expect(result.remoteConfig?.globalSkills?.[0]?.name).toBe("Fetched Skill")
		expect(result.remoteConfig?.blockPersonalRemoteMCPServers).toBe(true)
		expect(result.remoteConfig?.remoteMCPServers?.[0]?.name).toBe("managed")
	})

	it("rejects malformed discovery instead of silently dropping it", () => {
		expect(() => parseRemoteConfigDiscovery({ organizationId: "", value: "{}" })).toThrow()
	})
})
