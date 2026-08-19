import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setCloudSessionsEnabled } from "./desktop-settings";
import {
	isCloudAgentsEnabled,
	isCloudHandoffAvailable,
	isCloudHandoffEnabled,
} from "./feature-flags";

let dataDir: string;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "cline-feature-flags-"));
	process.env.CLINE_DATA_DIR = dataDir;
});

afterEach(() => {
	delete process.env.CLINE_CODE_CLOUD_AGENTS;
	delete process.env.CLINE_CODE_CLOUD_HANDOFF;
	delete process.env.CLINE_DATA_DIR;
	rmSync(dataDir, { recursive: true, force: true });
});

describe("isCloudHandoffEnabled", () => {
	it("uses an independent override and still requires Cloud Agents", () => {
		expect(isCloudHandoffEnabled()).toBe(true);
		expect(isCloudHandoffAvailable()).toBe(false);

		process.env.CLINE_CODE_CLOUD_AGENTS = "1";
		expect(isCloudHandoffAvailable()).toBe(true);

		process.env.CLINE_CODE_CLOUD_HANDOFF = "0";
		expect(isCloudHandoffEnabled()).toBe(false);
		expect(isCloudHandoffAvailable()).toBe(false);
	});
});

describe("isCloudAgentsEnabled", () => {
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
