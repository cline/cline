import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ProviderSettingsManager,
	saveLocalProviderSettings,
} from "@cline/core";
import { afterEach, describe, expect, it } from "vitest";
import {
	getDefaultAwsRegion,
	getProviderConfigProtocol,
	resolveProviderConfigAwsRegion,
	resolveProviderConfigAzure,
	resolveProviderConfigGcp,
	resolveProviderConfigProtocol,
	resolveProviderConfigSap,
	updateProviderConfigValue,
} from "./provider-config-values";

const originalEnv = { ...process.env };

afterEach(() => {
	process.env = { ...originalEnv };
});

describe("provider config values", () => {
	it("defaults new compatible configurations to Chat Completions", () => {
		expect(getProviderConfigProtocol(undefined)).toBe("openai-chat");
		expect(getProviderConfigProtocol({ provider: "openai-compatible" })).toBe(
			"openai-chat",
		);
	});

	it("restores Responses selected by protocol, client, or routing provider", () => {
		for (const settings of [
			{ protocol: "openai-responses" as const },
			{ client: "openai" as const },
			{ routingProviderId: "openai-native" },
		]) {
			expect(
				getProviderConfigProtocol({
					provider: "openai-compatible",
					...settings,
				}),
			).toBe("openai-responses");
		}
	});

	it("replaces stale Responses routing when selecting Chat Completions", () => {
		const settings = {
			provider: "openai-compatible",
			...resolveProviderConfigProtocol({ protocol: "openai-responses" }),
			...resolveProviderConfigProtocol({ protocol: "openai-chat" }),
		};
		expect(settings).toMatchObject({
			protocol: "openai-chat",
			client: "openai-compatible",
			routingProviderId: "openai-compatible",
		});
		expect(getProviderConfigProtocol(settings)).toBe("openai-chat");
	});

	it("persists the API choice across reloads and can switch back while preserving other settings", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-provider-protocol-"));
		try {
			const filePath = join(dir, "providers.json");
			const manager = new ProviderSettingsManager({ filePath });
			manager.saveProviderSettings({
				provider: "openai-compatible",
				model: "custom-model",
				apiKey: "test-key",
				baseUrl: "https://proxy.example/v1",
				headers: { "x-custom-header": "test" },
				azure: { apiVersion: "2025-04-01-preview" },
			});
			for (const protocol of ["openai-responses", "openai-chat"] as const) {
				await saveLocalProviderSettings(manager, {
					providerId: "openai-compatible",
					...resolveProviderConfigProtocol({ protocol }),
				});
				const reloaded = new ProviderSettingsManager({ filePath });
				expect(
					getProviderConfigProtocol(
						reloaded.getProviderSettings("openai-compatible"),
					),
				).toBe(protocol);
				expect(reloaded.getProviderConfig("openai-compatible")).toMatchObject({
					providerId: "openai-compatible",
					modelId: "custom-model",
					apiKey: "test-key",
					baseUrl: "https://proxy.example/v1",
					headers: { "x-custom-header": "test" },
					azure: { apiVersion: "2025-04-01-preview" },
					routingProviderId:
						protocol === "openai-responses"
							? "openai-native"
							: "openai-compatible",
				});
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
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
});
