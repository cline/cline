import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	formatProviderConfigHeaders,
	getDefaultAwsRegion,
	parseProviderConfigHeaders,
	resolveProviderConfigAwsRegion,
	resolveProviderConfigAzure,
	resolveProviderConfigGcp,
	resolveProviderConfigHeadersPatch,
	resolveProviderConfigPositiveInteger,
	resolveProviderConfigSap,
	updateProviderConfigValue,
} from "./provider-config-values";

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

	it("resolves Vertex GCP field values into GCP settings", () => {
		expect(
			resolveProviderConfigGcp({ gcpRegion: "us-central1" }),
		).toBeUndefined();
		expect(
			resolveProviderConfigGcp({
				gcpProjectId: " project ",
				gcpRegion: " europe-west4 ",
			}),
		).toEqual({ projectId: "project", region: "europe-west4" });
	});

	it("resolves SAP AI Core field values into SAP settings", () => {
		expect(
			resolveProviderConfigSap({
				sapClientId: " client ",
				sapClientSecret: " secret ",
				sapTokenUrl: " https://auth.example ",
				sapResourceGroup: " default ",
				sapDeploymentId: " deployment ",
			}),
		).toEqual({
			clientId: "client",
			clientSecret: "secret",
			tokenUrl: "https://auth.example",
			resourceGroup: "default",
			deploymentId: "deployment",
		});
	});

	it("resolves Azure API version into Azure settings", () => {
		expect(
			resolveProviderConfigAzure({
				azureApiVersion: " 2025-01-01-preview ",
			}),
		).toEqual({
			apiVersion: "2025-01-01-preview",
		});
	});

	it("keeps blank Azure API version so persisted settings can be cleared", () => {
		expect(
			resolveProviderConfigAzure({
				azureApiVersion: "   ",
			}),
		).toEqual({
			apiVersion: "",
		});
	});

	it("round-trips headers through format and parse", () => {
		const headers = {
			"X-Org": "abc",
			Authorization: "Bearer a=b",
		};
		const formatted = formatProviderConfigHeaders(headers);
		expect(formatted).toBe("X-Org=abc, Authorization=Bearer a=b");
		expect(parseProviderConfigHeaders(formatted)).toEqual(headers);
	});

	it("parses headers leniently, dropping malformed entries", () => {
		expect(
			parseProviderConfigHeaders("X-Org=abc, broken, =nokey, X-Other = v "),
		).toEqual({
			"X-Org": "abc",
			"X-Other": "v",
		});
		expect(parseProviderConfigHeaders("")).toEqual({});
		expect(parseProviderConfigHeaders(undefined)).toEqual({});
	});

	it("builds a headers patch that deletes removed entries", () => {
		expect(
			resolveProviderConfigHeadersPatch("X-Org=abc", {
				"X-Org": "old",
				"X-Removed": "gone",
			}),
		).toEqual({
			"X-Org": "abc",
			"X-Removed": "",
		});
		expect(resolveProviderConfigHeadersPatch("", undefined)).toBeUndefined();
		expect(resolveProviderConfigHeadersPatch("", { "X-Org": "old" })).toEqual({
			"X-Org": "",
		});
	});

	it("parses optional numeric fields, clearing blank or invalid input", () => {
		expect(resolveProviderConfigPositiveInteger("128000")).toBe(128_000);
		expect(resolveProviderConfigPositiveInteger(" 8192 ")).toBe(8_192);
		expect(resolveProviderConfigPositiveInteger("")).toBeUndefined();
		expect(resolveProviderConfigPositiveInteger(undefined)).toBeUndefined();
		expect(resolveProviderConfigPositiveInteger("abc")).toBeUndefined();
		expect(resolveProviderConfigPositiveInteger("-5")).toBeUndefined();
	});
});
