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
			},
			{},
		);

		expect(registeredTools).toEqual(["compatible_tool"]);
	});
});
