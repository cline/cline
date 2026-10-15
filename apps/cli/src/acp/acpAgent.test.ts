import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import { ClineCore, ProviderSettingsManager, SessionSource } from "@cline/core";
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
			agent: new AcpAgent({
				sessionUpdate: async () => {},
			} as unknown as AgentSideConnection),
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
		const selected = await agent.setSessionConfigOption({
			sessionId: session.sessionId,
			configId: "provider",
			value: "openai-compatible",
		});
		expect(selected.configOptions).toContainEqual(
			expect.objectContaining({
				id: "model",
				currentValue: "private-model-not-in-catalog",
			}),
		);
		await expect(
			agent.setSessionConfigOption({
				sessionId: session.sessionId,
				configId: "provider",
				value: "unconfigured-provider",
			}),
		).rejects.toMatchObject({ code: -32602 });
		await agent.shutdown();
	});

	it.each([
		undefined,
		"private-environment-model",
	])("cold-loads a real persisted conversation with saved/default model precedence (%s)", async (environmentModel) => {
		const { manager, agent } = fixture();
		manager.saveProviderSettings({
			provider: "openai-compatible",
			apiKey: "synthetic-local-key",
			baseUrl: "http://127.0.0.1:12345/v1",
			model: "private-model-not-in-catalog",
		});
		vi.stubEnv("CLINE_SESSION_BACKEND_MODE", "local");
		vi.stubEnv("CLINE_MODEL", environmentModel);
		const core = await ClineCore.create({ backendMode: "local" });
		const { sessionId } = await core.start({
			source: SessionSource.CLI,
			interactive: true,
			config: {
				providerId: "openai-compatible",
				modelId: "private-model-not-in-catalog",
				apiKey: "synthetic-local-key",
				systemPrompt: "Fixture",
				cwd: directory,
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
			initialMessages: [
				{
					role: "user",
					content: "Persisted fixture history",
					id: "fixture-user",
				},
			],
		});
		await core.dispose("fixture-persisted");
		try {
			const loaded = await agent.loadSession({
				sessionId,
				cwd: directory,
				mcpServers: [],
			});
			const expectedModel = environmentModel ?? "private-model-not-in-catalog";
			expect(loaded.models?.currentModelId).toBe(expectedModel);
			expect(loaded.models?.availableModels).toContainEqual(
				expect.objectContaining({ modelId: expectedModel }),
			);
		} finally {
			await agent.shutdown();
		}
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
