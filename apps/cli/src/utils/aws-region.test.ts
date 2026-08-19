import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAwsRegion } from "./aws-region";

const originalEnv = { ...process.env };

afterEach(() => {
	process.env = { ...originalEnv };
});

describe("resolveAwsRegion", () => {
	it("prefers explicit region", () => {
		process.env.AWS_REGION = "us-east-1";
		expect(resolveAwsRegion({ explicitRegion: "us-west-2" })).toBe("us-west-2");
	});

	it("uses AWS_REGION before AWS_DEFAULT_REGION", () => {
		process.env.AWS_REGION = "eu-west-1";
		process.env.AWS_DEFAULT_REGION = "us-east-2";
		expect(resolveAwsRegion()).toBe("eu-west-1");
	});

	it("reads selected profile region from AWS config", () => {
		delete process.env.AWS_REGION;
		delete process.env.AWS_DEFAULT_REGION;
		const dir = mkdtempSync(join(tmpdir(), "cline-aws-config-"));
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

			expect(resolveAwsRegion({ profile: "dev" })).toBe("ap-southeast-2");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
