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

	it("uses unique Hub client ids and subscribes only to the inner session", async () => {
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
			["inner-1"],
			["inner-1"],
		]);
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
		expect(await hub.resolveHeaders?.()).toEqual({
			Authorization: "Bearer workos:refreshed",
		});
		await vi.waitFor(() => {
			expect(
				hub.commands.some((entry) => entry.command === "session.get"),
			).toBe(true);
		});
		expect(
			events.some(
				(event) =>
					event.name === "cloud_session_rehydrated" &&
					event.payload.sessionId === "ses-outer",
			),
		).toBe(true);
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
});
