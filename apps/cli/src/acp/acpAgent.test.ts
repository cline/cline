import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import { ProviderSettingsManager } from "@cline/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcpAgent } from "./acpAgent";

let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "cline-acp-auth-"));
	vi.stubEnv("CLINE_DIR", directory);
	vi.stubEnv("CLINE_DATA_DIR", join(directory, "data"));
	vi.stubEnv("CLINE_PROVIDER_SETTINGS_PATH", join(directory, "providers.json"));
	vi.stubEnv("CLINE_API_KEY", undefined);
	vi.stubEnv("CLINE_PROVIDER", undefined);
	vi.stubEnv("CLINE_MODEL", undefined);
});

afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(directory, { recursive: true, force: true });
});

describe("ACP saved-provider authentication", () => {
	function fixture() {
		return {
			manager: new ProviderSettingsManager(),
			agent: new AcpAgent({} as AgentSideConnection),
		};
	}

	it("starts with the last-used API-key provider and its saved custom model", async () => {
		const { manager, agent } = fixture();
		manager.saveProviderSettings({
			provider: "openai-compatible",
			apiKey: "synthetic-local-key",
			baseUrl: "http://127.0.0.1:12345/v1",
			model: "private-model-not-in-catalog",
		});
		const session = await agent.newSession({ cwd: directory, mcpServers: [] });
		expect(session.models?.currentModelId).toBe("private-model-not-in-catalog");
		expect(session.configOptions).toContainEqual(
			expect.objectContaining({
				id: "provider",
				currentValue: "openai-compatible",
			}),
		);
		await agent.shutdown();
	});

	it("honors an explicitly selected saved provider and model override", async () => {
		const { manager, agent } = fixture();
		manager.saveProviderSettings({
			provider: "openai-native",
			apiKey: "key-one",
			model: "gpt-4o",
		});
		manager.saveProviderSettings({
			provider: "mistral",
			apiKey: "key-two",
			model: "mistral-small-latest",
		});
		vi.stubEnv("CLINE_PROVIDER", "openai-native");
		vi.stubEnv("CLINE_MODEL", "private-deployment");
		const session = await agent.newSession({ cwd: directory, mcpServers: [] });
		expect(session.models?.currentModelId).toBe("private-deployment");
		expect(session.configOptions).toContainEqual(
			expect.objectContaining({
				id: "provider",
				currentValue: "openai-native",
			}),
		);
		await agent.shutdown();
	});

	it("does not authenticate an explicit provider with another provider's key", async () => {
		const { manager, agent } = fixture();
		manager.saveProviderSettings({
			provider: "openai-native",
			apiKey: "key-one",
		});
		vi.stubEnv("CLINE_PROVIDER", "mistral");
		await expect(
			agent.newSession({ cwd: directory, mcpServers: [] }),
		).rejects.toMatchObject({ code: -32000 });
	});

	it("still requires authentication when no saved provider has credentials", async () => {
		const { agent } = fixture();
		await expect(
			agent.newSession({ cwd: directory, mcpServers: [] }),
		).rejects.toMatchObject({ code: -32000 });
	});
});
