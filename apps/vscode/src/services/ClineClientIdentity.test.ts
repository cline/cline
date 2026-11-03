import { beforeEach, describe, expect, it, vi } from "vitest"

const identityMocks = vi.hoisted(() => ({
	setClineClientIdentity: vi.fn(),
}))

const hostState = vi.hoisted(() => ({
	hostVersion: {} as {
		platform?: string
		version?: string
		clineType?: string
		clineVersion?: string
	},
	hostVersionError: undefined as Error | undefined,
}))

vi.mock("@cline/shared", () => ({
	setClineClientIdentity: identityMocks.setClineClientIdentity,
}))

vi.mock("@/hosts/host-provider", () => ({
	HostProvider: {
		env: {
			getHostVersion: vi.fn(async () => {
				if (hostState.hostVersionError) {
					throw hostState.hostVersionError
				}
				return hostState.hostVersion
			}),
		},
	},
}))

vi.mock("@/shared/services/Logger", () => ({
	Logger: { log: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock("@/registry", () => ({
	ExtensionRegistryInfo: { version: "9.9.9" },
}))

import { registerClineClientIdentity } from "./ClineClientIdentity"

describe("registerClineClientIdentity", () => {
	beforeEach(() => {
		identityMocks.setClineClientIdentity.mockClear()
		hostState.hostVersionError = undefined
		hostState.hostVersion = {
			platform: "Visual Studio Code",
			version: "1.103.0",
			clineType: "VSCode Extension",
			clineVersion: "3.40.0",
		}
	})

	it("publishes the host-reported client identity", async () => {
		await registerClineClientIdentity()

		expect(identityMocks.setClineClientIdentity).toHaveBeenCalledWith({
			name: "VSCode Extension",
			version: "3.40.0",
			platform: "Visual Studio Code",
			platformVersion: "1.103.0",
		})
	})

	it("falls back to the extension's own identity when the host bridge fails", async () => {
		hostState.hostVersionError = new Error("host bridge unavailable")

		await registerClineClientIdentity()

		expect(identityMocks.setClineClientIdentity).toHaveBeenCalledWith({
			name: "VSCode Extension",
			version: "9.9.9",
		})
	})
})
