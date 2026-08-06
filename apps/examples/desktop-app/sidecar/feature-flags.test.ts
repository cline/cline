import { FeatureFlagsService, NoOpFeatureFlagsProvider } from "@cline/core";
import { FeatureFlag } from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
	applyDesktopFeatureFlagsContext,
	buildDesktopFeatureFlagsContext,
	isCloudAgentsEnabled,
} from "./feature-flags";

afterEach(() => {
	delete process.env.CLINE_CODE_CLOUD_AGENTS;
});

describe("isCloudAgentsEnabled", () => {
	it("targets signed-in feature flags by account id", () => {
		expect(buildDesktopFeatureFlagsContext(" account-123 ")).toMatchObject({
			distinctId: "account-123",
			userId: "account-123",
		});
	});

	it("does not reuse another account's cached rollout value", () => {
		const service = new FeatureFlagsService({
			provider: new NoOpFeatureFlagsProvider(),
		});
		service.hydrateCache({
			updateTime: Date.now(),
			userId: "account-a",
			flagsPayload: {
				featureFlags: { [FeatureFlag.CODE_CLOUD_AGENTS]: true },
			},
		});

		applyDesktopFeatureFlagsContext(
			service,
			buildDesktopFeatureFlagsContext("account-b"),
		);

		expect(service.getCacheSnapshot()).toMatchObject({
			updateTime: 0,
			userId: "account-b",
		});
		expect(service.getBooleanFlagEnabled(FeatureFlag.CODE_CLOUD_AGENTS)).toBe(
			false,
		);
	});

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
