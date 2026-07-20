import { describe, expect, it } from "vitest"
import { getRemoteMcpServerManagement } from "./remote-server-management"

describe("getRemoteMcpServerManagement", () => {
	it("keeps marked servers managed when their projected URL omits policy query parameters", () => {
		expect(
			getRemoteMcpServerManagement(
				"enterprise-server",
				JSON.stringify({
					url: "https://mcp.example.com/connect?[REDACTED]",
					remoteConfigured: true,
				}),
				[
					{
						name: "enterprise-server",
						url: "https://mcp.example.com/connect?tenant=acme",
						alwaysEnabled: true,
					},
				],
			),
		).toEqual({ isRemoteManagedServer: true, isAlwaysEnabled: true })
	})

	it("does not treat a personal server at the same endpoint as managed", () => {
		expect(
			getRemoteMcpServerManagement(
				"personal-server",
				JSON.stringify({ url: "https://mcp.example.com/connect?[REDACTED]" }),
				[
					{
						name: "enterprise-server",
						url: "https://mcp.example.com/connect?tenant=acme",
						alwaysEnabled: true,
					},
				],
			),
		).toEqual({ isRemoteManagedServer: false, isAlwaysEnabled: false })
	})

	it("keeps a marked server protected while remote policy is loading", () => {
		expect(getRemoteMcpServerManagement("enterprise-server", JSON.stringify({ remoteConfigured: true }), [])).toEqual({
			isRemoteManagedServer: true,
			isAlwaysEnabled: false,
		})
	})

	it("does not grant managed status to malformed projected config", () => {
		expect(getRemoteMcpServerManagement("enterprise-server", "not-json", [])).toEqual({
			isRemoteManagedServer: false,
			isAlwaysEnabled: false,
		})
	})
})
