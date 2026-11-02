import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubEventEnvelope } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClineAccountService } from "../../account";
import { getProviderAuthHandler } from "../../auth/provider-auth-registry";
import { CloudSessionError } from "../../cloud/api";
import type { CloudSessionController } from "../../cloud/controller";
import {
	type CloudHubConnection,
	HubCloudSessionClient,
} from "../../cloud/hub-client";
import type { CloudModel } from "../../cloud/models";
import type {
	CloudSessionEvent,
	CloudSessionSnapshot,
} from "../../cloud/types";
import {
	OAuthReauthRequiredError,
	RuntimeOAuthTokenManager,
} from "../../runtime/orchestration/runtime-oauth-token-manager";
import * as handoffGit from "../../services/cloud-handoff/git-preparation";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";
import {
	emptyStoredProviderSettings,
	ProviderSettingsSchemaTyped,
} from "../../types/provider-settings";
import { HubCommandError, NodeHubClient } from "../client";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { createInMemoryHubOwnerContext } from "../discovery";
import { HubCloudSessionService } from "./cloud-session-service";
import { startHubWebSocketServer } from "./hub-websocket-server";

const services: HubCloudSessionService[] = [];
afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
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
			create: vi.fn(
				async (
					_input: Parameters<CloudSessionController["create"]>[0],
				): ReturnType<CloudSessionController["create"]> => ({
					sessionId: "ses-one",
					status: "ready",
				}),
			),
			attach: vi.fn(async (sessionId: string) => {
				emit({
					type: "snapshot",
					sessionId,
					snapshot: snapshot(sessionId),
					replace: true,
				});
				return { sessionId, status: "running" };
			}),
			send: vi.fn(
				async (..._args: Parameters<CloudSessionController["send"]>) => ({
					sessionId: "ses-one",
					ok: true,
				}),
			),
			prepareHandoffRepository: vi.fn(async (_repoUrl: string) => ({
				organizationId: "org-one",
			})),
			listModels: vi.fn(async (): Promise<CloudModel[]> => []),
			restoreCreationOptions: vi.fn(async () => {}),
			getArtifactDownloadUrl: vi.fn(async () => ({
				url: "https://storage.example/image.png",
				expiresAt: "2030-01-01T00:00:00Z",
			})),
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
				: await service
						.command(body.operation, body.args, body.scope)
						.catch((error: unknown) => {
							throw new HubCommandError(
								name,
								undefined,
								error instanceof Error ? error.message : String(error),
							);
						});
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

function localGitInput(root = tmpdir()) {
	const localGit: handoffGit.HandoffGitPublication = {
		id: "preparation",
		root,
		workspaceRelativePath: "",
		repoUrl: "https://github.com/example/project",
		remote: "origin",
		branch: "cline/handoff-12345678-abc",
		headSha: "a".repeat(40),
		treeSha: "b".repeat(40),
	};
	return {
		localGit,
		repoUrl: localGit.repoUrl,
		branch: localGit.branch,
		requestId: "handoff-attempt",
		modelId: "model",
		organizationId: "org-one",
		initialMessage: { text: "Captured summary" },
	};
}

describe("hub-owned cloud sessions", () => {
	it("resolves artifact URLs through the viewer without trimming artifact IDs", async () => {
		const f = fixture();
		const viewer = f.viewer();
		await viewer.connect();
		await expect(
			viewer.getArtifactDownloadUrl("ses-one", " frame "),
		).resolves.toMatchObject({ url: "https://storage.example/image.png" });
		const resolver = f.controllers[0].controller.getArtifactDownloadUrl;
		expect(resolver).toHaveBeenCalledWith("ses-one", " frame ");
		await viewer.dispose();
	});

	it("requires an approved organization before starting Git publication", async () => {
		const f = fixture();
		await expect(
			command(f.service, "create", [
				{ ...localGitInput(), organizationId: undefined },
			]),
		).rejects.toThrow("Local Git publication requires organizationId");
		expect(f.controllers).toHaveLength(0);
	});

	it.each([
		{ requestId: undefined },
		{ initialMessage: undefined },
		{ initialMessage: { text: " \n\t" } },
		{ initialMessage: { text: "Summary", images: ["invalid-image"] } },
		{ branch: "main" },
		{ localGit: { ...localGitInput().localGit, root: "relative" } },
		{ localGit: { ...localGitInput().localGit, treeSha: "HEAD" } },
		{
			repoUrl: "git@github.com:example/project",
			localGit: {
				...localGitInput().localGit,
				repoUrl: "git@github.com:example/project",
			},
		},
	])("rejects invalid publication input before Git executes: %j", async (invalid) => {
		const f = fixture();
		const apply = vi.spyOn(handoffGit, "applyHandoffGit");
		await expect(
			command(f.service, "create", [{ ...localGitInput(), ...invalid }]),
		).rejects.toThrow();
		expect(apply).not.toHaveBeenCalled();
		expect(f.service.activeCommands).toBe(0);
	});

	it("does not publish a prepared handoff under a different organization", async () => {
		const f = fixture();
		f.service.watch();
		const controller = f.controllers[0]?.controller;
		if (!controller) throw new Error("Missing cloud controller");
		controller.prepareHandoffRepository.mockResolvedValue({
			organizationId: "org-two",
		});
		const apply = vi
			.spyOn(handoffGit, "applyHandoffGit")
			.mockResolvedValue("c".repeat(40));
		await expect(
			command(f.service, "create", [localGitInput()]),
		).rejects.toThrow("organization changed");
		expect(apply).not.toHaveBeenCalled();
		expect(controller.create).not.toHaveBeenCalled();
	});

	it("revalidates the model before publication and refuses create after verification failure", async () => {
		const f = fixture();
		f.service.watch();
		const controller = f.controllers[0]?.controller;
		if (!controller) throw new Error("Missing cloud controller");
		const apply = vi
			.spyOn(handoffGit, "applyHandoffGit")
			.mockResolvedValue("c".repeat(40));
		const verify = vi
			.spyOn(handoffGit, "verifyPublishedHandoffGit")
			.mockRejectedValue(new Error("Published branch changed"));
		await expect(
			command(f.service, "create", [localGitInput()]),
		).rejects.toThrow("selected model");
		expect(apply).not.toHaveBeenCalled();
		controller.listModels.mockResolvedValue([
			{ id: "model", name: "Model", catalogId: "cline" },
		]);
		await expect(
			command(f.service, "create", [localGitInput()]),
		).rejects.toThrow("Published branch changed");
		expect(verify).toHaveBeenCalledExactlyOnceWith(
			localGitInput().localGit,
			"c".repeat(40),
		);
		expect(controller.create).not.toHaveBeenCalled();
		expect(f.service.activeCommands).toBe(0);
	});

	it("stops after publication if the account changes without using a replacement controller", async () => {
		const f = fixture();
		f.service.watch();
		const controller = f.controllers[0]?.controller;
		if (!controller) throw new Error("Missing cloud controller");
		controller.listModels.mockResolvedValue([
			{ id: "model", name: "Model", catalogId: "cline" },
		]);
		const pushed = deferred<string>();
		const apply = vi
			.spyOn(handoffGit, "applyHandoffGit")
			.mockReturnValue(pushed.promise);
		const verify = vi.spyOn(handoffGit, "verifyPublishedHandoffGit");
		const creation = command(f.service, "create", [localGitInput()]);
		const rejected = expect(creation).rejects.toThrow("account changed");
		await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
		f.changeScope("account-two");
		pushed.resolve("c".repeat(40));
		await rejected;
		expect(verify).not.toHaveBeenCalled();
		expect(controller.create).not.toHaveBeenCalled();
		expect(f.controllers).toHaveLength(1);
	});
	it("pins every handoff operation to its prepared account scope", async () => {
		const f = fixture();
		const viewer = f.viewer();
		expect(viewer.scope).toBeUndefined();
		await viewer.prepareHandoffRepository("https://github.com/example/project");
		const scope = viewer.scope;
		if (!scope) throw new Error("Missing prepared scope");
		const copy = viewer.scope;
		if (copy) copy.scopeGeneration++;
		expect(viewer.scope).toEqual(scope);
		f.changeScope("account-two");
		f.service.watch();
		for (const operation of [
			() =>
				viewer.prepareHandoffRepository(
					"https://github.com/example/project",
					scope,
				),
			() => viewer.listModels(scope),
			() => viewer.create({ modelId: "model", repoUrl: "repo" }, scope),
			() =>
				viewer.create(
					{
						modelId: "model",
						repoUrl: "repo",
						initialMessage: { text: "Continue" },
					},
					scope,
				),
		])
			await expect(operation()).rejects.toThrow("account changed");
		const current = f.controllers[1]?.controller;
		if (!current) throw new Error("Missing replacement controller");
		for (const method of [
			current.prepareHandoffRepository,
			current.listModels,
			current.create,
		])
			expect(method).not.toHaveBeenCalled();
		await expect(viewer.listModels()).resolves.toEqual([]);
	});

	it.each([
		"send",
		"create",
		"create-only",
	] as const)("keeps a lost %s reply unknown without replaying the request", async (operation) => {
		const f = fixture();
		const viewer = f.viewer();
		await viewer.connect();
		const original = f.connection.command;
		f.connection.command = async (...args) => {
			await original(...args);
			throw new Error("Reply lost");
		};
		const failure = await (operation === "send"
			? viewer.send("ses-one", "Once")
			: viewer.create({
					modelId: "model",
					repoUrl: "repo",
					...(operation === "create"
						? { initialMessage: { text: "Once" } }
						: { initialPrompt: "Once" }),
				})
		).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(Error);
		if (operation === "create")
			expect(failure).toMatchObject({
				code: "request_failed",
				detail:
					"The cloud task may have started. Check your cloud tasks before submitting this draft again.",
			});
		if (operation === "create-only") expect(failure).not.toHaveProperty("code");
		expect(
			f.controllers[0]?.controller[operation === "send" ? "send" : "create"],
		).toHaveBeenCalledOnce();
	});

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
		for (const { controller } of f.controllers)
			expect(controller.create).not.toHaveBeenCalled();
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

	it("keeps one publication and creation after viewer disconnect and rejects origin-only Git requests", async () => {
		const f = fixture();
		const { root, server } = await startCloudHub(f);
		const client = new NodeHubClient({
			url: server.url,
			authToken: server.authToken,
			clientId: "publisher",
			workspaceRoot: root,
		});
		const observer = new NodeHubClient({
			url: server.url,
			authToken: server.authToken,
			clientId: "observer",
			workspaceRoot: root,
		});
		const browser = new NodeHubClient({
			url: server.url,
			clientId: "browser",
			workspaceRoot: root,
			resolveConnectionHeaders: () => ({ Origin: "http://localhost:3000" }),
		});
		const viewer = new HubCloudSessionClient(async () => client);
		const browserViewer = new HubCloudSessionClient(async () => browser);
		const pushed = deferred<string>();
		const apply = vi
			.spyOn(handoffGit, "applyHandoffGit")
			.mockReturnValue(pushed.promise);
		const verify = vi
			.spyOn(handoffGit, "verifyPublishedHandoffGit")
			.mockResolvedValue();
		try {
			await viewer.connect();
			await observer.connect();
			await browserViewer.connect();
			const controller = f.controllers[0]?.controller;
			if (!controller) throw new Error("Missing cloud controller");
			controller.listModels.mockResolvedValue([
				{ id: "model", name: "Model", catalogId: "cline" },
			]);
			const input = {
				...localGitInput(root),
				initialMessage: {
					text: "Captured summary",
					images: Array<string>(6).fill("data:image/png;base64,aW1hZ2U="),
				},
			};
			controller.create.mockResolvedValue({
				sessionId: "ses-one",
				status: "ready",
				initialSend: { sessionId: "ses-one", ok: true },
			});
			await expect(browserViewer.create(input)).rejects.toThrow(
				"token-authenticated",
			);
			expect(apply).not.toHaveBeenCalled();
			const creation = viewer.create(input).catch((error: unknown) => error);
			await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
			const repeated = observer.command(
				"cloud.command",
				{ operation: "create", args: [input], scope: viewer.scope },
				undefined,
				{ timeoutMs: null },
			);
			await vi.waitFor(async () =>
				expect((await observer.command("hub.status")).payload).toMatchObject({
					activeCloudCommands: 2,
					idle: false,
				}),
			);
			expect(controller.create).not.toHaveBeenCalled();
			await viewer.dispose();
			await client.dispose();
			expect(await creation).toMatchObject({ code: "request_failed" });
			pushed.resolve("c".repeat(40));
			await expect(repeated).resolves.toMatchObject({
				ok: true,
				payload: {
					result: { sessionId: "ses-one", initialSend: { ok: true } },
				},
			});
			expect(apply).toHaveBeenCalledOnce();
			expect(verify).toHaveBeenCalledExactlyOnceWith(
				input.localGit,
				"c".repeat(40),
			);
			expect(controller.create).toHaveBeenCalledExactlyOnceWith({
				repoUrl: input.repoUrl,
				branch: input.branch,
				requestId: input.requestId,
				modelId: input.modelId,
				initialMessage: input.initialMessage,
				organizationId: "org-one",
				sandboxType: "resumable",
			});
			expect((await observer.command("hub.status")).payload).toMatchObject({
				activeCloudCommands: 0,
				idle: true,
			});
		} finally {
			pushed.resolve("c".repeat(40));
			await viewer.dispose();
			await browserViewer.dispose();
			await Promise.all([
				client.dispose(),
				observer.dispose(),
				browser.dispose(),
			]);
			await server.close();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("preserves repository preparation and ordinary send results over the socket", async () => {
		const f = fixture();
		const { root, server } = await startCloudHub(f);
		const client = new NodeHubClient({
			url: server.url,
			authToken: server.authToken,
			clientId: "cloud-outcomes",
			workspaceRoot: root,
		});
		const viewer = new HubCloudSessionClient(async () => client);
		try {
			const repo = "https://github.com/example/project";
			await expect(viewer.prepareHandoffRepository(repo)).resolves.toEqual({
				organizationId: "org-one",
			});
			const controller = f.controllers[0]?.controller;
			if (!controller) throw new Error("Missing cloud controller");
			expect(
				controller.prepareHandoffRepository,
			).toHaveBeenCalledExactlyOnceWith(repo);
			await expect(
				viewer.send("ses-one", "Continue", undefined, "model", ["image"]),
			).resolves.toEqual({ sessionId: "ses-one", ok: true });
			expect(controller.send).toHaveBeenLastCalledWith(
				"ses-one",
				"Continue",
				undefined,
				"model",
				["image"],
			);
			const failure = new CloudSessionError(
				"session_failed",
				"Repository clone failed.",
			);
			controller.send.mockRejectedValueOnce(failure);
			await expect(viewer.send("ses-one", "Continue")).rejects.toThrow(
				failure.message,
			);
			await client.command("cloud.command", {
				operation: "send",
				args: ["ses-one", "Short arguments"],
				scope: viewer.scope,
			});
			expect(controller.send).toHaveBeenLastCalledWith(
				"ses-one",
				"Short arguments",
			);
		} finally {
			await viewer.dispose();
			await client.dispose();
			await server.close();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps creation active after the requesting viewer disconnects", async () => {
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
		const observer = new NodeHubClient({
			url: server.url,
			authToken: server.authToken,
			clientId: "cloud-observer",
			workspaceRoot: root,
		});
		try {
			await viewer.connect();
			await observer.connect();
			const controller = f.controllers[0]?.controller;
			if (!controller) throw new Error("Missing connected controller");
			const completion =
				deferred<Awaited<ReturnType<CloudSessionController["create"]>>>();
			controller.create.mockReturnValueOnce(completion.promise);
			const input: Parameters<CloudSessionController["create"]>[0] = {
				modelId: "model",
				repoUrl: "https://github.com/example/project",
				initialMessage: {
					text: "    first()\n    second()\n",
					images: ["image"],
				},
				mode: "plan",
				workspaceRelativePath: "packages/app",
			};
			const created = viewer.create(input).catch((error: unknown) => error);
			await vi.waitFor(() => expect(controller.create).toHaveBeenCalled());
			expect((await observer.command("session.list")).payload).toMatchObject({
				activeCloudCommands: 1,
			});
			expect((await observer.command("hub.status")).payload).toMatchObject({
				idle: false,
			});
			await viewer.dispose();
			await client.dispose();
			expect(await created).toMatchObject({ code: "request_failed" });
			expect((await observer.command("session.list")).payload).toMatchObject({
				activeCloudCommands: 1,
			});
			expect(controller.create).toHaveBeenCalledExactlyOnceWith({
				...input,
				sandboxType: "resumable",
			});
			completion.resolve({
				sessionId: "ses-one",
				status: "ready",
				initialSend: { sessionId: "ses-one", ok: true },
			});
			await vi.waitFor(async () =>
				expect((await observer.command("session.list")).payload).toMatchObject({
					activeCloudCommands: 0,
				}),
			);
		} finally {
			await viewer.dispose();
			await client.dispose();
			await observer.dispose();
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
			await expect(
				next.create({
					modelId: "model",
					repoUrl: "repo",
					initialMessage: { text: "Continue" },
				}),
			).rejects.toThrow(/draining/);
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
		["https://custom.example", "https://custom.example"],
		["https://custom.example/api/v1", "https://custom.example"],
		[
			" https://custom.example/gateway/api/v1/// ",
			"https://custom.example/gateway",
		],
		[undefined, "https://environment.example"],
	])("discovers cloud sessions with provider base %s", async (baseUrl, apiBaseUrl) => {
		vi.stubEnv("CLINE_API_BASE_URL", "https://environment.example");
		const settings: NonNullable<
			ReturnType<ProviderSettingsManager["getProviderSettings"]>
		> = { provider: "cline", apiKey: "key", baseUrl };
		vi.spyOn(
			ProviderSettingsManager.prototype,
			"getProviderSettings",
		).mockReturnValue(settings);
		vi.spyOn(
			RuntimeOAuthTokenManager.prototype,
			"resolveProviderApiKey",
		).mockResolvedValue(null);
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = String(input);
			if (url === new URL("/api/v1/users/me", apiBaseUrl).href)
				return Response.json({
					success: true,
					data: { id: "user-one", organizations: [] },
				});
			if (url === `${apiBaseUrl}/api/v1/session`)
				return Response.json({ data: [{ id: "ses-one", status: "ready" }] });
			return new Response(null, { status: 404 });
		});
		const service = new HubCloudSessionService({ publish: () => {} });
		services.push(service);
		const discovered = await command(service, "listForDiscovery", [
			{ timeoutMs: 500 },
		]);
		expect(discovered.result).toMatchObject([{ sessionId: "ses-one" }]);
		expect(settings.baseUrl).toBe(baseUrl);
	});

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

	// Core 0.2.0 shipped with every cloud poll re-sending a rejected refresh
	// token: ~670 refresh requests and user.auth_logged_out events per signed-out
	// machine per 3h. A rejection must stick until the stored credentials change.
	it("stops refreshing rejected credentials until they change", async () => {
		let stored = {
			provider: "cline",
			auth: { accessToken: "dead-access", refreshToken: "dead-refresh" },
		};
		vi.spyOn(
			ProviderSettingsManager.prototype,
			"getProviderSettings",
		).mockImplementation(() => stored as never);
		const resolve = vi
			.spyOn(RuntimeOAuthTokenManager.prototype, "resolveProviderApiKey")
			.mockRejectedValue(new OAuthReauthRequiredError("cline"));
		const telemetry = { capture: vi.fn() };
		const service = new HubCloudSessionService({
			publish: () => {},
			telemetry: telemetry as never,
			getScope: () => "account-one",
		});
		services.push(service);
		service.watch();
		const controller = service["controller"];
		if (!controller) throw new Error("Controller missing");
		const getAuthToken = controller["options"].getAuthToken;

		for (let i = 0; i < 5; i++) expect(await getAuthToken()).toBeUndefined();
		expect(resolve).toHaveBeenCalledTimes(1);
		// The refresh path already reported the logout; this is not a soft failure.
		expect(telemetry.capture).not.toHaveBeenCalledWith(
			expect.objectContaining({ event: "user.auth_refresh_soft_failure" }),
		);

		// Signing in again writes new credentials, so the next poll refreshes.
		stored = {
			provider: "cline",
			auth: { accessToken: "new-access", refreshToken: "new-refresh" },
		};
		resolve.mockResolvedValue({ apiKey: "new-key" } as never);
		expect(await getAuthToken()).toBe("new-key");
		expect(resolve).toHaveBeenCalledTimes(2);
	});

	it("keeps reporting refresh failures that are not a rejection", async () => {
		vi.spyOn(
			ProviderSettingsManager.prototype,
			"getProviderSettings",
		).mockReturnValue({ provider: "cline" } as never);
		const resolve = vi
			.spyOn(RuntimeOAuthTokenManager.prototype, "resolveProviderApiKey")
			.mockRejectedValue(new Error("temporarily unavailable"));
		const service = new HubCloudSessionService({
			publish: () => {},
			getScope: () => "account-one",
		});
		services.push(service);
		service.watch();
		const controller = service["controller"];
		if (!controller) throw new Error("Controller missing");

		await controller["options"].getAuthToken();
		await controller["options"].getAuthToken();
		// Transient failures are retried on every poll, as before.
		expect(resolve).toHaveBeenCalledTimes(2);
	});
});

describe("persisted cloud account scope", () => {
	it("keeps the validated account pinned when persisted credentials change during controller creation", async () => {
		vi.spyOn(ProviderSettingsManager.prototype, "getProviderSettings")
			.mockReturnValue({
				provider: "cline",
				auth: { accountId: "account-two", accessToken: "second-token" },
			})
			.mockReturnValueOnce({
				provider: "cline",
				auth: { accountId: "account-one", accessToken: "first-token" },
			});
		const fetch = vi
			.spyOn(globalThis, "fetch")
			.mockRejectedValue(new Error("Unexpected remote request"));
		const service = new HubCloudSessionService({ publish: () => {} });
		services.push(service);
		await expect(
			service.command(
				"prepareHandoffRepository",
				["https://github.com/example/project"],
				{
					...service.snapshot(),
					expectedAccountId: "account-one",
				},
			),
		).rejects.toThrow("account changed");
		expect(fetch).not.toHaveBeenCalled();
	});
	it.each([
		"account-one",
		"account-two",
		"credential-only",
		"signed-out",
	])("checks the expected account before Personal handoff operations (%s)", async (identity) => {
		vi.spyOn(
			ProviderSettingsManager.prototype,
			"getProviderSettings",
		).mockReturnValue(
			identity === "signed-out"
				? undefined
				: {
						provider: "cline",
						auth: {
							accessToken: "synthetic-token",
							...(identity === "credential-only"
								? {}
								: { accountId: identity }),
						},
					},
		);
		const f = fixture();
		const service = new HubCloudSessionService({
			publish: () => {},
			createController: f.cloudSessionOptions.createController,
		});
		services.push(service);
		const scope = { ...service.snapshot(), expectedAccountId: "account-one" };
		const requests = [
			() =>
				service.command(
					"prepareHandoffRepository",
					["https://github.com/example/project"],
					scope,
				),
			() => service.command("listModels", [], scope),
			() =>
				service.command(
					"create",
					[
						{
							repoUrl: "https://github.com/example/project",
							modelId: "model",
							organizationId: null,
						},
					],
					scope,
				),
		];
		for (const request of requests) {
			if (identity === "account-one")
				await expect(request()).resolves.toHaveProperty("result");
			else
				await expect(request()).rejects.toThrow(
					"does not match the signed-in account",
				);
		}
		expect(f.controllers).toHaveLength(1);
		if (identity !== "account-one") {
			const { controller } = f.controllers[0]!;
			expect(controller.prepareHandoffRepository).not.toHaveBeenCalled();
			expect(controller.listModels).not.toHaveBeenCalled();
			expect(controller.create).not.toHaveBeenCalled();
		}
	});
	it("preserves the caller's expected account through the viewer request", async () => {
		const f = fixture();
		const viewer = f.viewer();
		await viewer.connect();
		const scope = viewer.scope;
		if (!scope) throw new Error("Missing cloud scope");
		await expect(
			viewer.prepareHandoffRepository("https://github.com/example/project", {
				...scope,
				expectedAccountId: "account-one",
			}),
		).rejects.toThrow("does not match the signed-in account");
		expect(
			f.controllers[0]!.controller.prepareHandoffRepository,
		).not.toHaveBeenCalled();
	});
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
