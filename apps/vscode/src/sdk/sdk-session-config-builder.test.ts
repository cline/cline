import { describe, expect, it, vi } from "vitest";
import { SdkSessionConfigBuilder } from "./sdk-session-config-builder";

const mocks = vi.hoisted(() => ({
	buildSessionConfig: vi.fn(),
	buildAgentHooks: vi.fn(() => ({})),
}));

vi.mock("./cline-session-factory", () => ({
	buildSessionConfig: mocks.buildSessionConfig,
}));

vi.mock("./hooks-adapter", () => ({
	buildAgentHooks: mocks.buildAgentHooks,
}));

describe("SdkSessionConfigBuilder", () => {
	it("adds the CLI plan-mode switch_to_act_mode tool only in plan mode", async () => {
		const stateManager = {
			getGlobalSettingsKey: vi.fn(() => "plan"),
		};
		const onSwitchToActMode = vi.fn();
		const builder = new SdkSessionConfigBuilder({
			stateManager: stateManager as never,
			emitHookMessage: vi.fn(),
			onSwitchToActMode,
		});

		mocks.buildSessionConfig.mockResolvedValueOnce({
			extraTools: [],
			hooks: {},
		});
		const planConfig = await builder.build({ cwd: "/workspace", mode: "plan" });
		const switchTool = planConfig.extraTools?.find(
			(tool) => tool.name === "switch_to_act_mode",
		);
		expect(switchTool).toBeDefined();
		expect(await switchTool?.execute({}, {} as never)).toBe(
			"You successfully switched to act mode, proceed with the plan. You now have access to editing files and running commands. (The switch_to_act_mode tool is only available in plan mode.)",
		);
		expect(onSwitchToActMode).toHaveBeenCalledOnce();

		mocks.buildSessionConfig.mockResolvedValueOnce({
			extraTools: [switchTool],
			hooks: {},
		});
		const actConfig = await builder.build({ cwd: "/workspace", mode: "act" });
		expect(
			actConfig.extraTools?.some((tool) => tool.name === "switch_to_act_mode"),
		).toBe(false);
	});

	it("stops before the next model call after switch_to_act_mode queues a mode change", async () => {
		const baseBeforeModel = vi.fn(async () => ({ metadata: "base" }));
		mocks.buildAgentHooks.mockReturnValueOnce({ beforeModel: baseBeforeModel });
		mocks.buildSessionConfig.mockResolvedValueOnce({ hooks: {} });

		const builder = new SdkSessionConfigBuilder({
			stateManager: {} as never,
			emitHookMessage: vi.fn(),
			onSwitchToActMode: vi.fn(),
			shouldStopAfterModeSwitch: () => true,
		});

		const config = await builder.build({ cwd: "/workspace", mode: "act" });

		await expect(config.hooks?.beforeModel?.({} as never)).resolves.toEqual({
			metadata: "base",
			stop: true,
		});
		expect(baseBeforeModel).toHaveBeenCalledOnce();
	});
});
