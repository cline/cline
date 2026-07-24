import { describe, expect, it } from "vitest";
import type { Config } from "../../utils/types";
import { createInteractiveComputerUser } from "./computer-user";

// Display overrides keep createComputerUseToolFromEnv from querying a live
// backend; the socket is only dialed when an action actually runs.
const enabledEnv = {
	CLINE_COMPUTER_USE_PORT: "51999",
	CLINE_COMPUTER_USE_DISPLAY_WIDTH: "1920",
	CLINE_COMPUTER_USE_DISPLAY_HEIGHT: "1080",
} as NodeJS.ProcessEnv;

function makeConfig(): Config {
	return {
		cwd: "C:/work",
		workspaceRoot: "C:/work",
	} as Config;
}

function makeSettings(settings: Record<string, unknown> | undefined) {
	return {
		getProviderSettings: () => settings as never,
	};
}

describe("createInteractiveComputerUser", () => {
	it("returns undefined when computer use is not enabled by env", async () => {
		const result = await createInteractiveComputerUser({
			config: makeConfig(),
			providerSettingsManager: makeSettings({ apiKey: "sk-ant-x" }),
			notifyDriver: () => {},
			env: {} as NodeJS.ProcessEnv,
		});
		expect(result).toBeUndefined();
	});

	it("returns undefined when the Anthropic provider has no api key", async () => {
		const result = await createInteractiveComputerUser({
			config: makeConfig(),
			providerSettingsManager: makeSettings(undefined),
			notifyDriver: () => {},
			env: enabledEnv,
		});
		expect(result).toBeUndefined();
	});

	it("exposes the four driver tools when enabled and configured", async () => {
		const result = await createInteractiveComputerUser({
			config: makeConfig(),
			providerSettingsManager: makeSettings({
				apiKey: "sk-ant-x",
				model: "claude-sonnet-4-6",
			}),
			notifyDriver: () => {},
			env: enabledEnv,
		});
		expect(result).toBeDefined();
		expect(result?.driverTools.map((tool) => tool.name).sort()).toEqual([
			"computer_user_interrupt",
			"computer_user_message",
			"computer_user_start",
			"computer_user_status",
		]);
		// The raw computer tool must not be among the driver's tools.
		expect(
			result?.driverTools.some((tool) => tool.name === "computer"),
		).toBe(false);
		await result?.dispose();
	});
});
