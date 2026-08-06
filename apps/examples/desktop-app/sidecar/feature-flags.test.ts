import { afterEach, describe, expect, it } from "vitest";
import { isCloudAgentsEnabled } from "./feature-flags";

afterEach(() => {
	delete process.env.CLINE_CODE_CLOUD_AGENTS;
});

describe("isCloudAgentsEnabled", () => {
	it("defaults to off with no provider and no override", () => {
		expect(isCloudAgentsEnabled()).toBe(false);
	});

	it("honors the env override in both directions", () => {
		process.env.CLINE_CODE_CLOUD_AGENTS = "1";
		expect(isCloudAgentsEnabled()).toBe(true);
		process.env.CLINE_CODE_CLOUD_AGENTS = "true";
		expect(isCloudAgentsEnabled()).toBe(true);
		process.env.CLINE_CODE_CLOUD_AGENTS = "0";
		expect(isCloudAgentsEnabled()).toBe(false);
		process.env.CLINE_CODE_CLOUD_AGENTS = "false";
		expect(isCloudAgentsEnabled()).toBe(false);
	});
});
