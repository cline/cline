import { beforeEach, describe, expect, it, vi } from "vitest"
import discoveryFixture from "@/core/storage/remote-config/fixtures/user-remote-config-discovery.json"

const {
	fetchUserRemoteConfig,
	switchAccount,
	setSecret,
	isRemoteConfigEnabled,
	writeRemoteConfigToCache,
	readRemoteConfigFromCache,
	activeOrganization,
	axiosRequest,
} = vi.hoisted(() => ({
	fetchUserRemoteConfig: vi.fn(),
	switchAccount: vi.fn(),
	setSecret: vi.fn(),
	isRemoteConfigEnabled: vi.fn(),
	writeRemoteConfigToCache: vi.fn(),
	readRemoteConfigFromCache: vi.fn(),
	activeOrganization: { id: "org-current" as string | null },
	axiosRequest: vi.fn(),
}))

vi.mock("@/services/auth/AuthService", () => ({
	AuthService: {
		getInstance: () => ({
			getActiveOrganizationId: () => activeOrganization.id,
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

vi.mock("@/config", () => ({ ClineEnv: { config: () => ({ apiBaseUrl: "https://api.example.test" }) } }))
vi.mock("@/services/EnvUtils", () => ({ buildBasicClineHeaders: async () => ({}) }))
vi.mock("@/shared/net", () => ({ getAxiosSettings: () => ({}) }))
vi.mock("axios", () => ({ default: { request: axiosRequest } }))

import { SdkRemoteConfigControlPlane } from "@/core/storage/remote-config/sdk-control-plane"

describe("SdkRemoteConfigControlPlane", () => {
	beforeEach(() => {
		fetchUserRemoteConfig.mockReset()
		switchAccount.mockReset()
		setSecret.mockReset()
		isRemoteConfigEnabled.mockReset().mockReturnValue(true)
		writeRemoteConfigToCache.mockReset().mockResolvedValue(undefined)
		readRemoteConfigFromCache.mockReset().mockResolvedValue({ version: "v1" })
		activeOrganization.id = "org-current"
		lastManagedOrganization.id = undefined
		axiosRequest.mockReset().mockRejectedValue(new Error("offline"))
	})

	const lastManagedOrganization = { id: undefined as string | undefined }

	function makeControlPlane() {
		return new SdkRemoteConfigControlPlane({
			accountService: { switchAccount, fetchUserRemoteConfig },
			stateManager: {
				setSecret,
				getGlobalStateKey: ((key: string) =>
					key === "lastManagedOrganizationId" ? lastManagedOrganization.id : {}) as never,
			},
		})
	}

	it("adapts the discovery API contract without dropping rules, workflows, skills, or policy fields", async () => {
		activeOrganization.id = null
		fetchUserRemoteConfig.mockResolvedValue(discoveryFixture)
		const controlPlane = makeControlPlane()

		const bundle = await controlPlane.fetchBundle({ workspacePath: "/workspace" })

		expect(bundle?.metadata?.organizationId).toBe("org-contract")
		expect(bundle?.remoteConfig?.globalRules?.[0]?.name).toBe("Contract Rule")
		expect(bundle?.remoteConfig?.globalWorkflows?.[0]?.name).toBe("Contract Workflow")
		expect(bundle?.managedInstructions?.[0]?.name).toBe("Contract Skill")
		expect(bundle?.remoteConfig?.allowedMCPServers?.[0]?.id).toBe("https://github.com/example/contract-mcp")
		expect(bundle?.remoteConfig?.openTelemetryEnabled).toBe(true)
	})

	it("returns undefined and marks explicit no-config when discovery returns nothing while signed out", async () => {
		activeOrganization.id = null
		fetchUserRemoteConfig.mockResolvedValue(undefined)
		const controlPlane = makeControlPlane()

		const bundle = await controlPlane.fetchBundle({ workspacePath: "/workspace" })

		expect(bundle).toBeUndefined()
		expect(controlPlane.wasExplicitNoConfig()).toBe(true)
	})

	it("reports explicit no-config for a locally opted-out organization without any network call", async () => {
		activeOrganization.id = "org-current"
		isRemoteConfigEnabled.mockReturnValue(false)
		const controlPlane = makeControlPlane()

		const bundle = await controlPlane.fetchBundle({ workspacePath: "/workspace" })

		expect(bundle).toBeUndefined()
		expect(controlPlane.wasExplicitNoConfig()).toBe(true)
		expect(controlPlane.isRemoteConfigAvailable()).toBe(true)
		expect(fetchUserRemoteConfig).not.toHaveBeenCalled()
	})

	it("throws instead of reporting no-config when no auth token is available for an active organization", async () => {
		activeOrganization.id = "org-current"
		fetchUserRemoteConfig.mockResolvedValue(undefined)
		const controlPlane = makeControlPlane()

		await expect(controlPlane.fetchBundle({ workspacePath: "/workspace" })).rejects.toThrow(
			"Remote config discovery returned no response",
		)
		expect(controlPlane.wasExplicitNoConfig()).toBe(false)
	})

	it("throws instead of reporting no-config when identity restore fails on a previously managed install", async () => {
		// Offline cold start: auth restore failed, so BOTH the token and the
		// active org are gone — but the persisted marker says this install runs
		// under org policy. Reporting no-config would wipe the policy and the
		// marker, permanently disarming the fail-closed session gate.
		activeOrganization.id = null
		lastManagedOrganization.id = "org-previous"
		fetchUserRemoteConfig.mockResolvedValue(undefined)
		const controlPlane = makeControlPlane()

		await expect(controlPlane.fetchBundle({ workspacePath: "/workspace" })).rejects.toThrow(
			"Remote config discovery returned no response",
		)
		expect(controlPlane.wasExplicitNoConfig()).toBe(false)
	})

	it("reports explicit no-config when the server answers null for an active organization", async () => {
		activeOrganization.id = "org-current"
		fetchUserRemoteConfig.mockResolvedValue(null)
		const controlPlane = makeControlPlane()

		const bundle = await controlPlane.fetchBundle({ workspacePath: "/workspace" })

		expect(bundle).toBeUndefined()
		expect(controlPlane.wasExplicitNoConfig()).toBe(true)
	})

	it("wraps discovered remote config in a bundle when no organization is active", async () => {
		activeOrganization.id = null
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

	it("prefers the active organization even when discovery only lists another organization", async () => {
		activeOrganization.id = "org-b"
		fetchUserRemoteConfig.mockResolvedValue({
			organizationId: "org-a",
			value: JSON.stringify({ version: "org-a" }),
			organizations: [{ organizationId: "org-a", name: "A" }],
		})
		readRemoteConfigFromCache.mockResolvedValue({ version: "org-b" })
		const controlPlane = makeControlPlane()

		const bundle = await controlPlane.fetchBundle({ workspacePath: "/workspace" })

		expect(bundle?.metadata?.organizationId).toBe("org-b")
		expect(bundle?.remoteConfig?.version).toBe("org-b")
		expect(switchAccount).not.toHaveBeenCalled()
		expect(writeRemoteConfigToCache).toHaveBeenCalledWith("org-b", { version: "org-b" })
	})

	it("does not fall back to another organization when the active org is opted out", async () => {
		activeOrganization.id = "org-b"
		isRemoteConfigEnabled.mockImplementation((orgId: string) => orgId !== "org-b")
		fetchUserRemoteConfig.mockResolvedValue({
			organizationId: "org-a",
			value: JSON.stringify({ version: "org-a" }),
			organizations: [
				{ organizationId: "org-a", name: "A" },
				{ organizationId: "org-b", name: "B" },
			],
		})
		const controlPlane = makeControlPlane()

		const bundle = await controlPlane.fetchBundle({ workspacePath: "/workspace" })

		expect(bundle).toBeUndefined()
		expect(controlPlane.wasExplicitNoConfig()).toBe(true)
		expect(controlPlane.isRemoteConfigAvailable()).toBe(true)
		expect(switchAccount).not.toHaveBeenCalled()
	})

	it("reports unavailable when the active organization's remote config is disabled", async () => {
		activeOrganization.id = "org-b"
		fetchUserRemoteConfig.mockResolvedValue({
			organizationId: "org-a",
			value: JSON.stringify({ version: "org-a" }),
			organizations: [{ organizationId: "org-a", name: "A" }],
		})
		axiosRequest.mockResolvedValue({
			status: 200,
			data: { success: true, data: { enabled: false, value: "" } },
		})
		readRemoteConfigFromCache.mockResolvedValue(undefined)
		const controlPlane = makeControlPlane()

		const bundle = await controlPlane.fetchBundle({ workspacePath: "/workspace" })

		expect(bundle).toBeUndefined()
		expect(controlPlane.isRemoteConfigAvailable()).toBe(false)
		expect(switchAccount).not.toHaveBeenCalled()
	})

	it("throws instead of reporting no-config when the fetch fails and no cache exists", async () => {
		activeOrganization.id = "org-current"
		fetchUserRemoteConfig.mockResolvedValue({
			organizationId: "org-other",
			value: JSON.stringify({ version: "other" }),
		})
		axiosRequest.mockRejectedValue(new Error("network down"))
		readRemoteConfigFromCache.mockResolvedValue(undefined)
		const controlPlane = makeControlPlane()

		await expect(controlPlane.fetchBundle({ workspacePath: "/workspace" })).rejects.toThrow("network down")
		expect(controlPlane.wasExplicitNoConfig()).toBe(false)
	})

	it("filters disabled optional instructions from the effective SDK bundle", async () => {
		activeOrganization.id = null
		fetchUserRemoteConfig.mockResolvedValue({
			organizationId: "org-target",
			value: JSON.stringify({
				version: "v1",
				globalRules: [
					{ name: "Optional rule", alwaysEnabled: false, contents: "optional" },
					{ name: "Locked rule", alwaysEnabled: true, contents: "locked" },
				],
				globalWorkflows: [{ name: "Optional workflow", alwaysEnabled: false, contents: "workflow" }],
				globalSkills: [{ name: "Optional skill", alwaysEnabled: false, contents: "skill" }],
			}),
			organizations: [{ organizationId: "org-target", name: "Target" }],
		})
		const controlPlane = new SdkRemoteConfigControlPlane({
			accountService: { switchAccount, fetchUserRemoteConfig },
			stateManager: {
				setSecret,
				getGlobalStateKey: ((key: string) =>
					key === "lastManagedOrganizationId"
						? undefined
						: key === "remoteRulesToggles"
							? { "Optional rule": false, "Locked rule": false }
							: key === "remoteWorkflowToggles"
								? { "Optional workflow": false }
								: { "Optional skill": false }) as never,
			},
		})

		const bundle = await controlPlane.fetchBundle({ workspacePath: "/workspace" })

		expect(bundle?.remoteConfig?.globalRules?.map((entry) => entry.name)).toEqual(["Locked rule"])
		expect(bundle?.remoteConfig?.globalWorkflows).toEqual([])
		expect(bundle?.managedInstructions).toEqual([])
	})

	it("converts globalSkills to managed skill instructions", async () => {
		activeOrganization.id = "org-target"
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

	it("selects an enabled fallback org when no organization is active", async () => {
		activeOrganization.id = null
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
