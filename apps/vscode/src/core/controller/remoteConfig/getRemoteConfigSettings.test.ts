import { Empty } from "@shared/proto/cline/common"
import { RemoteConfigType } from "@shared/proto/cline/remote_config"
import { describe, expect, it, vi } from "vitest"
import { getRemoteConfigSettings } from "./getRemoteConfigSettings"

function deferred() {
	let resolve!: () => void
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise
	})
	return { promise, resolve }
}

function makeStateManager(remoteConfig: Record<string, unknown>, toggles: Record<string, Record<string, boolean>> = {}) {
	return {
		getRemoteConfigSettings: () => remoteConfig,
		getGlobalStateKey: (key: string) => toggles[key] ?? {},
	}
}

describe("getRemoteConfigSettings", () => {
	it("maps rules, workflows, and skills with persisted per-type enabled state", async () => {
		const controller = {
			waitForInitialRemoteConfig: vi.fn().mockResolvedValue(undefined),
			stateManager: makeStateManager(
				{
					remoteGlobalRules: [{ name: "Security", contents: "Use secure defaults", alwaysEnabled: true }],
					remoteGlobalWorkflows: [{ name: "Release", contents: "Run release checks", alwaysEnabled: false }],
					remoteGlobalSkills: [{ name: "Review", contents: "Review changes", alwaysEnabled: false }],
				},
				{
					remoteWorkflowToggles: { Release: false },
				},
			),
		}

		const response = await getRemoteConfigSettings(controller as never, Empty.create())

		expect(response.settings).toEqual([
			{
				type: RemoteConfigType.RULE,
				name: "Security",
				content: "Use secure defaults",
				enabled: true,
				locked: true,
			},
			{
				type: RemoteConfigType.WORKFLOW,
				name: "Release",
				content: "Run release checks",
				enabled: false,
				locked: false,
			},
			{
				type: RemoteConfigType.SKILL,
				name: "Review",
				content: "Review changes",
				enabled: true,
				locked: false,
			},
		])
	})

	it("waits for initial remote config readiness before reading compatibility state", async () => {
		const readiness = deferred()
		let remoteConfig: Record<string, unknown> = {}
		const controller = {
			waitForInitialRemoteConfig: () => readiness.promise,
			stateManager: {
				getRemoteConfigSettings: () => remoteConfig,
				getGlobalStateKey: () => ({}),
			},
		}

		let settled = false
		const read = getRemoteConfigSettings(controller as never, Empty.create()).then((response) => {
			settled = true
			return response
		})
		await Promise.resolve()
		expect(settled).toBe(false)

		remoteConfig = { remoteGlobalRules: [{ name: "Loaded before read", contents: "Policy" }] }
		readiness.resolve()

		const response = await read
		expect(response.settings.map((setting) => setting.name)).toEqual(["Loaded before read"])
	})
})
