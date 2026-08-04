import { beforeEach, describe, expect, it, vi } from "vitest"

const {
	fetchUserRemoteConfig,
	switchAccount,
	setSecret,
	isRemoteConfigEnabled,
	writeRemoteConfigToCache,
	readRemoteConfigFromCache,
} = vi.hoisted(() => ({
	fetchUserRemoteConfig: vi.fn(),
	switchAccount: vi.fn(),
	setSecret: vi.fn(),
	isRemoteConfigEnabled: vi.fn(),
	writeRemoteConfigToCache: vi.fn(),
	readRemoteConfigFromCache: vi.fn(),
}))

vi.mock("@/services/account/ClineAccountService", () => ({
	ClineAccountService: {
		getInstance: () => ({ fetchUserRemoteConfig }),
	},
}))

vi.mock("@/services/auth/AuthService", () => ({
	AuthService: {
		getInstance: () => ({
			getActiveOrganizationId: () => "org-current",
			getAuthToken: async () => "token",
		}),
	},
}))

vi.mock("@/core/storage/disk", () => ({
	deleteRemoteConfigFromCache: vi.fn(),
	readRemoteConfigFromCache,
	writeRemoteConfigToCache,
}))

vi.mock("@/core/storage/remote-config/utils", () => ({
	isRemoteConfigEnabled,
}))

vi.mock("@/services/EnvUtils", () => ({ buildBasicClineHeaders: async () => ({}) }))
vi.mock("@/shared/net", () => ({ getAxiosSettings: () => ({}) }))
vi.mock("axios", () => ({ default: { request: vi.fn() } }))

import { SdkRemoteConfigControlPlane } from "@/core/storage/remote-config/sdk-control-plane"

describe("SdkRemoteConfigControlPlane", () => {
	beforeEach(() => {
		fetchUserRemoteConfig.mockReset()
		switchAccount.mockReset()
		setSecret.mockReset()
		isRemoteConfigEnabled.mockReset().mockReturnValue(true)
		writeRemoteConfigToCache.mockReset().mockResolvedValue(undefined)
		readRemoteConfigFromCache.mockReset().mockResolvedValue({ version: "v1" })
	})

	function makeControlPlane() {
		return new SdkRemoteConfigControlPlane({
			accountService: { switchAccount },
			stateManager: { setSecret },
		})
	}

	it("returns undefined and marks explicit no-config when discovery returns nothing", async () => {
		fetchUserRemoteConfig.mockResolvedValue(undefined)
		const controlPlane = makeControlPlane()

		const bundle = await controlPlane.fetchBundle({ workspacePath: "/workspace" })

		expect(bundle).toBeUndefined()
		expect(controlPlane.wasExplicitNoConfig()).toBe(true)
	})

	it("wraps discovered remote config in a bundle", async () => {
		fetchUserRemoteConfig.mockResolvedValue({
			organizationId: "org-target",
			value: JSON.stringify({ version: "v1" }),
			organizations: [{ organizationId: "org-target", name: "Target" }],
		})
		const controlPlane = makeControlPlane()

		const bundle = await controlPlane.fetchBundle({ workspacePath: "/workspace" })

		expect(bundle?.source).toBe("cline-extension-remote-config")
		expect(bundle?.version).toBe("v1")
		expect(bundle?.remoteConfig?.version).toBe("v1")
		expect(controlPlane.getLastRemoteConfig()?.version).toBe("v1")
		expect(switchAccount).toHaveBeenCalledWith("org-target")
		expect(writeRemoteConfigToCache).toHaveBeenCalledWith("org-target", { version: "v1" })
	})

	it("converts globalSkills to managed skill instructions", async () => {
		fetchUserRemoteConfig.mockResolvedValue({
			organizationId: "org-target",
			value: JSON.stringify({
				version: "v1",
				globalSkills: [{ name: "Review Skill", alwaysEnabled: true, contents: "---\nname: Review Skill\n---\nUse it" }],
			}),
			organizations: [{ organizationId: "org-target", name: "Target" }],
		})
		const controlPlane = makeControlPlane()

		const bundle = await controlPlane.fetchBundle({ workspacePath: "/workspace" })

		expect(bundle?.managedInstructions).toEqual([
			{
				id: "remote-config:skill:0:Review Skill",
				name: "Review Skill",
				kind: "skill",
				contents: "---\nname: Review Skill\n---\nUse it",
				alwaysEnabled: true,
			},
		])
	})

	it("skips disabled active org and selects an enabled fallback org", async () => {
		isRemoteConfigEnabled.mockImplementation((orgId: string) => orgId === "org-fallback")
		fetchUserRemoteConfig.mockResolvedValue({
			organizationId: "org-disabled",
			value: JSON.stringify({ version: "disabled" }),
			organizations: [
				{ organizationId: "org-disabled", name: "Disabled" },
				{ organizationId: "org-fallback", name: "Fallback" },
			],
		})
		const controlPlane = makeControlPlane()

		const bundle = await controlPlane.fetchBundle({ workspacePath: "/workspace" })

		expect(bundle?.remoteConfig?.version).toBe("v1")
		expect(writeRemoteConfigToCache).toHaveBeenCalledWith("org-fallback", { version: "v1" })
	})
})
