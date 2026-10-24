import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalRuntimeHost } from "../../runtime/host/local-runtime-host";
import { resetClineRecommendedModelsCacheForTests } from "../../services/llms/cline-recommended-models";
import { clearLiveModelsCatalogCache } from "../../services/llms/provider-defaults";
import * as ProviderRegistry from "../../services/providers/local-provider-registry";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";
import { FileSessionService } from "../../session/services/file-session-service";
import {
	HubCommandError,
	hasActiveHubSessions,
	NodeHubClient,
} from "../client";
import { createHubProvidersApi } from "../client/providers";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { createInMemoryHubOwnerContext } from "../discovery";
import { HubServerTransport } from "./hub-server-transport";
import { startHubWebSocketServer } from "./hub-websocket-server";

let root: string;
let transport: HubServerTransport;
let transportStopped: boolean;
let api: ReturnType<typeof createHubProvidersApi>;
const send = vi.fn();

beforeEach(async () => {
	transportStopped = false;
	root = await mkdtemp(join(tmpdir(), "hub-providers-"));
	vi.stubEnv("CLINE_DATA_DIR", root);
	vi.stubEnv("CLINE_DIR", root);
	vi.stubEnv("CLINE_HOME_DIR", root);
	send.mockReset();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json({})),
	);
	transport = new HubServerTransport({
		sessionHost: new LocalRuntimeHost({
			sessionService: new FileSessionService(join(root, "sessions")),
		}),
		workspaceRoot: root,
		runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		eventLog: false,
		runQueue: false,
		sessionSearchOptions: { dbPath: ":memory:" },
	});
	send.mockImplementation(async (command, payload) =>
		transport.handleCommand({
			version: "v1",
			clientId: "providers-test",
			command,
			payload,
		}),
	);
	api = createHubProvidersApi({ command: send } as Pick<
		NodeHubClient,
		"command"
	>);
});
afterEach(async () => {
	if (!transportStopped) await transport?.stop();
	vi.restoreAllMocks();
	clearLiveModelsCatalogCache();
	resetClineRecommendedModelsCacheForTests();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});

describe("hub provider management", () => {
	it("protects an accepted multi-file provider write from replacement and shutdown", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let entered!: () => void;
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const write = ProviderRegistry.writeModelsFile;
		vi.spyOn(ProviderRegistry, "writeModelsFile").mockImplementationOnce(
			async (...args) => {
				entered();
				await gate;
				return await write(...args);
			},
		);
		const pending = api.add({
			providerId: "pending-provider",
			name: "Pending Provider",
			baseUrl: "https://example.test/v1",
			apiKey: "saved-first",
			models: ["finished-model"],
		});
		let stopping: Promise<void> | undefined;
		try {
			await started;
			expect(
				new ProviderSettingsManager().getProviderSettings("pending-provider")
					?.apiKey,
			).toBe("saved-first");
			const status = await transport.handleCommand({
				version: "v1",
				command: "hub.status",
			});
			expect(status.payload).toMatchObject({
				idle: false,
				activeProviderMutations: 1,
			});
			const sessions = await transport.handleCommand({
				version: "v1",
				command: "session.list",
			});
			expect(sessions.payload).toMatchObject({
				sessions: [],
				activeProviderMutations: 1,
			});
			expect(hasActiveHubSessions(sessions.payload)).toBe(true);
			await transport.handleCommand({ version: "v1", command: "hub.drain" });
			await expect(
				api.saveSettings({ providerId: "anthropic", apiKey: "refused" }),
			).rejects.toMatchObject({ code: "hub_draining" });
			const stopped = vi.fn();
			stopping = transport.stop().then(() => {
				transportStopped = true;
				stopped();
			});
			await Promise.resolve();
			expect(stopped).not.toHaveBeenCalled();
			release();
			await expect(pending).resolves.toMatchObject({ modelsCount: 1 });
			await stopping;
			expect(stopped).toHaveBeenCalledOnce();
			const modelsPath = ProviderRegistry.resolveModelsRegistryPath(
				new ProviderSettingsManager(),
			);
			expect(
				(await ProviderRegistry.readModelsFile(modelsPath)).providers[
					"pending-provider"
				].models,
			).toHaveProperty("finished-model");
			expect(
				(
					await transport.handleCommand({
						version: "v1",
						command: "hub.status",
					})
				).payload,
			).toMatchObject({ idle: true, activeProviderMutations: 0 });
		} finally {
			release();
			await pending;
			await stopping;
		}
	});

	it.each([
		"providers.add",
		"providers.settings.save",
		"providers.models.update",
	] as const)("refuses %s during drain before validation or persistence", async (command) => {
		await transport.handleCommand({ version: "v1", command: "hub.drain" });
		expect(
			await transport.handleCommand({ version: "v1", command, payload: {} }),
		).toMatchObject({ ok: false, error: { code: "hub_draining" } });
	});

	it("releases activity tracking when a provider write fails", async () => {
		vi.spyOn(ProviderRegistry, "writeModelsFile").mockRejectedValueOnce(
			new Error("model write failed"),
		);
		await expect(
			api.add({
				providerId: "failed-provider",
				name: "Failed Provider",
				baseUrl: "https://example.test/v1",
				models: ["model"],
			}),
		).rejects.toMatchObject({ code: "provider_error" });
		const status = await transport.handleCommand({
			version: "v1",
			command: "hub.status",
		});
		expect(status.payload).toMatchObject({
			idle: true,
			activeProviderMutations: 0,
		});
		const sessions = await transport.handleCommand({
			version: "v1",
			command: "session.list",
		});
		expect(hasActiveHubSessions(sessions.payload)).toBe(false);
	});

	it("creates a provider, discovers its models, and persists overrides across calls", async () => {
		await api.add({
			providerId: "hub-custom",
			name: "Hub Custom",
			baseUrl: "https://example.test/v1",
			apiKey: "secret",
			models: ["first"],
		});
		expect((await api.list()).providers).toContainEqual(
			expect.objectContaining({ id: "hub-custom" }),
		);
		expect(
			(await api.listModels({ providerId: "hub-custom" })).models.map(
				(m) => m.id,
			),
		).toEqual(["first"]);
		await api.updateModels({
			providerId: "hub-custom",
			models: ["second", "third"],
		});
		expect(
			(await api.listModels({ providerId: "hub-custom" })).models.map(
				(m) => m.id,
			),
		).toEqual(["second", "third"]);
		await api.saveSettings({
			providerId: "hub-custom",
			apiKey: "replacement",
			model: "second",
		});
		expect(
			new ProviderSettingsManager().getProviderSettings("hub-custom"),
		).toMatchObject({ apiKey: "replacement", model: "second" });
		expect(send).toHaveBeenCalledWith(
			"providers.add",
			expect.any(Object),
			undefined,
			{ retryAfterDispatch: false },
		);
	});

	it("serves the provider API over a registered WebSocket connection", async () => {
		const server = await startHubWebSocketServer({
			host: "127.0.0.1",
			port: 0,
			owner: createInMemoryHubOwnerContext("provider-rpc-test"),
			workspaceRoot: root,
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			eventLog: false,
			runQueue: false,
			sessionSearchOptions: { dbPath: ":memory:" },
		});
		const client = new NodeHubClient({
			url: server.url,
			authToken: server.authToken,
			clientType: "provider-test",
		});
		try {
			await client.connect();
			const remote = createHubProvidersApi(client);
			await remote.saveSettings({
				providerId: "anthropic",
				apiKey: "from-websocket",
			});
			expect(
				new ProviderSettingsManager().getProviderSettings("anthropic")?.apiKey,
			).toBe("from-websocket");
			expect((await remote.list()).providers).toContainEqual(
				expect.objectContaining({ id: "anthropic", enabled: true }),
			);
		} finally {
			await client.dispose();
			await server.close();
		}
	});

	it("includes cloud-only models only when requested", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string | URL | Request) => {
				if (String(input) === "https://models.dev/api.json")
					return Response.json({});
				return Response.json({
					clineCloud: [{ id: "cline-cloud/cloud-only", name: "Cloud Only" }],
				});
			}),
		);
		const local = await api.listModels({ providerId: "cline" });
		expect(
			local.models.some((model) => model.id.startsWith("cline-cloud/")),
		).toBe(false);
		const cloud = await api.listModels({
			providerId: "cline",
			includeCloudModels: true,
		});
		expect(cloud.models).toContainEqual(
			expect.objectContaining({ id: "cline-cloud/cloud-only" }),
		);
	});

	it("preserves settings patch/clear behavior and reports only credential changes", async () => {
		expect(
			await api.saveSettings({
				providerId: "cline",
				apiKey: "old",
				auth: { accountId: "account" },
			}),
		).toMatchObject({ clineCredentialsChanged: true });
		expect(
			await api.saveSettings({
				providerId: "cline",
				baseUrl: "https://example.test",
			}),
		).toMatchObject({ clineCredentialsChanged: false });
		expect(
			await api.saveSettings({ providerId: "cline", apiKey: "new" }),
		).toMatchObject({ clineCredentialsChanged: true });
		await api.saveSettings({ providerId: "cline", baseUrl: "" });
		expect(
			new ProviderSettingsManager().getProviderSettings("cline")?.baseUrl,
		).toBeUndefined();
	});

	it("merges nested settings and accepts the forms' field-clear values", async () => {
		await api.saveSettings({
			providerId: "bedrock",
			headers: { Keep: "yes", Remove: "no" },
			aws: {
				region: "us-east-1",
				endpoint: "https://example.test",
				usePromptCache: true,
			},
		});
		await api.saveSettings({
			providerId: "bedrock",
			headers: { Remove: null },
			aws: { endpoint: "", usePromptCache: null },
		});
		const settings = new ProviderSettingsManager().getProviderSettings(
			"bedrock",
		);
		expect(settings?.headers).toEqual({ Keep: "yes" });
		expect(settings?.aws).toEqual({ region: "us-east-1" });
	});

	it("clears shared Cline Pass credentials and legacy secrets on disable", async () => {
		const manager = new ProviderSettingsManager();
		manager.saveProviderSettings({
			provider: "cline",
			apiKey: "secret",
			auth: { accountId: "account", accessToken: "token" },
		});
		await writeFile(
			join(root, "secrets.json"),
			JSON.stringify({
				"cline:clineAccountId": "legacy",
				clineApiKey: "legacy-key",
				unrelated: "keep",
			}),
		);
		expect(
			await api.saveSettings({ providerId: "cline-pass", enabled: false }),
		).toMatchObject({ enabled: false, clineCredentialsChanged: true });
		expect(
			new ProviderSettingsManager().getProviderSettings("cline"),
		).toBeUndefined();
		expect(
			JSON.parse(await readFile(join(root, "secrets.json"), "utf8")),
		).toEqual({ unrelated: "keep" });
	});

	it("returns recommended models with the offline fallback", async () => {
		const result = await api.recommendedModels();
		expect(result.recommended.length).toBeGreaterThan(0);
		expect(result).toMatchObject({
			free: expect.any(Array),
			clinePass: expect.any(Array),
		});
	});

	it("rejects invalid writes before changing persisted settings", async () => {
		await api.saveSettings({ providerId: "cline", apiKey: "keep" });
		const result = await transport.handleCommand({
			version: "v1",
			command: "providers.settings.save",
			payload: { providerId: "cline", enabled: "no" },
		});
		expect(result).toMatchObject({
			ok: false,
			error: { code: "invalid_payload" },
		});
		expect(
			new ProviderSettingsManager().getProviderSettings("cline")?.apiKey,
		).toBe("keep");
	});

	it("requires registration on browser connections for provider access", async () => {
		const result = await transport.handleCommand(
			{ version: "v1", command: "providers.list" },
			null,
		);
		expect(result).toMatchObject({
			ok: false,
			error: { code: "client_not_registered" },
		});
	});

	it("propagates failures without falling back to local writes", async () => {
		send.mockResolvedValueOnce({
			ok: false,
			error: { code: "provider_error", message: "write failed" },
		});
		await expect(
			api.saveSettings({ providerId: "cline", apiKey: "never" }),
		).rejects.toBeInstanceOf(HubCommandError);
		expect(
			new ProviderSettingsManager().getProviderSettings("cline"),
		).toBeUndefined();
		expect(send).toHaveBeenCalledTimes(1);
	});
});
