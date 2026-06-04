import { describe, expect, it } from "vitest";
import { version } from "../../package.json";
import { configureCliHubCompatibility } from "./hub-compatibility";

describe("configureCliHubCompatibility", () => {
	it("uses the CLI release version as the hub build id", () => {
		const env: NodeJS.ProcessEnv = {};

		configureCliHubCompatibility(env);

		expect(env.CLINE_HUB_BUILD_ID).toBe(`cli:${version}`);
	});

	it("preserves an explicit hub build id override", () => {
		const env: NodeJS.ProcessEnv = {
			CLINE_HUB_BUILD_ID: "custom-build",
		};

		configureCliHubCompatibility(env);

		expect(env.CLINE_HUB_BUILD_ID).toBe("custom-build");
	});

	it("replaces a blank hub build id override", () => {
		const env: NodeJS.ProcessEnv = {
			CLINE_HUB_BUILD_ID: "   ",
		};

		configureCliHubCompatibility(env);

		expect(env.CLINE_HUB_BUILD_ID).toBe(`cli:${version}`);
	});
});
