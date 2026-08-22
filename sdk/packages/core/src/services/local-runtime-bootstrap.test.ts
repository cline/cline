import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as LlmsModels from "@cline/llms";
import { afterEach, describe, expect, it, vi } from "vitest";
import { version as corePackageVersion } from "../../package.json";
import type {
	MediaGenerationSettings,
	ProviderSettings,
} from "../types/provider-settings";

function createProviderSettingsManager(
	settings?: ProviderSettings,
	mediaGeneration?: MediaGenerationSettings,
) {
	const mediaProviderId = mediaGeneration?.image?.providerId;
	return {
		getProviderSettings: vi.fn(() => settings),
		getMediaGenerationSettings: vi.fn(() => mediaGeneration),
		getProviderConfig: vi.fn((providerId: string) =>
			providerId === mediaProviderId
				? { providerId, apiKey: "server-only-key" }
				: undefined,
		),
		read: vi.fn(() => ({
			version: 1 as const,
			modes: mediaGeneration ? { mediaGeneration } : {},
			providers: mediaProviderId
				? {
						[mediaProviderId]: {
							settings: { provider: mediaProviderId },
							updatedAt: "2026-01-01T00:00:00.000Z",
							tokenSource: "manual" as const,
						},
					}
				: {},
		})),
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

const BOOTSTRAP_MEDIA_MODEL_IDS = [
	"bootstrap-configured-image-model",
	"bootstrap-host-image-model",
	"bootstrap-test-image-model",
] as const;

function registerBootstrapImageModel(modelId: string): void {
	LlmsModels.registerModel("openrouter", modelId, {
		id: modelId,
		name: "Bootstrap Test Image Model",
		operation: "image-generation",
		modalities: { input: ["text"], output: ["image"] },
	});
}

describe("prepareLocalRuntimeBootstrap", () => {
	const previousGlobalSettingsPath = process.env.CLINE_GLOBAL_SETTINGS_PATH;
	let resetModulesAfterEach = false;

	afterEach(() => {
		process.env.CLINE_GLOBAL_SETTINGS_PATH = previousGlobalSettingsPath;
		vi.doUnmock("../extensions/plugin/plugin-config-loader");
		for (const modelId of BOOTSTRAP_MEDIA_MODEL_IDS) {
			LlmsModels.unregisterModel("openrouter", modelId);
		}
		if (resetModulesAfterEach) {
			vi.resetModules();
			resetModulesAfterEach = false;
		}
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
			defaultToolPolicies: undefined,
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
			defaultToolPolicies: undefined,
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

	it("injects the configured media executor only when an image model is selected", async () => {
		registerBootstrapImageModel("bootstrap-configured-image-model");
		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);
		const withoutSelection = await prepareLocalRuntimeBootstrap({
			input: createStartInput(),
			sessionId: "sess-without-media",
			providerSettingsManager: createProviderSettingsManager() as never,
			defaultTelemetry: undefined,
			defaultToolPolicies: undefined,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});
		expect(
			withoutSelection.runtimeBuilderInput.toolExecutors?.generateMedia,
		).toBeUndefined();

		const withSelection = await prepareLocalRuntimeBootstrap({
			input: createStartInput(),
			sessionId: "sess-with-media",
			providerSettingsManager: createProviderSettingsManager(undefined, {
				image: {
					providerId: "openrouter",
					modelId: "bootstrap-configured-image-model",
				},
			}) as never,
			defaultTelemetry: undefined,
			defaultToolPolicies: undefined,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});
		expect(
			withSelection.runtimeBuilderInput.toolExecutors?.generateMedia,
		).toBeTypeOf("function");
	});

	it("does not inject the media executor for a stale stored selection", async () => {
		const mediaGeneration: MediaGenerationSettings = {
			image: {
				providerId: "openrouter",
				modelId: "missing-image-model",
			},
		};
		const providerSettingsManager = createProviderSettingsManager(
			undefined,
			mediaGeneration,
		);
		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);
		const bootstrap = await prepareLocalRuntimeBootstrap({
			input: createStartInput(),
			sessionId: "sess-stale-media",
			providerSettingsManager: providerSettingsManager as never,
			defaultTelemetry: undefined,
			defaultToolPolicies: undefined,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});

		expect(
			bootstrap.runtimeBuilderInput.toolExecutors?.generateMedia,
		).toBeUndefined();
		expect(providerSettingsManager.getMediaGenerationSettings()).toEqual(
			mediaGeneration,
		);
	});

	it("lets a host media executor override the configured executor", async () => {
		registerBootstrapImageModel("bootstrap-host-image-model");
		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);
		const hostGenerateMedia = vi.fn(async () => []);
		const bootstrap = await prepareLocalRuntimeBootstrap({
			input: {
				...createStartInput(),
				capabilities: {
					toolExecutors: { generateMedia: hostGenerateMedia },
				},
			},
			sessionId: "sess-host-media",
			providerSettingsManager: createProviderSettingsManager(undefined, {
				image: {
					providerId: "openrouter",
					modelId: "bootstrap-host-image-model",
				},
			}) as never,
			defaultTelemetry: undefined,
			defaultToolPolicies: undefined,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});

		expect(bootstrap.runtimeBuilderInput.toolExecutors?.generateMedia).toBe(
			hostGenerateMedia,
		);
	});

	it("forwards the tool abort signal through the configured media executor", async () => {
		const modelId = "bootstrap-test-image-model";
		registerBootstrapImageModel(modelId);
		const generateSpy = vi
			.spyOn(LlmsModels, "generateMedia")
			.mockResolvedValue({
				media: [
					{
						id: "bootstrap-image",
						modality: "image",
						mediaType: "image/png",
						source: { type: "base64", data: "aGVsbG8=" },
					},
				],
				usage: {
					inputTokens: 7,
					outputTokens: 3,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			});
		const providerSettingsManager = {
			getProviderSettings: vi.fn(() => undefined),
			getMediaGenerationSettings: vi.fn(() => ({
				image: { providerId: "openrouter", modelId },
			})),
			read: vi.fn(() => ({
				version: 1 as const,
				modes: {
					mediaGeneration: {
						image: { providerId: "openrouter", modelId },
					},
				},
				providers: {
					openrouter: {
						settings: { provider: "openrouter" },
						updatedAt: "2026-01-01T00:00:00.000Z",
						tokenSource: "manual" as const,
					},
				},
			})),
			getProviderConfig: vi.fn(() => ({
				providerId: "openrouter",
				apiKey: "server-only-key",
			})),
		};
		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);
		const bootstrap = await prepareLocalRuntimeBootstrap({
			input: createStartInput(),
			sessionId: "sess-media-abort",
			providerSettingsManager: providerSettingsManager as never,
			defaultTelemetry: undefined,
			defaultToolPolicies: undefined,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});
		const abortController = new AbortController();
		const reportUsage = vi.fn();

		await bootstrap.runtimeBuilderInput.toolExecutors?.generateMedia?.(
			{ media_type: "image", prompt: "A lighthouse" },
			{
				agentId: "agent-1",
				iteration: 1,
				signal: abortController.signal,
				reportUsage,
			},
		);

		expect(generateSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				abortSignal: abortController.signal,
				providerConfig: expect.objectContaining({
					apiKey: "server-only-key",
				}),
			}),
		);
		expect(reportUsage).toHaveBeenCalledWith({
			inputTokens: 7,
			outputTokens: 3,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		});
		generateSpy.mockRestore();
	});

	it("filters globally disabled plugin tools before extension setup", async () => {
		vi.resetModules();
		resetModulesAfterEach = true;
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
				pluginPaths: [],
				warnings: [],
			})),
			resolvePluginSkillDirectoriesFromPaths: vi.fn(() => []),
		}));

		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);
		const bootstrap = await prepareLocalRuntimeBootstrap({
			input: createStartInput(),
			sessionId: "sess-1",
			providerSettingsManager: createProviderSettingsManager() as never,
			defaultTelemetry: undefined,
			defaultToolPolicies: undefined,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});

		const registeredTools: string[] = [];
		const plugin = bootstrap.extensions?.find(
			(extension) => extension.name === "plugin-a",
		);
		plugin?.setup?.(
			{
				registerTool: (tool: { name: string }) =>
					registeredTools.push(tool.name),
				registerCommand: () => {},
				registerMessageBuilder: () => {},
				registerRule: () => {},
				registerProvider: () => {},
				registerAutomationEventType: () => {},
				registerMcpServer: () => {},
			},
			{},
		);

		expect(registeredTools).toEqual(["allowed_tool"]);
	});

	it("loads only provider/model-compatible plugins during bootstrap", async () => {
		vi.resetModules();
		resetModulesAfterEach = true;
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
					pluginPaths:
						providerId === "cline" && modelId === "anthropic/claude-haiku-4.5"
							? ["/tmp/compatible-plugin.js"]
							: [],
					warnings: [],
				}),
			),
			resolvePluginSkillDirectoriesFromPaths: vi.fn(() => []),
		}));

		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);
		const bootstrap = await prepareLocalRuntimeBootstrap({
			input: createStartInput(),
			sessionId: "sess-1",
			providerSettingsManager: createProviderSettingsManager() as never,
			defaultTelemetry: undefined,
			defaultToolPolicies: undefined,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});

		const registeredTools: string[] = [];
		const plugin = bootstrap.extensions?.find(
			(extension) => extension.name === "plugin-compatible",
		);
		plugin?.setup?.(
			{
				registerTool: (tool: { name: string }) =>
					registeredTools.push(tool.name),
				registerCommand: () => {},
				registerMessageBuilder: () => {},
				registerRule: () => {},
				registerProvider: () => {},
				registerAutomationEventType: () => {},
				registerMcpServer: () => {},
			},
			{},
		);

		expect(registeredTools).toEqual(["compatible_tool"]);
	});

	it("threads active plugin skill directories into the runtime builder input", async () => {
		vi.resetModules();
		resetModulesAfterEach = true;
		const activePluginPath = "/tmp/review-plugin/index.js";
		const activeSkillDirectory = "/tmp/review-plugin/skills";
		const resolvePluginSkillDirectoriesFromPaths = vi.fn(() => [
			activeSkillDirectory,
		]);
		vi.doMock("../extensions/plugin/plugin-config-loader", () => ({
			resolveAndLoadAgentPlugins: vi.fn(async () => ({
				extensions: [],
				failures: [],
				pluginPaths: [activePluginPath],
				warnings: [],
			})),
			resolvePluginSkillDirectoriesFromPaths,
		}));

		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);
		const bootstrap = await prepareLocalRuntimeBootstrap({
			input: createStartInput(),
			localRuntime: {
				configExtensions: ["plugins", "skills"],
			},
			sessionId: "sess-1",
			providerSettingsManager: createProviderSettingsManager() as never,
			defaultTelemetry: undefined,
			defaultToolPolicies: undefined,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});

		expect(resolvePluginSkillDirectoriesFromPaths).toHaveBeenCalledWith([
			activePluginPath,
		]);
		expect(bootstrap.runtimeBuilderInput.pluginSkillDirectories).toEqual([
			activeSkillDirectory,
		]);
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
			defaultToolPolicies: undefined,
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
			defaultToolPolicies: undefined,
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
			defaultToolPolicies: undefined,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});

		expect(bootstrap.providerConfig.fetch).toBeUndefined();
	});

	it.each([
		"cline",
		"cline-pass",
	])("adds required source request headers for %s", async (providerId) => {
		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);

		const input = createStartInput();
		input.config.providerId = providerId;
		input.config.modelId =
			providerId === "cline-pass"
				? "cline-pass/test-model"
				: "anthropic/claude-haiku-4.5";
		const config = input.config as typeof input.config & {
			headers: Record<string, string>;
			providerConfig: {
				providerId: string;
				headers: Record<string, string>;
			};
		};
		config.headers = {
			"X-CLIENT-TYPE": "config-client",
			"X-Task-ID": "config-task",
			"x-config": "config",
			"x-shared": "config-wins",
		};
		config.providerConfig = {
			providerId,
			headers: {
				"X-CLIENT-VERSION": "provider-config-version",
				"x-provider-config": "provider-config",
			},
		};

		const bootstrap = await prepareLocalRuntimeBootstrap({
			input,
			localRuntime: {
				extensionContext: {
					client: { name: "cline-cli", version: "3.0.38" },
				},
			},
			sessionId: "sess-cline-headers",
			providerSettingsManager: createProviderSettingsManager({
				provider: providerId,
				model: input.config.modelId,
				headers: {
					"X-CLIENT-TYPE": "stored-client",
					"x-stored": "stored",
					"x-shared": "stored-loses",
				},
			}) as never,
			defaultTelemetry: undefined,
			defaultToolPolicies: undefined,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});

		expect(bootstrap.providerConfig.headers).toMatchObject({
			"HTTP-Referer": "https://cline.bot",
			"X-Title": "Cline",
			"User-Agent": "Cline/3.0.38",
			"X-IS-MULTIROOT": "false",
			"X-CLIENT-TYPE": "cline-cli",
			"X-CLIENT-VERSION": "3.0.38",
			"X-PLATFORM": "cli",
			"X-PLATFORM-VERSION": "3.0.38",
			"X-CORE-VERSION": corePackageVersion,
			"X-Task-ID": "sess-cline-headers",
			"x-config": "config",
			"x-provider-config": "provider-config",
			"x-shared": "config-wins",
			"x-stored": "stored",
		});
	});

	it("rebuilds extensionContext.client from hub-baked request headers", async () => {
		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);

		const input = createStartInput();
		const config = input.config as typeof input.config & {
			headers: Record<string, string>;
		};
		config.headers = {
			"X-CLIENT-TYPE": "cline-cli",
			"X-CLIENT-VERSION": "3.0.38",
		};

		const bootstrap = await prepareLocalRuntimeBootstrap({
			input,
			sessionId: "sess-hub-client",
			providerSettingsManager: createProviderSettingsManager() as never,
			defaultTelemetry: undefined,
			defaultToolPolicies: undefined,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});

		expect(bootstrap.config.extensionContext?.client).toEqual({
			name: "cline-cli",
			version: "3.0.38",
		});
		expect(bootstrap.providerConfig.headers).toMatchObject({
			"User-Agent": "Cline/3.0.38",
			"X-CLIENT-TYPE": "cline-cli",
			"X-CLIENT-VERSION": "3.0.38",
		});
	});

	it("prefers configured extensionContext.client over header-derived identity", async () => {
		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);

		const input = createStartInput();
		const config = input.config as typeof input.config & {
			headers: Record<string, string>;
		};
		config.headers = {
			"X-CLIENT-TYPE": "header-client",
			"X-CLIENT-VERSION": "0.0.1",
		};

		const bootstrap = await prepareLocalRuntimeBootstrap({
			input,
			localRuntime: {
				extensionContext: {
					client: { name: "cline-vscode", version: "9.9.9" },
				},
			},
			sessionId: "sess-local-client",
			providerSettingsManager: createProviderSettingsManager() as never,
			defaultTelemetry: undefined,
			defaultToolPolicies: undefined,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});

		expect(bootstrap.config.extensionContext?.client).toEqual({
			name: "cline-vscode",
			version: "9.9.9",
		});
	});

	it("uses host request headers for Cline providers on core sessions", async () => {
		const { prepareLocalRuntimeBootstrap } = await import(
			"./local-runtime-bootstrap"
		);

		const input = {
			...createStartInput(),
			source: "core" as const,
		};
		const config = input.config as typeof input.config & {
			headers: Record<string, string>;
		};
		config.headers = { "x-config": "config" };

		const bootstrap = await prepareLocalRuntimeBootstrap({
			input,
			localRuntime: {
				extensionContext: {
					client: {
						name: "VSCode Extension",
						version: "9.9.9",
						platform: "Visual Studio Code",
						platformVersion: "1.103.0",
						isMultiRoot: true,
					},
				},
			},
			sessionId: "sess-non-cli",
			providerSettingsManager: createProviderSettingsManager({
				provider: "cline",
				model: input.config.modelId,
				headers: {
					"x-stored": "stored",
				},
			}) as never,
			defaultTelemetry: undefined,
			defaultToolPolicies: undefined,
			onPluginEvent: () => {},
			onTeamEvent: () => {},
			createSpawnTool,
			readSessionMetadata: async () => undefined,
			writeSessionMetadata: async () => {},
		});

		expect(bootstrap.providerConfig.headers).toMatchObject({
			"HTTP-Referer": "https://cline.bot",
			"X-Title": "Cline",
			"User-Agent": "Cline/9.9.9",
			"X-IS-MULTIROOT": "true",
			"X-CLIENT-TYPE": "VSCode Extension",
			"X-CLIENT-VERSION": "9.9.9",
			"X-PLATFORM": "Visual Studio Code",
			"X-PLATFORM-VERSION": "1.103.0",
			"X-CORE-VERSION": corePackageVersion,
			"X-Task-ID": "sess-non-cli",
			"x-config": "config",
			"x-stored": "stored",
		});
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
			defaultToolPolicies: undefined,
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
			defaultToolPolicies: undefined,
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
			defaultToolPolicies: undefined,
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
