import { RemoteConfigType, ToggleRemoteConfigSettingRequest } from "@shared/proto/cline/remote_config"
import { describe, expect, it, vi } from "vitest"
import { toggleRemoteConfigSetting } from "./toggleRemoteConfigSetting"

function makeController(options: { locked?: boolean } = {}) {
	const stores: Record<string, Record<string, boolean>> = {
		remoteRulesToggles: {},
		remoteWorkflowToggles: {},
		remoteSkillsToggles: {},
	}
	const controller = {
		stateManager: {
			getRemoteConfigSettings: () => ({
				remoteGlobalRules: [{ name: "Shared", contents: "rule", alwaysEnabled: options.locked }],
				remoteGlobalWorkflows: [{ name: "Shared", contents: "workflow", alwaysEnabled: false }],
				remoteGlobalSkills: [{ name: "Shared", contents: "skill", alwaysEnabled: false }],
			}),
			getGlobalStateKey: (key: string) => stores[key],
			setGlobalState: vi.fn((key: string, value: Record<string, boolean>) => {
				stores[key] = value
			}),
		},
		rematerializeRemoteConfig: vi.fn().mockResolvedValue(undefined),
	}
	return { controller, stores }
}

describe("toggleRemoteConfigSetting", () => {
	it.each([
		[RemoteConfigType.RULE, "remoteRulesToggles"],
		[RemoteConfigType.WORKFLOW, "remoteWorkflowToggles"],
		[RemoteConfigType.SKILL, "remoteSkillsToggles"],
	] as const)("persists and rematerializes type %s", async (type, key) => {
		const { controller, stores } = makeController()

		const response = await toggleRemoteConfigSetting(
			controller as never,
			ToggleRemoteConfigSettingRequest.create({ type, name: "Shared", enabled: false }),
		)

		expect(stores[key]).toEqual({ Shared: false })
		expect(response.enabled).toBe(false)
		expect(controller.rematerializeRemoteConfig).toHaveBeenCalledOnce()
	})

	it("keeps duplicate names isolated by instruction type", async () => {
		const { controller, stores } = makeController()

		await toggleRemoteConfigSetting(
			controller as never,
			ToggleRemoteConfigSettingRequest.create({ type: RemoteConfigType.RULE, name: "Shared", enabled: false }),
		)

		expect(stores.remoteRulesToggles).toEqual({ Shared: false })
		expect(stores.remoteWorkflowToggles).toEqual({})
		expect(stores.remoteSkillsToggles).toEqual({})
	})

	it("rejects disabling a locked instruction without changing state", async () => {
		const { controller, stores } = makeController({ locked: true })

		await expect(
			toggleRemoteConfigSetting(
				controller as never,
				ToggleRemoteConfigSettingRequest.create({ type: RemoteConfigType.RULE, name: "Shared", enabled: false }),
			),
		).rejects.toThrow("locked")

		expect(stores.remoteRulesToggles).toEqual({})
		expect(controller.rematerializeRemoteConfig).not.toHaveBeenCalled()
	})
})
