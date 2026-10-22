import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubEventEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClineAccountService } from "../../account";
import { getProviderAuthHandler } from "../../auth/provider-auth-registry";
import type { CloudSessionController } from "../../cloud/controller";
import {
	type CloudHubConnection,
	HubCloudSessionClient,
} from "../../cloud/hub-client";
import type {
	CloudSessionEvent,
	CloudSessionSnapshot,
} from "../../cloud/types";
import {
	OAuthReauthRequiredError,
	RuntimeOAuthTokenManager,
} from "../../runtime/orchestration/runtime-oauth-token-manager";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";
import {
	emptyStoredProviderSettings,
	ProviderSettingsSchemaTyped,
} from "../../types/provider-settings";
import { NodeHubClient } from "../client";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { createInMemoryHubOwnerContext } from "../discovery";
import { HubCloudSessionService } from "./cloud-session-service";
import { startHubWebSocketServer } from "./hub-websocket-server";

const services: HubCloudSessionService[] = [];
afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	await Promise.all(services.splice(0).map((service) => service.dispose()));
});
function command(
	service: HubCloudSessionService,
	operation: string,
	args: unknown,
) {
	return service.command(operation, args, service.snapshot());
}
function deferred<T>() {
	let resolve: (value: T | PromiseLike<T>) => void = () => {
		throw new Error("Deferred not initialized");
	};
	const promise = new Promise<T>((fulfill) => {
		resolve = fulfill;
	});
	return { promise, resolve };
}
function snapshot(sessionId = "ses-one"): CloudSessionSnapshot {
	return {
		sessionId,
		config: { executionTarget: "cloud" },
		messages: [],
		promptsInQueue: [],
		approvals: [],
		busy: true,
		status: "running",
		startedAt: 1,
		connectionState: "connected",
		transcriptKnown: true,
	};
}
function fixture() {
	let scope = "account-one";
	const listeners = new Set<(event: HubEventEnvelope) => void>();
	const controllers: ReturnType<typeof makeController>[] = [];
	function makeController() {
		let emit: (event: CloudSessionEvent) => void = () => {};
		const controller = {
			subscribe: (listener: typeof emit) => {
				emit = listener;
				return () => {};
			},
			create: vi.fn(async () => ({ sessionId: "ses-one", status: "ready" })),
			attach: vi.fn(async (sessionId: string) => {
				emit({
					type: "snapshot",
					sessionId,
					snapshot: snapshot(sessionId),
					replace: true,
				});
				return { sessionId, status: "running" };
			}),
			send: vi.fn(async () => ({ sessionId: "ses-one", ok: true })),
			restoreCreationOptions: vi.fn(async () => {}),
			listForDiscovery: vi.fn(async () => [{ sessionId: "ses-one" }]),
			dispose: vi.fn(async () => {}),
		};
		return { controller, emit: (event: CloudSessionEvent) => emit(event) };
	}
	const cloudSessionOptions = {
		getScope: () => scope,
		createController: () => {
			const current = makeController();
			controllers.push(current);
			return current.controller as unknown as CloudSessionController;
		},
	};
	const service = new HubCloudSessionService({
		...cloudSessionOptions,
		publish: (event, version) => {
			for (const listener of listeners)
				listener({
					version: "v1",
					event: "cloud.event",
					sessionId: event?.sessionId,
					payload: { event, ...version },
				});
		},
	});
	services.push(service);
	const command: CloudHubConnection["command"] = async (
		name,
		payload,
		_session,
		options,
	) => {
		options?.beforeDispatch?.();
		options?.onDispatch?.("request");
		const body = JSON.parse(JSON.stringify(payload ?? {}));
		const result =
			name === "cloud.watch"
				? service.watch()
				: await service.command(body.operation, body.args, body.scope);
		return JSON.parse(
			JSON.stringify({ version: "v1", ok: true, payload: result }),
		);
	};
	const connection: CloudHubConnection = {
		command,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
	const viewer = () => new HubCloudSessionClient(async () => connection);
	return {
		service,
		cloudSessionOptions,
		controllers,
		connection,
		viewer,
		emitRecovery: (payload: Record<string, unknown>) => {
			for (const listener of listeners)
				listener({ version: "v1", event: "cloud.event", payload });
		},
		changeScope: (value: string) => {
			scope = value;
		},
	};
}

describe("hub-owned cloud sessions", () => {
	it("does not rebind a prepared request when account recovery runs before dispatch", async () => {
		const f = fixture();
		const viewer = f.viewer();
		await viewer.connect();
		const creating = viewer.create({ modelId: "model", repoUrl: "repo" });
		f.changeScope("account-two");
		f.service.watch();
		await expect(creating).rejects.toThrow("account changed");
		for (const { controller } of f.controllers)
			expect(controller.create).not.toHaveBeenCalled();
	});

	it.each([
		"account",
		"daemon",
	])("rejects a delayed create after the %s changes before admission", async (change) => {
		const f = fixture();
		const viewer = f.viewer();
		await viewer.connect();
		const original = f.connection.command;
		f.connection.command = async (name, payload, ...rest) => {
			if (name === "cloud.command") {
				if (change === "account") f.changeScope("account-two");
				else
					payload = {
						...payload,
						scope: { ...(payload?.scope as object), serviceId: "old-daemon" },
					};
			}
			return original(name, payload, ...rest);
		};
		await expect(
			viewer.create({ modelId: "model", repoUrl: "repo" }),
		).rejects.toThrow("account changed");
		expect(f.controllers).toHaveLength(1);
		expect(f.controllers[0]?.controller.create).not.toHaveBeenCalled();
	});
	it.each([
		"plan",
		"zen",
	] as const)("preserves %s mode and workspace paths at the RPC boundary", async (mode) => {
		const f = fixture();
		const viewer = f.viewer();
		const options = {
			mode,
			workspaceRelativePath: "packages/app",
			thinking: true,
			autoApproveTools: false,
			reasoningEffort: "high" as const,
		};
		await viewer.create({ modelId: "model", repoUrl: "repo", ...options });
		await viewer.attach("ses-one", options);
		await viewer.restoreCreationOptions("ses-one", options);
		expect(f.controllers[0]?.controller.create).toHaveBeenCalledWith(
			expect.objectContaining(options),
		);
		expect(f.controllers[0]?.controller.attach).toHaveBeenCalledWith(
			"ses-one",
			options,
		);
		expect(
			f.controllers[0]?.controller.restoreCreationOptions,
		).toHaveBeenCalledWith("ses-one", options);
	});
	it.each([
		"same",
		"new",
	])("clears missed deletions on recovery from the %s daemon, including an empty set", async (daemon) => {
		const f = fixture();
		const viewer = f.viewer();
		await viewer.attach("ses-one");
		const removed = vi.fn();
		viewer.subscribe(removed);
		const state = f.service.snapshot();
		f.emitRecovery({
			...state,
			serviceId: daemon === "new" ? "new-daemon" : state.serviceId,
			snapshots: [],
		});
		expect(viewer.getSnapshot("ses-one")).toBeUndefined();
		expect(removed).toHaveBeenCalledWith({
			type: "removed",
			sessionId: "ses-one",
		});
	});

	it("shares a controller across viewers and retains work after viewer disposal", async () => {
		const f = fixture();
		const first = f.viewer();
		const second = f.viewer();
		await first.attach("ses-one");
		await second.connect();
		expect(second.getSnapshot("ses-one")?.status).toBe("running");
		await first.dispose();
		expect(f.controllers).toHaveLength(1);
		expect(f.controllers[0]!.controller.dispose).not.toHaveBeenCalled();
		await second.send("ses-one", "Continue", undefined, undefined, ["image"]);
		expect(f.controllers[0]!.controller.send).toHaveBeenCalledWith(
			"ses-one",
			"Continue",
			undefined,
			undefined,
			["image"],
		);
		await f.service.dispose();
		expect(f.controllers[0]!.controller.dispose).toHaveBeenCalledOnce();
	});
	it("keeps an admitted send alive when its viewer disconnects", async () => {
		const f = fixture();
		const viewer = f.viewer();
		await viewer.connect();
		const sending = deferred<{ sessionId: string; ok: boolean }>();
		f.controllers[0]!.controller.send.mockReturnValue(sending.promise);
		const result = viewer
			.send("ses-one", "Continue")
			.catch((error: unknown) => error);
		await vi.waitFor(() => expect(f.service.activeCommands).toBe(1));
		await viewer.dispose();
		expect(f.controllers[0]!.controller.dispose).not.toHaveBeenCalled();
		sending.resolve({ sessionId: "ses-one", ok: true });
		expect(await result).toBeInstanceOf(Error);
		expect(f.service.activeCommands).toBe(0);
	});
	it("retires old account state and ignores late events and replies", async () => {
		const f = fixture();
		const viewer = f.viewer();
		await viewer.attach("ses-one");
		const old = f.controllers[0]!;
		const pending = deferred<{ sessionId: string; ok: boolean }>();
		old.controller.send.mockReturnValue(pending.promise);
		const result = viewer
			.send("ses-one", "Continue")
			.catch((error: unknown) => error);
		await vi.waitFor(() => expect(old.controller.send).toHaveBeenCalledOnce());
		f.changeScope("account-two");
		await command(f.service, "listForDiscovery", []);
		expect(viewer.getSnapshot("ses-one")).toBeUndefined();
		expect(old.controller.dispose).toHaveBeenCalledOnce();
		old.emit({
			type: "snapshot",
			sessionId: "ses-one",
			snapshot: snapshot(),
			replace: true,
		});
		expect(viewer.getSnapshot("ses-one")).toBeUndefined();
		pending.resolve({ sessionId: "ses-one", ok: true });
		expect(String(await result)).toContain("account changed");
	});
	it("invalidates discovery-only caches on account change without another client command", async () => {
		vi.useFakeTimers();
		const f = fixture();
		const viewer = f.viewer();
		await viewer.listForDiscovery();
		expect(viewer.getCachedDiscoveryRecord("ses-one")).toBeDefined();
		f.changeScope("account-two");
		await vi.advanceTimersByTimeAsync(1000);
		expect(viewer.getCachedDiscoveryRecord("ses-one")).toBeUndefined();
	});
	it("validates operations and provisioning payloads before invoking the controller", async () => {
		const f = fixture();
		await expect(command(f.service, "dispose", [])).rejects.toThrow(
			"Unknown cloud operation",
		);
		await expect(command(f.service, "__proto__", [])).rejects.toThrow(
			"Unknown cloud operation",
		);
		await expect(
			command(f.service, "create", [
				{ modelId: "model", repoUrl: "repo", handoff: {} },
			]),
		).rejects.toThrow();
		await expect(
			command(f.service, "respondApproval", [
				"ses-one",
				"approval",
				{ approved: "yes" },
			]),
		).rejects.toThrow();
		expect(f.controllers).toHaveLength(0);
		await command(f.service, "create", [{ modelId: "model", repoUrl: "repo" }]);
		expect(f.controllers[0]!.controller.create).toHaveBeenCalledWith({
			modelId: "model",
			repoUrl: "repo",
			sandboxType: "resumable",
		});
	});
	it("does not resend a dispatched action when transport recovery retries", async () => {
		const f = fixture();
		const viewer = f.viewer();
		await viewer.connect();
		f.connection.command = async (_name, _payload, _session, options) => {
			options?.beforeDispatch?.();
			options?.onDispatch?.("first");
			options?.beforeDispatch?.();
			throw new Error("This must not be reached");
		};
		await expect(viewer.send("ses-one", "Once")).rejects.toThrow(
			"outcome is unknown",
		);
	});
	it("ignores a hydration reply older than a live snapshot", async () => {
		const f = fixture();
		await command(f.service, "attach", ["ses-one"]);
		const ready = deferred<void>();
		const original = f.connection.command;
		f.connection.command = async (name, ...args) => {
			const reply = await original(name, ...args);
			if (name === "cloud.watch") await ready.promise;
			return reply;
		};
		const viewer = f.viewer();
		const connecting = viewer.connect();
		await vi.waitFor(() => expect(f.controllers).toHaveLength(1));
		const current = { ...snapshot(), status: "completed", busy: false };
		f.controllers[0]!.emit({
			type: "snapshot",
			sessionId: "ses-one",
			snapshot: current,
			replace: true,
		});
		ready.resolve(undefined);
		await connecting;
		expect(viewer.getSnapshot("ses-one")?.status).toBe("completed");
	});
	it("hydrates untouched sessions when another session receives a newer live event", async () => {
		const f = fixture();
		await command(f.service, "attach", ["ses-one"]);
		const ready = deferred<void>();
		const original = f.connection.command;
		let watching = false;
		f.connection.command = async (name, ...args) => {
			const reply = await original(name, ...args);
			if (name === "cloud.watch") {
				watching = true;
				await ready.promise;
			}
			return reply;
		};
		const viewer = f.viewer();
		const connecting = viewer.connect();
		await vi.waitFor(() => expect(watching).toBe(true));
		f.controllers[0]?.emit({
			type: "snapshot",
			sessionId: "ses-two",
			snapshot: snapshot("ses-two"),
			replace: true,
		});
		ready.resolve(undefined);
		await connecting;
		expect(viewer.getSnapshot("ses-one")).toBeDefined();
		expect(viewer.getSnapshot("ses-two")).toBeDefined();
	});
	it("does not dispatch queued work after the viewer is disposed during hydration", async () => {
		const f = fixture();
		const ready = deferred<void>();
		const original = f.connection.command;
		let watching = false;
		f.connection.command = async (name, ...args) => {
			const reply = await original(name, ...args);
			if (name === "cloud.watch") {
				watching = true;
				await ready.promise;
			}
			return reply;
		};
		const viewer = f.viewer();
		const sending = viewer
			.send("ses-one", "Never dispatch")
			.catch((error: unknown) => error);
		await vi.waitFor(() => expect(watching).toBe(true));
		await viewer.dispose();
		ready.resolve(undefined);
		expect(String(await sending)).toContain("disposed");
		expect(f.controllers[0]?.controller.send).not.toHaveBeenCalled();
	});
});

describe("cloud RPC over a shared hub socket", () => {
	async function startCloudHub(f: ReturnType<typeof fixture>) {
		const root = mkdtempSync(join(tmpdir(), "cline-cloud-hub-"));
		const server = await startHubWebSocketServer({
			owner: createInMemoryHubOwnerContext("cloud-wire"),
			host: "127.0.0.1",
			port: 0,
			workspaceRoot: root,
			sessionHost: {
				subscribe: () => () => {},
				dispose: async () => {},
				listSessions: async () => [],
			} as never,
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: ":memory:" },
			taskOptions: {
				dbPath: join(root, "tasks.db"),
				globalSpecsDir: join(root, "specs"),
				watchFiles: false,
			},
			eventLog: { dbPath: ":memory:" },
			runQueue: false,
			cloudSessionOptions: f.cloudSessionOptions,
		});
		return { root, server };
	}

	it("reports in-flight cloud commands as hub activity", async () => {
		const f = fixture();
		const { root, server } = await startCloudHub(f);
		const client = new NodeHubClient({
			url: server.url,
			authToken: server.authToken,
			clientId: "cloud-activity",
			workspaceRoot: root,
		});
		const viewer = new HubCloudSessionClient(async () => {
			await client.connect();
			return client;
		});
		try {
			await viewer.connect();
			const provisioning = deferred<{ sessionId: string; status: string }>();
			f.controllers[0]!.controller.create.mockReturnValueOnce(
				provisioning.promise,
			);
			const created = viewer.create({
				modelId: "model",
				repoUrl: "https://github.com/cline/cline",
			});
			await vi.waitFor(() =>
				expect(f.controllers[0]!.controller.create).toHaveBeenCalled(),
			);
			expect((await client.command("session.list")).payload).toMatchObject({
				activeCloudCommands: 1,
			});
			expect((await client.command("hub.status")).payload).toMatchObject({
				idle: false,
			});
			provisioning.resolve({ sessionId: "ses-one", status: "ready" });
			await created;
			expect((await client.command("session.list")).payload).toMatchObject({
				activeCloudCommands: 0,
			});
		} finally {
			await viewer.dispose();
			await client.dispose();
			await server.close();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("hydrates another desktop client, preserves ownership on disconnect, and refuses new work while draining", async () => {
		const f = fixture();
		const { root, server } = await startCloudHub(f);
		const first = new NodeHubClient({
			url: server.url,
			authToken: server.authToken,
			clientId: "cloud-first",
			workspaceRoot: root,
		});
		const second = new NodeHubClient({
			url: server.url,
			authToken: server.authToken,
			clientId: "cloud-second",
			workspaceRoot: root,
		});
		try {
			const viewer = new HubCloudSessionClient(async () => {
				await first.connect();
				return first;
			});
			await viewer.attach("ses-one");
			expect(viewer.getSnapshot("ses-one")?.status).toBe("running");
			await viewer.dispose();
			await first.dispose();
			expect(f.controllers[0]?.controller.dispose).not.toHaveBeenCalled();
			const next = new HubCloudSessionClient(async () => {
				await second.connect();
				return second;
			});
			await next.connect();
			expect(next.getSnapshot("ses-one")?.status).toBe("running");
			const events: HubEventEnvelope[] = [];
			second.subscribe((event) => events.push(event));
			f.controllers[0]?.emit({
				type: "snapshot",
				sessionId: "ses-one",
				snapshot: snapshot(),
				replace: true,
			});
			await vi.waitFor(() =>
				expect(events.some((event) => event.event === "cloud.event")).toBe(
					true,
				),
			);
			expect(
				events
					.filter((event) => event.event === "cloud.event")
					.every((event) => event.sequence === undefined),
			).toBe(true);
			await second.command("hub.drain");
			await expect(next.send("ses-one", "New work")).rejects.toThrow(
				/draining/,
			);
			await next.dispose();
		} finally {
			await first.dispose();
			await second.dispose();
			await server.close();
			rmSync(root, { recursive: true, force: true });
		}
		expect(f.controllers[0]?.controller.dispose).toHaveBeenCalledOnce();
	});
});

describe("hub cloud credentials", () => {
	it.each([
		"failed refresh",
		"returning viewer",
	])("discards the previous organization after a %s", async (reason) => {
		vi.spyOn(
			ProviderSettingsManager.prototype,
			"getProviderSettings",
		).mockReturnValue({ provider: "cline", apiKey: "key" });
		vi.spyOn(
			RuntimeOAuthTokenManager.prototype,
			"resolveProviderApiKey",
		).mockResolvedValue(null);
		const fetch = vi
			.spyOn(ClineAccountService.prototype, "fetchUserOrganizations")
			.mockResolvedValueOnce([
				{ organizationId: "org-one", active: true },
			] as never);
		const service = new HubCloudSessionService({ publish: () => {} });
		services.push(service);
		service.watch();
		const controller = service["controller"]!;
		const getOrganization = controller["options"].getActiveOrganizationId!;
		expect(await getOrganization()).toBe("org-one");
		if (reason === "failed refresh") {
			fetch.mockRejectedValueOnce(new Error("organization request failed"));
			await expect(command(service, "refreshOrganization", [])).rejects.toThrow(
				"organization request failed",
			);
		} else service.watch();
		fetch.mockResolvedValueOnce([
			{ organizationId: "org-two", active: true },
		] as never);
		expect(await getOrganization()).toBe("org-two");
		expect(service["controller"]).toBe(controller);
	});

	it("refreshes the daemon organization cache through RPC without disposing cloud work", async () => {
		vi.spyOn(
			ProviderSettingsManager.prototype,
			"getProviderSettings",
		).mockReturnValue({ provider: "cline", apiKey: "key" });
		vi.spyOn(
			RuntimeOAuthTokenManager.prototype,
			"resolveProviderApiKey",
		).mockResolvedValue(null);
		const fetch = vi
			.spyOn(ClineAccountService.prototype, "fetchUserOrganizations")
			.mockResolvedValueOnce([
				{ organizationId: "org-one", active: true },
			] as never)
			.mockResolvedValueOnce([
				{ organizationId: "org-two", active: true },
			] as never);
		const service = new HubCloudSessionService({ publish: () => {} });
		services.push(service);
		service.watch();
		const controller = service["controller"]!;
		const getOrganization = controller["options"].getActiveOrganizationId!;
		expect(await getOrganization()).toBe("org-one");
		expect(await getOrganization()).toBe("org-one");
		expect(fetch).toHaveBeenCalledOnce();
		await command(service, "refreshOrganization", []);
		expect(await getOrganization()).toBe("org-two");
		expect(service["controller"]).toBe(controller);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("retains the controller when its OAuth refresh rotates tokens without an account id", async () => {
		let settings: NonNullable<
			ReturnType<ProviderSettingsManager["getProviderSettings"]>
		> = {
			provider: "cline",
			auth: {
				accessToken: "old-access",
				refreshToken: "old-refresh",
				expiresAt: 1,
			},
		};
		vi.spyOn(
			ProviderSettingsManager.prototype,
			"getProviderSettings",
		).mockImplementation(() => settings);
		vi.spyOn(
			ProviderSettingsManager.prototype,
			"saveProviderSettings",
		).mockImplementation((next) => {
			settings = ProviderSettingsSchemaTyped.parse(next);
			return emptyStoredProviderSettings();
		});
		const handler = getProviderAuthHandler("cline");
		if (!handler) throw new Error("Missing Cline auth handler");
		vi.spyOn(handler, "refresh").mockResolvedValue({
			access: "new-access",
			refresh: "new-refresh",
			expires: Date.now() + 3600000,
		});
		const service = new HubCloudSessionService({ publish: () => {} });
		services.push(service);
		service.watch();
		const controller = service["controller"]!;
		const dispose = vi.spyOn(controller, "dispose");
		expect(await controller["options"].getAuthToken()).toContain("new-access");
		service.watch();
		expect(service["controller"]).toBe(controller);
		expect(dispose).not.toHaveBeenCalled();
	});
	it("does not read provider settings for every streamed event", () => {
		const reads = vi
			.spyOn(ProviderSettingsManager.prototype, "getProviderSettings")
			.mockReturnValue({ provider: "cline", apiKey: "key" });
		let emit: (event: CloudSessionEvent) => void = () => {};
		const publish = vi.fn();
		const service = new HubCloudSessionService({
			publish,
			createController: () =>
				({
					subscribe: (listener: typeof emit) => {
						emit = listener;
					},
					dispose: async () => {},
				}) as unknown as CloudSessionController,
		});
		services.push(service);
		service.watch();
		reads.mockClear();
		for (let i = 0; i < 100; i++)
			emit({
				type: "snapshot",
				sessionId: "ses-one",
				snapshot: snapshot(),
				replace: false,
			});
		expect(reads).not.toHaveBeenCalled();
		expect(publish).toHaveBeenCalledTimes(100);
	});

	it.each([
		"manual",
		"refresh",
		"transient",
		"reauth",
	])("resolves %s credentials inside the daemon", async (mode) => {
		vi.spyOn(
			ProviderSettingsManager.prototype,
			"getProviderSettings",
		).mockReturnValue({ provider: "cline", apiKey: "persisted-key" });
		const resolve = vi.spyOn(
			RuntimeOAuthTokenManager.prototype,
			"resolveProviderApiKey",
		);
		if (mode === "refresh")
			resolve.mockResolvedValue({ apiKey: "fresh-key" } as never);
		else if (mode === "transient")
			resolve.mockRejectedValue(new Error("temporarily unavailable"));
		else if (mode === "reauth")
			resolve.mockRejectedValue(new OAuthReauthRequiredError("cline"));
		else resolve.mockResolvedValue(null);
		const service = new HubCloudSessionService({ publish: () => {} });
		services.push(service);
		service.watch();
		const controller = service["controller"];
		if (!controller) throw new Error("Controller missing");
		expect(await controller["options"].getAuthToken()).toBe(
			mode === "reauth"
				? undefined
				: mode === "refresh"
					? "fresh-key"
					: "persisted-key",
		);
	});
});

describe("persisted cloud account scope", () => {
	it.each([
		"key",
		"account",
		"endpoint",
		"signout",
	])("retires its controller after a %s change", (change) => {
		let settings: ReturnType<ProviderSettingsManager["getProviderSettings"]> = {
			provider: "cline",
			apiKey: "first-key",
		};
		if (change === "account")
			settings.auth = { accountId: "account-one", accessToken: "access-one" };
		vi.spyOn(
			ProviderSettingsManager.prototype,
			"getProviderSettings",
		).mockImplementation(() => settings);
		const created: Array<{
			subscribe: ReturnType<typeof vi.fn>;
			dispose: ReturnType<typeof vi.fn>;
		}> = [];
		const service = new HubCloudSessionService({
			publish: () => {},
			createController: () => {
				const controller = {
					subscribe: vi.fn(),
					dispose: vi.fn(async () => {}),
				};
				created.push(controller);
				return controller as unknown as CloudSessionController;
			},
		});
		services.push(service);
		service.watch();
		service.watch();
		expect(created).toHaveLength(1);
		if (change === "key") settings = { ...settings, apiKey: "second-key" };
		else if (change === "account")
			settings = {
				...settings,
				auth: { accountId: "account-two", accessToken: "access-two" },
			};
		else if (change === "endpoint")
			settings = { ...settings, baseUrl: "https://other.example" };
		else settings = undefined;
		service.watch();
		expect(created).toHaveLength(2);
		expect(created[0]?.dispose).toHaveBeenCalledOnce();
	});
	it("keeps the same controller when a token refresh preserves account identity", () => {
		let accessToken = "first-access";
		vi.spyOn(
			ProviderSettingsManager.prototype,
			"getProviderSettings",
		).mockImplementation(() => ({
			provider: "cline",
			auth: { accountId: "same-account", accessToken },
		}));
		const controller = { subscribe: vi.fn(), dispose: vi.fn(async () => {}) };
		const createController = vi.fn(
			() => controller as unknown as CloudSessionController,
		);
		const service = new HubCloudSessionService({
			publish: () => {},
			createController,
		});
		services.push(service);
		service.watch();
		accessToken = "refreshed-access";
		service.watch();
		expect(createController).toHaveBeenCalledOnce();
		expect(controller.dispose).not.toHaveBeenCalled();
	});
});
