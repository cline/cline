import { beforeEach, describe, expect, it, vi } from "vitest"

const hostState = vi.hoisted(() => ({
	hostVersion: {} as {
		platform?: string
		version?: string
		clineType?: string
		clineVersion?: string
	},
	hostVersionError: undefined as Error | undefined,
	workspacePaths: [] as string[],
}))

vi.mock("@/hosts/host-provider", () => ({
	HostProvider: {
		workspace: { getWorkspacePaths: async () => ({ paths: hostState.workspacePaths }) },
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

import { resolveClineClientIdentity } from "./ClineClientIdentity"

describe("resolveClineClientIdentity", () => {
	beforeEach(() => {
		hostState.hostVersionError = undefined
		hostState.workspacePaths = []
		hostState.hostVersion = {
			platform: "Visual Studio Code",
			version: "1.103.0",
			clineType: "VSCode Extension",
			clineVersion: "3.40.0",
		}
	})

	it("publishes the host-reported client identity", async () => {
		const identity = await resolveClineClientIdentity()

		expect(identity).toEqual({
			isMultiRoot: false,
			name: "VSCode Extension",
			version: "3.40.0",
			platform: "Visual Studio Code",
			platformVersion: "1.103.0",
		})
	})

	it("includes the workspace multiroot state", async () => {
		hostState.workspacePaths = ["/one", "/two"]
		expect((await resolveClineClientIdentity()).isMultiRoot).toBe(true)
	})

	it("falls back to the extension's own identity when the host bridge fails", async () => {
		hostState.hostVersionError = new Error("host bridge unavailable")

		const identity = await resolveClineClientIdentity()

		expect(identity).toEqual({
			isMultiRoot: false,
			name: "VSCode Extension",
			version: "9.9.9",
		})
	})
})
