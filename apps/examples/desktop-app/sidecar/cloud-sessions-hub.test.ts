import { HubTransportError } from "@cline/core";
import type { HubEventEnvelope } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	CloudSessionApi,
	CloudSessionError,
	CloudSessionManager,
	type CloudSessionRecord,
	resetCloudSessionManager,
} from "./cloud-sessions";
import type { SidecarContext } from "./types";

const REMOTE_SESSION: CloudSessionRecord = {
	id: "ses-outer",
	status: "ready",
	sandboxUrl: "https://pod.example/hub",
	repoContext: { repoUrl: "https://github.com/cline/test" },
	metadata: { modelId: "anthropic/claude-sonnet-5" },
	createdAt: "2026-08-05T10:00:00.000Z",
	updatedAt: "2026-08-05T10:01:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function createContext(): {
	ctx: SidecarContext;
	events: Array<{ name: string; payload: Record<string, unknown> }>;
} {
	const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
	const ctx = {
		liveSessions: new Map(),
		restoringWorkspacePaths: new Set(),
		streamIndices: new Map(),
		coreStreamActivity: new Map(),
		bootId: "cloud-test-boot",
		wsClients: new Set([
			{
				// Approval ownership requires a trusted desktop connection.
				data: { canApproveTools: true },
				send(message: string) {
					const parsed = JSON.parse(message) as {
						event: { name: string; payload: Record<string, unknown> };
					};
					events.push(parsed.event);
				},
			},
		]),
		pendingApprovals: new Map(),
		pendingQuestions: new Map(),
		sessionManager: null,
		hubClient: null,
		workspaceRoot: "/local/workspace",
		unsubscribeSessionEvents: null,
		cloudSessionManager: null,
	} as SidecarContext;
	return { ctx, events };
}

class FakeHubClient {
	events?: (event: HubEventEnvelope) => void;
	disposed = false;
	resolveHeaders?: () => unknown;
	commandHook?: (command: string) => void | Promise<void>;
	listedSessions?: Array<Record<string, unknown>>;
	listedModel?: string;
	attachedModel?: string;
	readonly subscriptionSessionIds: Array<string | undefined> = [];
	sessionStatus?: string;
	messages: unknown[] = [{ role: "user", content: "hi" }];
	prompts: Array<Record<string, unknown>> = [
		{
			id: "q-1",
			prompt: "queued prompt",
			delivery: "queue",
			attachmentCount: 0,
		},
	];
	pendingApprovals: Array<Record<string, unknown>> = [];
	readonly commands: Array<{
		command: string;
		payload?: Record<string, unknown>;
		sessionId?: string;
		options?: { timeoutMs?: number | null };
	}> = [];

	constructor(private readonly hasExistingInner = true) {}

	async connect(): Promise<void> {}

	getClientId(): string {
		return "code-cloud-ses-outer";
	}

	subscribe(
		listener: (event: HubEventEnvelope) => void,
		options?: { sessionId?: string },
	): () => void {
		this.events = listener;
		this.subscriptionSessionIds.push(options?.sessionId);
		queueMicrotask(() => {
			if (this.events !== listener || options?.sessionId !== "inner-1") return;
			for (const approval of this.pendingApprovals) {
				listener({
					version: "v1",
					event: "approval.requested",
					eventId: `evt-${approval.approvalId}`,
					timestamp: 1,
					sessionId: "inner-1",
					payload: approval,
				});
			}
		});
		return () => {
			this.events = undefined;
		};
	}

	async command(
		command: string,
		payload?: Record<string, unknown>,
		sessionId?: string,
		options?: { timeoutMs?: number | null },
	): Promise<{
		ok: true;
		payload?: Record<string, unknown>;
	}> {
		this.commands.push({ command, payload, sessionId, options });
		await this.commandHook?.(command);
		if (command === "session.list") {
			return {
				ok: true,
				payload: {
					sessions:
						this.listedSessions ??
						(this.hasExistingInner
							? [
									{
										sessionId: "inner-1",
										updatedAt: 20,
										...(this.listedModel
											? { metadata: { model: this.listedModel } }
											: {}),
									},
								]
							: []),
				},
			};
		}
		if (command === "session.create") {
			return {
				ok: true,
				payload: { session: { sessionId: "inner-created" } },
			};
		}
		if (command === "session.attach" && this.attachedModel) {
			return {
				ok: true,
				payload: {
					session: {
						sessionId,
						metadata: { model: this.attachedModel },
					},
				},
			};
		}
		if (command === "session.pending_prompts") {
			return {
				ok: true,
				payload: { prompts: this.prompts.map((item) => ({ ...item })) },
			};
		}
		if (command === "session.messages") {
			return {
				ok: true,
				payload: { messages: this.messages },
			};
		}
		if (
			command === "session.get" &&
			(this.sessionStatus || this.attachedModel)
		) {
			return {
				ok: true,
				payload: {
					session: {
						status: this.sessionStatus,
						...(this.attachedModel
							? { metadata: { model: this.attachedModel } }
							: {}),
					},
				},
			};
		}
		return { ok: true, payload: {} };
	}

	async dispose(): Promise<void> {
		this.disposed = true;
	}
}

function createFixture({
	hub = new FakeHubClient(),
	...options
}: Partial<ConstructorParameters<typeof CloudSessionManager>[1]> & {
	hub?: FakeHubClient;
} = {}) {
	const { ctx, events } = createContext();
	const manager = new CloudSessionManager(ctx, {
		api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
		apiBaseUrl: "https://api.example",
		getAuthToken: async () => "workos:fresh",
		createHubClient: (clientOptions) => {
			hub.resolveHeaders = clientOptions.resolveConnectionHeaders;
			return hub as never;
		},
		...options,
	});
	return { ctx, events, hub, manager };
}

describe("CloudSessionManager Hub runtime", () => {
	it.each([
		"session.list",
		"session.create",
	])("cancels a send stopped while %s is pending", async (blockedCommand) => {
		const { manager, hub } = createFixture({ hub: new FakeHubClient(false) });
		let release!: () => void;
		hub.commandHook = (command) => {
			if (command === blockedCommand) {
				hub.commandHook = undefined;
				return new Promise<void>((resolve) => {
					release = resolve;
				});
			}
		};
		const result = manager
			.send("ses-outer", "cancel this")
			.catch((error: unknown) => error);
		await vi.waitFor(() => expect(release).toBeDefined());
		const aborting = manager.abort("ses-outer");
		release();
		await aborting;
		expect(await result).toBeInstanceOf(Error);
		expect(
			hub.commands.some(({ command }) => command === "session.send_input"),
		).toBe(false);
		await manager.dispose();
	});

	it.each([
		"abort",
		"dispose",
	] as const)("%s cancels a provisioning send before opening the Hub", async (action) => {
		let provisioningSignal: AbortSignal | undefined;
		const { manager, hub, ctx } = createFixture({
			api: {
				create: async () => ({
					sessionId: "ses-outer",
					status: "provisioning",
					sandboxUrl: "",
				}),
				list: async () => [],
				waitUntilReady: (_id: string, signal: AbortSignal) =>
					new Promise<void>((_resolve, reject) => {
						provisioningSignal = signal;
						signal.addEventListener("abort", () => reject(signal.reason), {
							once: true,
						});
					}),
			} as unknown as CloudSessionApi,
		});
		await manager.create({
			modelId: "model",
			repoUrl: "https://github.com/cline/test",
		});
		const rejected = expect(
			manager.send("ses-outer", "Fix this"),
		).rejects.toThrow();
		await vi.waitFor(() => expect(provisioningSignal).toBeDefined());
		if (action === "abort") await manager.abort("ses-outer");
		else await manager.dispose();
		await rejected;
		expect(provisioningSignal?.aborted).toBe(true);
		expect(hub.commands).toEqual([]);
		expect(ctx.liveSessions.has("ses-outer")).toBe(action === "abort");
	});
	it("reuses the newest inner Hub session and translates events to the outer id", async () => {
		const { manager, events, hub } = createFixture();

		await manager.list();
		await manager.attach("ses-outer");
		hub.events?.({
			version: "v1",
			event: "session.updated",
			eventId: "evt-1",
			sequence: 1,
			timestamp: Date.now(),
			sessionId: "inner-1",
			payload: { session: { status: "running" } },
		});

		expect(hub.commands[0]).toMatchObject({ command: "session.list" });
		expect(hub.commands[1]).toMatchObject({
			command: "session.attach",
			sessionId: "inner-1",
		});
		expect(events.at(-1)).toEqual({
			name: "chat_session_status",
			payload: { sessionId: "ses-outer", status: "running" },
		});
	});

	it("ignores stale running snapshots after a terminal Hub event", async () => {
		const { manager, ctx, events, hub } = createFixture();

		await manager.list();
		await manager.attach("ses-outer");
		hub.events?.({
			version: "v1",
			event: "run.completed",
			eventId: "evt-done",
			sequence: 2,
			sessionId: "inner-1",
		});
		hub.events?.({
			version: "v1",
			event: "session.updated",
			eventId: "evt-stale",
			sequence: 1,
			sessionId: "inner-1",
			payload: { session: { status: "running" } },
		});

		expect(ctx.liveSessions.get("ses-outer")?.status).toBe("completed");
		expect(events.at(-1)?.name).toBe("chat_session_ended");

		hub.events?.({
			version: "v1",
			event: "session.updated",
			eventId: "evt-stale-unsequenced",
			sessionId: "inner-1",
			payload: { session: { status: "running" } },
		});

		expect(ctx.liveSessions.get("ses-outer")?.status).toBe("completed");
		expect(events.at(-1)?.name).toBe("chat_session_ended");
	});

	it("ignores newer child sessions when reconnecting to the cloud root", async () => {
		const hub = new FakeHubClient();
		hub.listedSessions = [
			{ sessionId: "inner-root", updatedAt: 20 },
			{
				sessionId: "inner-child",
				updatedAt: 30,
				metadata: { parentSessionId: "inner-root" },
			},
		];
		const { manager } = createFixture({ hub });

		await manager.list();
		await manager.attach("ses-outer");

		expect(hub.commands).toContainEqual(
			expect.objectContaining({
				command: "session.attach",
				sessionId: "inner-root",
			}),
		);
	});

	it("uses unique Hub client ids and keeps subscriptions session-scoped", async () => {
		const clientIds: string[] = [];
		const hubs = [new FakeHubClient(), new FakeHubClient()];
		for (const hub of hubs) {
			const { manager } = createFixture({
				createHubClient: (options) => {
					clientIds.push(String(options.clientId));
					return hub as never;
				},
			});
			await manager.list();
			await manager.attach("ses-outer");
		}

		expect(new Set(clientIds).size).toBe(2);
		expect(clientIds).toEqual([
			expect.stringMatching(/^code-cloud-ses-outer-/),
			expect.stringMatching(/^code-cloud-ses-outer-/),
		]);
		expect(hubs.map((hub) => hub.subscriptionSessionIds)).toEqual([
			["ses-outer", "inner-1"],
			["ses-outer", "inner-1"],
		]);
	});

	it("resolves the Hub session by the server task id", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		const originalCommand = hub.command.bind(hub);
		hub.command = async (command, payload, sessionId, options) => {
			if (command === "session.get") {
				hub.commands.push({ command, payload, sessionId, options });
				return { ok: true, payload: { session: { sessionId: "task-1" } } };
			}
			return await originalCommand(command, payload, sessionId, options);
		};
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [
					{
						...REMOTE_SESSION,
						metadata: { ...REMOTE_SESSION.metadata, taskId: "task-1" },
					},
				],
			} as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});

		await manager.list();
		await manager.attach("ses-outer");

		expect(hub.commands[0]).toMatchObject({
			command: "session.get",
			payload: { sessionId: "task-1" },
			sessionId: "task-1",
		});
		expect(hub.commands.some(({ command }) => command === "session.list")).toBe(
			false,
		);
	});

	it("keeps a scoped client alive after the initial WebSocket fails", async () => {
		const { ctx } = createContext();
		const hub = new (class extends FakeHubClient {
			override async connect(): Promise<void> {
				throw new HubTransportError("hub_connect_failed", "pod starting");
			}
		})();
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});

		await manager.list();
		await expect(manager.attach("ses-outer")).resolves.toMatchObject({
			sessionId: "ses-outer",
		});
		expect(hub.disposed).toBe(false);
		expect(hub.subscriptionSessionIds.at(-1)).toBe("ses-outer");
		await manager.dispose();
	});

	it("waits for the initial root lookup when attach and send overlap", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		hub.commandHook = async (command) => {
			if (command === "session.list") await blocked;
		};
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.list();
		const attach = manager.attach("ses-outer");
		await vi.waitFor(() =>
			expect(
				hub.commands.some((entry) => entry.command === "session.list"),
			).toBe(true),
		);
		const send = manager.send("ses-outer", "hello");
		await new Promise((resolve) => setTimeout(resolve, 0));
		const created = hub.commands.some(
			(entry) => entry.command === "session.create",
		);
		release();
		await Promise.all([attach, send]);
		await manager.dispose();
		expect(created).toBe(false);
		expect(hub.commands).toContainEqual(
			expect.objectContaining({
				command: "session.send_input",
				sessionId: "inner-1",
			}),
		);
	});

	it("preserves initial send transport errors and resolves the root on retry", async () => {
		const { ctx } = createContext();
		let offline = true;
		const hub = new (class extends FakeHubClient {
			override async connect() {
				if (offline)
					throw new HubTransportError("hub_connect_failed", "pod starting");
			}
		})();
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.list();
		await expect(manager.send("ses-outer", "first")).rejects.toThrow(
			"pod starting",
		);
		expect(hub.disposed).toBe(false);
		offline = false;
		await manager.send("ses-outer", "retry");
		expect(
			hub.commands.some((entry) => entry.command === "session.create"),
		).toBe(false);
		expect(hub.commands).toContainEqual(
			expect.objectContaining({
				command: "session.send_input",
				sessionId: "inner-1",
			}),
		);
		await manager.dispose();
	});

	it("drops replayed Hub events by eventId", async () => {
		const { manager, events, hub } = createFixture();
		await manager.list();
		await manager.attach("ses-outer");
		const replayed: HubEventEnvelope = {
			version: "v1",
			event: "assistant.delta",
			eventId: "evt-replayed",
			timestamp: Date.now(),
			sessionId: "inner-1",
			payload: { text: "once" },
		};

		hub.events?.(replayed);
		hub.events?.(replayed);

		expect(
			events.filter(
				(item) => item.name === "chat_event" && item.payload.chunk === "once",
			),
		).toHaveLength(1);
	});

	it("resolves fresh bearer headers for each WebSocket connection attempt", async () => {
		const hub = new FakeHubClient();
		const tokens = ["workos:first", "workos:refreshed"];
		const { manager, events } = createFixture({
			getAuthToken: async () => tokens.shift(),
			hub,
		});
		await manager.list();
		await manager.attach("ses-outer");

		expect(await hub.resolveHeaders?.()).toEqual({
			Authorization: "Bearer workos:first",
		});
		hub.listedSessions = [{ sessionId: "inner-replacement", updatedAt: 30 }];
		const commandIndex = hub.commands.length;
		expect(await hub.resolveHeaders?.()).toEqual({
			Authorization: "Bearer workos:refreshed",
		});
		await manager.send("ses-outer", "after reconnect");
		await vi.waitFor(() => {
			expect(
				hub.commands.some(
					(entry) =>
						entry.command === "session.attach" &&
						entry.sessionId === "inner-replacement",
				),
			).toBe(true);
		});
		const commandsAfterReconnect = hub.commands
			.slice(commandIndex)
			.filter(
				(entry) =>
					entry.command === "session.attach" ||
					entry.command === "session.send_input",
			);
		expect(commandsAfterReconnect).not.toContainEqual(
			expect.objectContaining({ sessionId: "inner-1" }),
		);
		expect(commandsAfterReconnect).toContainEqual(
			expect.objectContaining({
				command: "session.send_input",
				sessionId: "inner-replacement",
			}),
		);
		expect(
			events.some(
				(event) =>
					event.name === "cloud_session_rehydrated" &&
					event.payload.sessionId === "ses-outer",
			),
		).toBe(true);
	});

	it("waits for reconnect lookup before creating an inner session for a send", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		let resolveHeaders: (() => unknown) | undefined;
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: (options) => {
				resolveHeaders = options.resolveConnectionHeaders;
				return hub as never;
			},
		});
		await manager.list();
		await manager.attach("ses-outer");
		await resolveHeaders?.();
		let releaseLookup!: () => void;
		const lookupPending = new Promise<void>((resolve) => {
			releaseLookup = resolve;
		});
		hub.commandHook = async (command) => {
			if (command === "session.list") await lookupPending;
		};
		hub.listedSessions = [{ sessionId: "inner-replacement", updatedAt: 30 }];
		await resolveHeaders?.();
		const send = manager.send("ses-outer", "during reconnect");
		// Let the send reach the connection while its root lookup is blocked.
		await new Promise((resolve) => setTimeout(resolve, 0));
		const createdDuringLookup = hub.commands.some(
			(entry) => entry.command === "session.create",
		);
		releaseLookup();
		await send;
		await manager.dispose();
		expect(createdDuringLookup).toBe(false);
		expect(hub.commands).toContainEqual(
			expect.objectContaining({
				command: "session.send_input",
				sessionId: "inner-replacement",
			}),
		);
	});

	it("keeps an org connection when reconnect cleanup cannot resolve its scope", async () => {
		const hub = new FakeHubClient();
		hub.commandHook = (command) => {
			if (command === "session.get") throw new Error("rehydration failed");
		};
		let organizationLookups = 0;
		const listScopes: Array<string | undefined> = [];
		const { manager, events } = createFixture({
			api: {
				list: async (organizationId?: string) => {
					listScopes.push(organizationId);
					return organizationId ? [REMOTE_SESSION] : [];
				},
			} as unknown as CloudSessionApi,
			getActiveOrganizationId: async () => {
				organizationLookups += 1;
				if (organizationLookups > 1) throw new Error("account endpoint down");
				return "org-cline-bot";
			},
			hub,
		});
		await manager.list();
		await manager.attach("ses-outer");

		await hub.resolveHeaders?.();
		await hub.resolveHeaders?.();
		await vi.waitFor(() => expect(organizationLookups).toBe(2));

		expect(hub.disposed).toBe(false);
		expect(listScopes).toEqual(["org-cline-bot"]);
		expect(
			events.some((event) => event.name === "cloud_session_sync_failed"),
		).toBe(true);
	});

	it("stops reconnecting when the sandbox is reconciled to failed", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		let reconciled = false;
		let resolveHeaders:
			| (() =>
					| Readonly<Record<string, string>>
					| Promise<Readonly<Record<string, string>>>)
			| undefined;
		hub.commandHook = (command) => {
			if (reconciled && command === "session.get") {
				throw new Error("rehydration failed");
			}
		};
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [
					{
						...REMOTE_SESSION,
						status: reconciled ? "failed" : "ready",
					},
				],
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: (options) => {
				resolveHeaders = options.resolveConnectionHeaders;
				return hub as never;
			},
		});
		await manager.list();
		await manager.attach("ses-outer");

		const live = ctx.liveSessions.get("ses-outer");
		expect(live).toBeDefined();
		if (!live) throw new Error("missing live cloud session");
		live.busy = true;
		live.status = "running";
		await resolveHeaders?.();
		reconciled = true;
		await resolveHeaders?.();

		await vi.waitFor(() => expect(hub.disposed).toBe(true));
		expect(live.busy).toBe(false);
		expect(live.status).toBe("failed");
		expect(live.endedAt).toBeDefined();
	});

	it("maps cloud approvals into the existing UI and responds on the inner id", async () => {
		const { manager, ctx, events, hub } = createFixture();
		await manager.list();
		await manager.attach("ses-outer");

		hub.events?.({
			version: "v1",
			event: "approval.requested",
			eventId: "evt-approval",
			timestamp: Date.now(),
			sessionId: "inner-1",
			payload: {
				approvalId: "approval-1",
				toolCallId: "tool-1",
				toolName: "run_commands",
				inputJson: '{"command":"git status"}',
			},
		});

		const pending = ctx.pendingApprovals.get("ses-outer:approval-1");
		expect(pending?.item).toMatchObject({
			requestId: "ses-outer:approval-1",
			sessionId: "ses-outer",
			toolCallId: "tool-1",
			toolName: "run_commands",
			input: { command: "git status" },
		});
		expect(events.at(-1)?.name).toBe("tool_approval_state");

		await pending?.resolve({ approved: true });
		expect(hub.commands.at(-1)).toMatchObject({
			command: "approval.respond",
			payload: { approvalId: "approval-1", approved: true },
			sessionId: "inner-1",
		});
	});

	it("restores pending cloud approvals when attaching after a missed event", async () => {
		const hub = new FakeHubClient();
		hub.pendingApprovals = [
			{
				approvalId: "approval-restored",
				toolCallId: "tool-restored",
				toolName: "write_to_file",
				inputJson: '{"path":"README.md"}',
			},
		];
		const { manager, ctx, events } = createFixture({ hub });
		await manager.list();

		await manager.attach("ses-outer");

		const pending = ctx.pendingApprovals.get("ses-outer:approval-restored");
		expect(pending?.item).toMatchObject({
			toolCallId: "tool-restored",
			toolName: "write_to_file",
			input: { path: "README.md" },
		});
		expect(events.at(-1)).toMatchObject({
			name: "tool_approval_state",
			payload: {
				sessionId: "ses-outer",
				items: [
					expect.objectContaining({ requestId: "ses-outer:approval-restored" }),
				],
			},
		});

		await pending?.resolve({ approved: false, reason: "not now" });
		expect(hub.commands.at(-1)).toMatchObject({
			command: "approval.respond",
			payload: {
				approvalId: "approval-restored",
				approved: false,
				reason: "not now",
			},
		});
	});

	it.each([
		false,
		true,
	])("rebuilds approvals from replay when resolved offline is %s", async (resolvedOffline) => {
		const hub = new FakeHubClient();
		hub.pendingApprovals = [
			{ approvalId: "approval-replay", toolName: "run_commands" },
		];
		const { manager, ctx, events } = createFixture({ hub });
		await manager.attach("ses-outer");
		expect(ctx.pendingApprovals.size).toBe(1);
		// The durable copy and pending replay share an event ID.
		hub.events?.({
			version: "v1",
			eventId: "evt-approval-replay",
			event: "approval.requested",
			timestamp: 1,
			sequence: 1,
			sessionId: "inner-1",
			payload: hub.pendingApprovals[0],
		});
		await hub.resolveHeaders?.();
		if (resolvedOffline) hub.pendingApprovals = [];
		await hub.resolveHeaders?.();
		await vi.waitFor(() =>
			expect(
				events.some(({ name }) => name === "cloud_session_rehydrated"),
			).toBe(true),
		);
		expect(ctx.pendingApprovals.size).toBe(resolvedOffline ? 0 : 1);
		expect(
			events.filter(({ name }) => name === "tool_approval_state").at(-1)
				?.payload.items,
		).toHaveLength(resolvedOffline ? 0 : 1);
		expect(
			hub.commands.some(({ command }) => command === "approval.list_pending"),
		).toBe(false);
		await manager.dispose();
	});

	it("does not restore pending approvals after the manager is disposed", async () => {
		const { manager, ctx, events, hub } = createFixture();
		await manager.list();

		await manager.attach("ses-outer");
		const deliverLateEvent = hub.events;
		await manager.dispose();
		deliverLateEvent?.({
			version: "v1",
			eventId: "evt-late-approval",
			event: "approval.requested",
			timestamp: 1,
			sessionId: "inner-1",
			payload: {
				approvalId: "approval-old-account",
				toolName: "write_to_file",
			},
		});

		expect(ctx.pendingApprovals.size).toBe(0);
		expect(
			events.some((event) =>
				JSON.stringify(event.payload).includes("approval-old-account"),
			),
		).toBe(false);
	});

	it("creates and sends to an inner session while preserving the outer id", async () => {
		const { manager, hub } = createFixture({
			hub: new FakeHubClient(false),
			api: {
				list: async () => [
					{
						...REMOTE_SESSION,
						metadata: { ...REMOTE_SESSION.metadata, taskId: "task-created" },
					},
				],
				create: async () => ({
					sessionId: "ses-outer",
					status: "provisioning",
					sandboxUrl: "",
				}),
				waitUntilReady: async () => {},
			} as unknown as CloudSessionApi,
		});

		const created = await manager.create({
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
			initialPrompt: "Fix it",
			thinking: true,
			reasoningEffort: "high",
		});
		const attached = await manager.attach("ses-outer");
		const sent = await manager.send("ses-outer", "Fix it");

		expect(created.sessionId).toBe("ses-outer");
		expect(created.prompt).toBe("Fix it");
		expect(attached.prompt).toBe("Fix it");
		expect(hub.commands).toContainEqual(
			expect.objectContaining({
				command: "session.create",
				payload: expect.objectContaining({
					workspaceRoot: "/workspace",
					sessionConfig: expect.objectContaining({
						sessionId: "task-created",
						thinking: true,
						reasoningEffort: "high",
					}),
					modelSelection: {
						provider: "cline",
						model: "anthropic/claude-sonnet-5",
					},
				}),
			}),
		);
		expect(hub.commands.at(-1)).toMatchObject({
			command: "session.send_input",
			payload: { prompt: "Fix it", delivery: undefined },
			sessionId: "inner-created",
			options: { timeoutMs: null },
		});
		expect(sent.sessionId).toBe("ses-outer");
		expect(hub.commands.at(-2)).toMatchObject({
			command: "session.attach",
			sessionId: "inner-created",
		});
	});

	it("preserves the live Hub model across REST discovery refreshes", async () => {
		const hub = new FakeHubClient();
		hub.listedModel = "anthropic/claude-opus-4-1";
		const { manager } = createFixture({
			hub,
			api: {
				list: async () => [
					{
						...REMOTE_SESSION,
						metadata: {
							...REMOTE_SESSION.metadata,
							modelId: "anthropic/claude-sonnet-5",
						},
					},
				],
			} as CloudSessionApi,
		});
		await manager.list();
		const attached = await manager.attach("ses-outer");

		expect(attached.model).toBe("anthropic/claude-opus-4-1");
		await expect(manager.listForDiscovery()).resolves.toEqual([
			expect.objectContaining({ model: "anthropic/claude-opus-4-1" }),
		]);
		await manager.send(
			"ses-outer",
			"Continue with the live model",
			undefined,
			"anthropic/claude-opus-4-1",
		);

		expect(
			hub.commands.filter(
				(command) => command.command === "session.update_connection",
			),
		).toHaveLength(0);
	});

	it("reconciles another client's model change before the next prompt", async () => {
		const hub = new FakeHubClient();
		const originalModel = REMOTE_SESSION.metadata.modelId ?? "";
		const externalModel = "anthropic/claude-opus-4-1";
		const { manager, ctx } = createFixture({ hub });
		await manager.list();
		await manager.attach("ses-outer");

		hub.events?.({
			version: "v1",
			event: "session.updated",
			eventId: "evt-model-change",
			timestamp: Date.now(),
			sessionId: "inner-1",
			payload: { session: { metadata: { model: externalModel } } },
		});
		expect(ctx.liveSessions.get("ses-outer")?.config.model).toBe(externalModel);

		await manager.send(
			"ses-outer",
			"Use the selected model",
			undefined,
			originalModel,
		);
		expect(
			hub.commands.filter(
				(command) => command.command === "session.update_connection",
			),
		).toEqual([
			expect.objectContaining({
				payload: {
					sessionId: "inner-1",
					updates: { modelId: originalModel },
				},
			}),
		]);
	});

	it("uses the attach reply as the final model authority before sending", async () => {
		const hub = new FakeHubClient();
		const selectedModel = REMOTE_SESSION.metadata.modelId ?? "";
		const externalModel = "anthropic/claude-opus-4-1";
		const { manager, ctx } = createFixture({ hub });
		await manager.list();
		await manager.attach("ses-outer");
		hub.attachedModel = externalModel;

		await manager.send("ses-outer", "Continue", undefined, selectedModel);

		expect(
			hub.commands.filter(
				(command) => command.command === "session.update_connection",
			),
		).toHaveLength(1);
		expect(ctx.liveSessions.get("ses-outer")?.config.model).toBe(selectedModel);
	});

	it("disposes the Hub connection before deleting the outer session", async () => {
		const hub = new FakeHubClient();
		let deleted = "";
		const { manager, ctx } = createFixture({
			hub,
			api: {
				list: async () => [REMOTE_SESSION],
				delete: async (sessionId: string) => {
					deleted = sessionId;
				},
			} as CloudSessionApi,
		});
		await manager.list();
		await manager.attach("ses-outer");

		await manager.delete("ses-outer");

		expect(hub.disposed).toBe(true);
		expect(deleted).toBe("ses-outer");
		expect(ctx.liveSessions.has("ses-outer")).toBe(false);
	});

	it("blocks a concurrent attach from re-dialing a session mid-delete", async () => {
		const hub = new FakeHubClient();
		const { promise: deleteBlocked, resolve: releaseDelete } =
			Promise.withResolvers<void>();
		const { manager, ctx } = createFixture({
			hub,
			api: {
				list: async () => [REMOTE_SESSION],
				delete: async () => {
					await deleteBlocked;
				},
			} as unknown as CloudSessionApi,
		});
		await manager.list();
		await manager.attach("ses-outer");

		const deleting = manager.delete("ses-outer");
		// Yield so delete() reaches the (blocked) REST call.
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Without the tombstone this would dial a fresh connection that
		// outlives the delete and reconnect-loops against a dead session.
		await expect(manager.attach("ses-outer")).rejects.toMatchObject({
			name: "CloudSessionError",
		});
		releaseDelete();
		await deleting;
		expect(hub.disposed).toBe(true);
		expect(ctx.liveSessions.has("ses-outer")).toBe(false);
	});

	it("still cleans up locally when the session is already gone remotely", async () => {
		const { manager, ctx, hub } = createFixture({
			api: {
				list: async () => [REMOTE_SESSION],
				delete: async () => {
					throw new CloudSessionError("session_not_found", "already gone");
				},
			} as unknown as CloudSessionApi,
		});
		await manager.list();
		await manager.attach("ses-outer");

		await expect(manager.delete("ses-outer")).resolves.toBeUndefined();
		expect(hub.disposed).toBe(true);
		expect(ctx.liveSessions.has("ses-outer")).toBe(false);
	});

	it("reaps the connection when the sidebar poll reports the session expired", async () => {
		const hub = new FakeHubClient();
		let expired = false;
		const { manager, ctx } = createFixture({
			hub,
			api: {
				list: async () =>
					expired
						? [
								{
									...REMOTE_SESSION,
									expiredAt: new Date(Date.now() - 60_000).toISOString(),
								},
							]
						: [REMOTE_SESSION],
				history: async () => [],
			} as unknown as CloudSessionApi,
		});
		await manager.list();
		await manager.attach("ses-outer");
		expect(hub.disposed).toBe(false);

		expired = true;
		const discovered = await manager.listForDiscovery();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(hub.disposed).toBe(true);
		expect(ctx.liveSessions.get("ses-outer")?.status).toBe("expired");
		expect(discovered).toContainEqual(
			expect.objectContaining({ sessionId: "ses-outer", status: "expired" }),
		);
	});

	it("drops authenticated cloud connections when account context changes", async () => {
		const { manager, ctx, hub } = createFixture();
		ctx.cloudSessionManager = manager;
		await manager.list();
		await manager.attach("ses-outer");

		await resetCloudSessionManager(ctx);

		expect(hub.disposed).toBe(true);
		expect(ctx.cloudSessionManager).toBeNull();
		expect(ctx.liveSessions.has("ses-outer")).toBe(false);
	});

	it("propagates the live error when hydration fails and no snapshot exists", async () => {
		const { manager, ctx } = createFixture({
			api: {
				list: async () => [REMOTE_SESSION],
				history: async () => null,
			} as unknown as CloudSessionApi,
			createHubClient: () => {
				throw new Error("sandbox unreachable");
			},
		});
		ctx.cloudSessionManager = manager;

		await expect(manager.readMessages(REMOTE_SESSION.id)).rejects.toThrow(
			"sandbox unreachable",
		);
		expect(ctx.liveSessions.get(REMOTE_SESSION.id)?.messages ?? []).toEqual([]);
	});

	it("serves archived history for expired sessions without dialing the sandbox", async () => {
		const expired: CloudSessionRecord = {
			...REMOTE_SESSION,
			expiredAt: "2026-08-04T00:00:00.000Z",
		};
		let historyCalls = 0;
		const { manager, ctx } = createFixture({
			api: {
				list: async () => [expired],
				create: async () => {
					throw new Error("must not create");
				},
				history: async () => {
					historyCalls += 1;
					return [{ role: "user", content: "archived" }];
				},
			} as unknown as CloudSessionApi,
			createHubClient: () => {
				throw new Error("expired sessions must not open a websocket");
			},
		});
		ctx.cloudSessionManager = manager;

		const attached = await manager.attach(expired.id);
		expect(attached).toMatchObject({
			sessionId: expired.id,
			status: "expired",
		});
		expect(historyCalls).toBe(1);

		const messages = await manager.readMessages(expired.id);
		expect(messages).toEqual([{ role: "user", content: "archived" }]);
		expect(ctx.liveSessions.get(expired.id)?.messages).toEqual(messages);

		await expect(manager.send(expired.id, "hello")).rejects.toMatchObject({
			code: "session_expired",
		});
	});

	it("falls back to archived history when live hydration fails", async () => {
		const { manager, ctx } = createFixture({
			api: {
				list: async () => [REMOTE_SESSION],
				create: async () => {
					throw new Error("must not create");
				},
				history: async () => [{ role: "assistant", content: "snapshot" }],
			} as unknown as CloudSessionApi,
			createHubClient: () => {
				throw new Error("sandbox unreachable");
			},
		});
		ctx.cloudSessionManager = manager;

		const messages = await manager.readMessages(REMOTE_SESSION.id);
		expect(messages).toEqual([{ role: "assistant", content: "snapshot" }]);
	});

	it("keeps server provisioning rows visible and reconciles their status", async () => {
		let status = "provisioning";
		const { manager } = createFixture({
			api: {
				list: async () => [{ ...REMOTE_SESSION, status: "provisioning" }],
				status: async () => ({ sessionId: REMOTE_SESSION.id, status }),
			} as unknown as CloudSessionApi,
			createHubClient: () => {
				throw new Error("must not connect while provisioning");
			},
		});

		await expect(manager.listForDiscovery()).resolves.toEqual([
			expect.objectContaining({
				sessionId: REMOTE_SESSION.id,
				status: "provisioning",
			}),
		]);
		await expect(manager.attach(REMOTE_SESSION.id)).resolves.toMatchObject({
			sessionId: REMOTE_SESSION.id,
			status: "provisioning",
		});
		await expect(manager.readMessages(REMOTE_SESSION.id)).resolves.toEqual([]);

		status = "ready";
		await expect(manager.listForDiscovery()).resolves.toEqual([
			expect.objectContaining({
				sessionId: REMOTE_SESSION.id,
				status: "ready",
			}),
		]);
	});

	it("deletes a late sandbox with the account that created it", async () => {
		let authToken = "workos:original";
		const { promise: createReply, resolve: finishCreate } =
			Promise.withResolvers<Response>();
		const deleteAuthorizations: string[] = [];
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => authToken,
			fetch: async (_input, init) => {
				if (init?.method === "POST") {
					return await createReply;
				}
				deleteAuthorizations.push(
					new Headers(init?.headers).get("Authorization") ?? "",
				);
				return new Response(null, { status: 204 });
			},
		});
		const { manager, ctx } = createFixture({
			api,
			getAuthToken: async () => authToken,
		});
		const creating = manager.create({
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		authToken = "workos:new-account";
		await manager.dispose();

		finishCreate(
			jsonResponse(
				{
					success: true,
					data: { sessionId: "ses-created-late", sandboxUrl: "pod" },
				},
				201,
			),
		);

		await expect(creating).rejects.toThrow(/account changed/i);
		expect(deleteAuthorizations).toEqual(["Bearer workos:original"]);
		expect(ctx.liveSessions.has("ses-created-late")).toBe(false);
	});

	it("keeps refresh-after-connect-failure in the active organization", async () => {
		const listCalls: Array<string | undefined> = [];
		const orgSession = { ...REMOTE_SESSION, id: "ses-org" };
		const hub = new FakeHubClient();
		vi.spyOn(hub, "connect").mockRejectedValue(new Error("pod offline"));
		const { manager, ctx } = createFixture({
			hub,
			api: {
				list: async (organizationId?: string) => {
					listCalls.push(organizationId);
					return organizationId === "org-cline-bot" ? [orgSession] : [];
				},
			} as unknown as CloudSessionApi,
			getActiveOrganizationId: async () => "org-cline-bot",
		});
		ctx.cloudSessionManager = manager;

		await manager.list();
		await expect(manager.attach("ses-org")).rejects.toThrow("pod offline");

		expect(listCalls).toEqual(["org-cline-bot", "org-cline-bot"]);
	});

	it("recovers with a fresh connection after inner-session creation fails", async () => {
		let clientCount = 0;
		let failNextInnerCreate = true;
		const clients: FakeHubClient[] = [];
		const { manager, ctx } = createFixture({
			api: {
				list: async () => [{ ...REMOTE_SESSION, title: undefined }],
			} as unknown as CloudSessionApi,
			createHubClient: () => {
				clientCount += 1;
				const hub = new FakeHubClient(false);
				hub.commandHook = (command) => {
					if (command === "session.create" && failNextInnerCreate) {
						failNextInnerCreate = false;
						throw new Error("insufficient balance");
					}
				};
				clients.push(hub);
				return hub as never;
			},
		});
		ctx.cloudSessionManager = manager;
		await manager.list();

		await expect(manager.send("ses-outer", "first")).rejects.toThrow(
			"insufficient balance",
		);
		await manager.send("ses-outer", "second");
		expect(clientCount).toBe(2);
		expect(clients[1]?.events).toBeDefined();
		expect(
			clients[1]?.commands.some((entry) => entry.command === "session.create"),
		).toBe(true);
	});

	it("single-flights inner-session creation under concurrent sends", async () => {
		const { manager, ctx, hub } = createFixture({
			hub: new FakeHubClient(false),
			api: {
				list: async () => [{ ...REMOTE_SESSION, title: undefined }],
			} as unknown as CloudSessionApi,
		});
		ctx.cloudSessionManager = manager;
		await manager.list();

		await Promise.all([
			manager.send("ses-outer", "first"),
			manager.send("ses-outer", "second"),
		]);
		const innerCreates = hub.commands.filter(
			(entry) => entry.command === "session.create",
		);
		expect(innerCreates).toHaveLength(1);
	});

	it("re-scopes the visible list on org change but keeps open sessions routable", async () => {
		const hub = new FakeHubClient();
		let scope: string | undefined = "org-a";
		const orgSession = { ...REMOTE_SESSION, id: "ses-org-a", title: undefined };
		const personalSession = {
			...REMOTE_SESSION,
			id: "ses-personal",
			title: undefined,
		};
		const { manager, ctx } = createFixture({
			hub,
			api: {
				list: async (organizationId?: string) =>
					organizationId ? [orgSession] : [personalSession],
			} as unknown as CloudSessionApi,
			getActiveOrganizationId: async () => scope,
		});
		ctx.cloudSessionManager = manager;

		await manager.list();
		await manager.attach("ses-org-a");

		scope = undefined;
		const visible = (await manager.listForDiscovery()).map(
			(session) => session.sessionId,
		);
		expect(visible).toEqual(["ses-personal"]);

		await expect(manager.send("ses-org-a", "hello")).resolves.toMatchObject({
			ok: true,
		});
	});
});
