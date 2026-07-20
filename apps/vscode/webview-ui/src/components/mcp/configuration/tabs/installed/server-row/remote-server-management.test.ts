import { describe, expect, it } from "vitest"
import { getRemoteMcpServerManagement } from "./remote-server-management"

describe("getRemoteMcpServerManagement", () => {
	it("uses the marker and server name when transport details are not projected", () => {
		expect(
			getRemoteMcpServerManagement("enterprise-server", JSON.stringify({ remoteConfigured: true }), [
				{
					name: "enterprise-server",
					url: "https://mcp.example.com/connect?tenant=acme",
					alwaysEnabled: true,
				},
			]),
		).toEqual({ isRemoteManagedServer: true, isAlwaysEnabled: true })
	})

	it("does not treat an unmarked personal server as managed", () => {
		expect(
			getRemoteMcpServerManagement("personal-server", JSON.stringify({}), [
				{
					name: "enterprise-server",
					url: "https://mcp.example.com/connect?tenant=acme",
					alwaysEnabled: true,
				},
			]),
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
