import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	getNextProviderConfigField,
	getDefaultAwsRegion,
	resolveProviderConfigAwsRegion,
	updateProviderConfigValue,
} from "./provider-config-values";
import { FIELD_ORDER } from "../views/onboarding/fields";

const originalEnv = { ...process.env };

afterEach(() => {
	process.env = { ...originalEnv };
});

describe("provider config values", () => {
	it("updates an auto-filled AWS region when the profile changes", () => {
		delete process.env.AWS_REGION;
		delete process.env.AWS_DEFAULT_REGION;
		const dir = mkdtempSync(join(tmpdir(), "cline-provider-config-"));
		try {
			const configPath = join(dir, "config");
			writeFileSync(
				configPath,
				[
					"[default]",
					"region = us-east-1",
					"[profile dev]",
					"region = ap-southeast-2",
				].join("\n"),
			);
			process.env.AWS_CONFIG_FILE = configPath;

			const result = updateProviderConfigValue(
				{ awsProfile: "", awsRegion: getDefaultAwsRegion("") },
				"awsProfile",
				"dev",
			);

			expect(result.awsRegion).toBe("ap-southeast-2");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("preserves a manually entered AWS region when the profile changes", () => {
		const result = updateProviderConfigValue(
			{ awsProfile: "", awsRegion: "eu-central-1" },
			"awsProfile",
			"dev",
		);

		expect(result.awsRegion).toBe("eu-central-1");
	});

	it("resolves AWS region from the saved profile when region is blank", () => {
		process.env.AWS_REGION = "us-west-2";

		expect(
			resolveProviderConfigAwsRegion({
				awsProfile: "dev",
				awsRegion: "",
			}),
		).toBe("us-west-2");
	});

	it("advances Bedrock profile input before the optional API key", () => {
		expect(
			getNextProviderConfigField(
				{ awsRegion: {}, apiKey: {}, awsProfile: {} },
				FIELD_ORDER,
				"awsRegion",
			),
		).toBe("awsProfile");
	});

	it("returns undefined after the last visible provider config field", () => {
		expect(
			getNextProviderConfigField(
				{ awsRegion: {}, awsProfile: {} },
				FIELD_ORDER,
				"awsProfile",
			),
		).toBeUndefined();
	});
});
