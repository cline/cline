import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FeatureFlagsService, NoOpFeatureFlagsProvider } from "@cline/core";
import { FeatureFlag } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setCloudSessionsEnabled } from "./desktop-settings";
import {
	applyDesktopFeatureFlagsContext,
	buildDesktopFeatureFlagsContext,
	isCloudAgentsEnabled,
} from "./feature-flags";

let dataDir: string;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "cline-feature-flags-"));
	process.env.CLINE_DATA_DIR = dataDir;
});

afterEach(() => {
	delete process.env.CLINE_CODE_CLOUD_AGENTS;
	delete process.env.CLINE_DATA_DIR;
	rmSync(dataDir, { recursive: true, force: true });
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
				featureFlags: { [FeatureFlag.CLINE_PASS]: true },
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
		expect(service.getBooleanFlagEnabled(FeatureFlag.CLINE_PASS)).toBe(false);
	});

	it("defaults to off with no setting and no override", () => {
		expect(isCloudAgentsEnabled()).toBe(false);
	});

	it("follows the user's settings opt-in toggle", () => {
		setCloudSessionsEnabled(true);
		expect(isCloudAgentsEnabled()).toBe(true);
		setCloudSessionsEnabled(false);
		expect(isCloudAgentsEnabled()).toBe(false);
	});

	it("honors the env override in both directions", () => {
		process.env.CLINE_CODE_CLOUD_AGENTS = "1";
		expect(isCloudAgentsEnabled()).toBe(true);
		process.env.CLINE_CODE_CLOUD_AGENTS = "true";
		expect(isCloudAgentsEnabled()).toBe(true);
		// The env override wins over the settings toggle in both directions.
		setCloudSessionsEnabled(true);
		process.env.CLINE_CODE_CLOUD_AGENTS = "0";
		expect(isCloudAgentsEnabled()).toBe(false);
		process.env.CLINE_CODE_CLOUD_AGENTS = "false";
		expect(isCloudAgentsEnabled()).toBe(false);
	});
});
