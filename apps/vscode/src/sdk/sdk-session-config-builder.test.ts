import { describe, expect, it, vi } from "vitest"
import { SdkSessionConfigBuilder } from "./sdk-session-config-builder"

const mocks = vi.hoisted(() => ({
	buildSessionConfig: vi.fn(),
	buildAgentHooks: vi.fn(() => ({})),
}))

vi.mock("./cline-session-factory", () => ({
	buildSessionConfig: mocks.buildSessionConfig,
}))

vi.mock("./hooks-adapter", () => ({
	buildAgentHooks: mocks.buildAgentHooks,
}))

describe("SdkSessionConfigBuilder", () => {
	it("does not expose the SDK switch_to_act_mode tool in VS Code plan mode", async () => {
		const builder = new SdkSessionConfigBuilder({
			stateManager: {} as never,
			emitHookMessage: vi.fn(),
		})

		mocks.buildSessionConfig.mockResolvedValueOnce({
			extraTools: [{ name: "switch_to_act_mode" }, { name: "attempt_completion" }],
			hooks: {},
		})

		const planConfig = await builder.build({ cwd: "/workspace", mode: "plan" })

		expect(planConfig.extraTools?.some((tool) => tool.name === "switch_to_act_mode")).toBe(false)
		expect(planConfig.extraTools?.some((tool) => tool.name === "attempt_completion")).toBe(true)
	})

	it("passes the mistake-limit callback into the SDK config without overriding SDK execution defaults", async () => {
		const onConsecutiveMistakeLimitReached = vi.fn()
		mocks.buildSessionConfig.mockResolvedValueOnce({ hooks: {}, execution: { maxRetries: 1 } })

		const builder = new SdkSessionConfigBuilder({
			stateManager: { getGlobalSettingsKey: vi.fn(() => 3) } as never,
			emitHookMessage: vi.fn(),
			onConsecutiveMistakeLimitReached,
		})

		const config = await builder.build({ cwd: "/workspace", mode: "act" })

		expect(config.execution).toEqual({ maxRetries: 1 })
		expect(config.onConsecutiveMistakeLimitReached).toBe(onConsecutiveMistakeLimitReached)
	})
})
