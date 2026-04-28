import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderSettings } from "../types/provider-settings";

function createProviderSettingsManager(settings?: ProviderSettings) {
	return {
		getProviderSettings: vi.fn(() => settings),
	};
}

function createStartInput() {
	return {
		config: {
			providerId: "cline",
			modelId: "anthropic/claude-haiku-4.5",
			apiKey: "test-key",
			cwd: "/tmp/project",
			workspaceRoot: "/tmp/project",
			systemPrompt: "system",
			mode: "act" as const,
			enableTools: true,
			enableSpawnAgent: true,
			enableAgentTeams: true,
		},
	};
}

function createSpawnTool() {
	return {
		name: "spawn",
		description: "",
		inputSchema: {},
		execute: vi.fn(),
	};
}

describe("prepareLocalRuntimeBootstrap", () => {
	const previousGlobalSettingsPath = process.env.CLINE_GLOBAL_SETTINGS_PATH;

	afterEach(() => {
		process.env.CLINE_GLOBAL_SETTINGS_PATH = previousGlobalSettingsPath;
		vi.resetModules();
		vi.doUnmock("../extensions/plugin/plugin-config-loader");
	});

	it("applies hub model catalog defaults during local runtime bootstrap", async () => {
		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);

		const bootstrap = await prepareLocalRuntimeBootstrap({
			input: createStartInput(),
			localRuntime: {
				modelCatalogDefaults: {
					loadLatestOnInit: true,
					loadPrivateOnAuth: true,
				},
			},
			sessionId: "sess-1",
			providerSettingsManager: createProviderSettingsManager() as never,
			defaultTelemetry: undefined,
			defaultToolExecutors: undefined,
			defaultToolPolicies: undefined,
			defaultRequestToolApproval: undefined,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});

		expect(bootstrap.providerConfig.modelCatalog).toMatchObject({
			loadLatestOnInit: true,
			loadPrivateOnAuth: true,
		});
	});

	it("lets stored provider model catalog settings override hub defaults", async () => {
		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);

		const bootstrap = await prepareLocalRuntimeBootstrap({
			input: createStartInput(),
			localRuntime: {
				modelCatalogDefaults: {
					loadLatestOnInit: true,
					loadPrivateOnAuth: true,
				},
			},
			sessionId: "sess-1",
			providerSettingsManager: createProviderSettingsManager({
				provider: "cline",
				model: "anthropic/claude-haiku-4.5",
				modelCatalog: {
					loadLatestOnInit: false,
					loadPrivateOnAuth: false,
				},
			}) as never,
			defaultTelemetry: undefined,
			defaultToolExecutors: undefined,
			defaultToolPolicies: undefined,
			defaultRequestToolApproval: undefined,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});

		expect(bootstrap.providerConfig.modelCatalog).toMatchObject({
			loadLatestOnInit: false,
			loadPrivateOnAuth: false,
		});
	});

	it("filters globally disabled plugin tools before extension setup", async () => {
		const tempRoot = mkdtempSync(join(tmpdir(), "local-bootstrap-global-"));
		const settingsPath = join(tempRoot, "global-settings.json");
		process.env.CLINE_GLOBAL_SETTINGS_PATH = settingsPath;
		writeFileSync(
			settingsPath,
			JSON.stringify({ disabledTools: ["blocked_tool"] }, null, 2),
			"utf8",
		);

		vi.doMock("../extensions/plugin/plugin-config-loader", () => ({
			resolveAndLoadAgentPlugins: vi.fn(async () => ({
				extensions: [
					{
						name: "plugin-a",
						manifest: { capabilities: ["tools"] },
						setup: (api: {
							registerTool: (tool: { name: string }) => void;
						}) => {
							api.registerTool({ name: "blocked_tool" });
							api.registerTool({ name: "allowed_tool" });
						},
					},
				],
				failures: [],
				warnings: [],
			})),
		}));

		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);
		const bootstrap = await prepareLocalRuntimeBootstrap({
			input: createStartInput(),
			sessionId: "sess-1",
			providerSettingsManager: createProviderSettingsManager() as never,
			defaultTelemetry: undefined,
			defaultToolExecutors: undefined,
			defaultToolPolicies: undefined,
			defaultRequestToolApproval: undefined,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});

		const registeredTools: string[] = [];
		bootstrap.extensions?.[0]?.setup?.(
			{
				registerTool: (tool: { name: string }) =>
					registeredTools.push(tool.name),
				registerCommand: () => {},
				registerMessageBuilder: () => {},
				registerProvider: () => {},
				registerAutomationEventType: () => {},
			},
			{},
		);

		expect(registeredTools).toEqual(["allowed_tool"]);
	});

	it("loads only provider/model-compatible plugins during bootstrap", async () => {
		vi.doMock("../extensions/plugin/plugin-config-loader", () => ({
			resolveAndLoadAgentPlugins: vi.fn(
				async ({
					providerId,
					modelId,
				}: {
					providerId?: string;
					modelId?: string;
				}) => ({
					extensions:
						providerId === "cline" && modelId === "anthropic/claude-haiku-4.5"
							? [
									{
										name: "plugin-compatible",
										manifest: {
											capabilities: ["tools"],
											providerIds: ["cline"],
											modelIds: ["anthropic/claude-haiku-4.5"],
										},
										setup: (api: {
											registerTool: (tool: { name: string }) => void;
										}) => {
											api.registerTool({ name: "compatible_tool" });
										},
									},
								]
							: [
									{
										name: "plugin-incompatible",
										manifest: {
											capabilities: ["tools"],
											providerIds: ["openai"],
											modelIds: ["gpt-5.4"],
										},
										setup: (api: {
											registerTool: (tool: { name: string }) => void;
										}) => {
											api.registerTool({ name: "incompatible_tool" });
										},
									},
								],
					failures: [],
					warnings: [],
				}),
			),
		}));

		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);
		const bootstrap = await prepareLocalRuntimeBootstrap({
			input: createStartInput(),
			sessionId: "sess-1",
			providerSettingsManager: createProviderSettingsManager() as never,
			defaultTelemetry: undefined,
			defaultToolExecutors: undefined,
			defaultToolPolicies: undefined,
			defaultRequestToolApproval: undefined,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});

		const registeredTools: string[] = [];
		bootstrap.extensions?.[0]?.setup?.(
			{
				registerTool: (tool: { name: string }) =>
					registeredTools.push(tool.name),
				registerCommand: () => {},
				registerMessageBuilder: () => {},
				registerProvider: () => {},
				registerAutomationEventType: () => {},
			},
			{},
		);

		expect(registeredTools).toEqual(["compatible_tool"]);
	});

	it("threads defaultFetch into providerConfig.fetch", async () => {
		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);

		const customFetch = vi.fn() as unknown as typeof fetch;
		const bootstrap = await prepareLocalRuntimeBootstrap({
			input: createStartInput(),
			sessionId: "sess-fetch",
			providerSettingsManager: createProviderSettingsManager() as never,
			defaultTelemetry: undefined,
			defaultToolExecutors: undefined,
			defaultToolPolicies: undefined,
			defaultRequestToolApproval: undefined,
			defaultFetch: customFetch,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});

		expect(bootstrap.providerConfig.fetch).toBe(customFetch);
	});

	it("prefers per-session config fetch over defaultFetch", async () => {
		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);

		const defaultFetch = vi.fn() as unknown as typeof fetch;
		const sessionFetch = vi.fn() as unknown as typeof fetch;
		const input = createStartInput();
		(input.config as unknown as { fetch?: typeof fetch }).fetch = sessionFetch;

		const bootstrap = await prepareLocalRuntimeBootstrap({
			input,
			sessionId: "sess-fetch-override",
			providerSettingsManager: createProviderSettingsManager() as never,
			defaultTelemetry: undefined,
			defaultToolExecutors: undefined,
			defaultToolPolicies: undefined,
			defaultRequestToolApproval: undefined,
			defaultFetch,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});

		expect(bootstrap.providerConfig.fetch).toBe(sessionFetch);
	});

	it("leaves providerConfig.fetch unset when no fetch is supplied", async () => {
		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);

		const bootstrap = await prepareLocalRuntimeBootstrap({
			input: createStartInput(),
			sessionId: "sess-no-fetch",
			providerSettingsManager: createProviderSettingsManager() as never,
			defaultTelemetry: undefined,
			defaultToolExecutors: undefined,
			defaultToolPolicies: undefined,
			defaultRequestToolApproval: undefined,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});

		expect(bootstrap.providerConfig.fetch).toBeUndefined();
	});

	it("adds Codex backend headers for openai-codex from stored OAuth settings", async () => {
		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);

		const input = createStartInput();
		input.config.providerId = "openai-codex";
		input.config.modelId = "gpt-5.4";
		input.config.apiKey = "oauth-access-token";

		const bootstrap = await prepareLocalRuntimeBootstrap({
			input,
			sessionId: "sess-codex",
			providerSettingsManager: createProviderSettingsManager({
				provider: "openai-codex",
				model: "gpt-5.4",
				auth: {
					accessToken: "oauth-access-token",
					accountId: "acct-123",
				},
				headers: {
					"x-stored": "stored",
				},
			}) as never,
			defaultTelemetry: undefined,
			defaultToolExecutors: undefined,
			defaultToolPolicies: undefined,
			defaultRequestToolApproval: undefined,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});

		expect(bootstrap.providerConfig.headers).toMatchObject({
			originator: "cline",
			session_id: "sess-codex",
			"ChatGPT-Account-Id": "acct-123",
			"x-stored": "stored",
		});
	});

	it("keeps Codex-controlled headers from being overridden by stored or config headers", async () => {
		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);

		const input = createStartInput();
		input.config.providerId = "openai-codex";
		input.config.modelId = "gpt-5.4";
		input.config.apiKey = "oauth-access-token";
		const config = input.config as typeof input.config & {
			headers: Record<string, string>;
		};
		config.headers = {
			originator: "config-originator",
			session_id: "config-session",
			"User-Agent": "ConfigAgent/0",
			"ChatGPT-Account-Id": "config-account",
			"x-config": "config",
			"x-shared": "config-wins",
		};

		const bootstrap = await prepareLocalRuntimeBootstrap({
			input,
			sessionId: "sess-codex-invariants",
			providerSettingsManager: createProviderSettingsManager({
				provider: "openai-codex",
				model: "gpt-5.4",
				auth: {
					accessToken: "oauth-access-token",
					accountId: "acct-stored",
				},
				headers: {
					originator: "stored-originator",
					session_id: "stored-session",
					"User-Agent": "StoredAgent/0",
					"ChatGPT-Account-Id": "stored-account",
					"x-stored": "stored",
					"x-shared": "stored-loses",
				},
			}) as never,
			defaultTelemetry: undefined,
			defaultToolExecutors: undefined,
			defaultToolPolicies: undefined,
			defaultRequestToolApproval: undefined,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});

		expect(bootstrap.providerConfig.headers).toMatchObject({
			originator: "cline",
			session_id: "sess-codex-invariants",
			"ChatGPT-Account-Id": "acct-stored",
			"x-config": "config",
			"x-stored": "stored",
			"x-shared": "config-wins",
		});
		expect(bootstrap.providerConfig.headers?.["User-Agent"]).toMatch(
			/^Cline\//,
		);
	});

	it("derives Codex account id from the OAuth access token when not persisted", async () => {
		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);

		const payload = Buffer.from(
			JSON.stringify({
				"https://api.openai.com/auth": {
					chatgpt_account_id: "acct-derived",
				},
			}),
			"utf8",
		).toString("base64url");
		const token = `header.${payload}.sig`;

		const input = createStartInput();
		input.config.providerId = "openai-codex";
		input.config.modelId = "gpt-5.4";
		input.config.apiKey = token;

		const bootstrap = await prepareLocalRuntimeBootstrap({
			input,
			sessionId: "sess-codex-derived",
			providerSettingsManager: createProviderSettingsManager({
				provider: "openai-codex",
				model: "gpt-5.4",
				auth: {
					accessToken: token,
				},
			}) as never,
			defaultTelemetry: undefined,
			defaultToolExecutors: undefined,
			defaultToolPolicies: undefined,
			defaultRequestToolApproval: undefined,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});

		expect(bootstrap.providerConfig.headers).toMatchObject({
			originator: "cline",
			session_id: "sess-codex-derived",
			"ChatGPT-Account-Id": "acct-derived",
		});
	});
});
