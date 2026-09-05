import { HubTransportError } from "@cline/core";
import type { HubEventEnvelope } from "@cline/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handleChatSessionCommand } from "./chat-session";
import {
	CloudSessionApi,
	CloudSessionError,
	CloudSessionManager,
	type CloudSessionRecord,
	cloudSessionToDiscoveryRecord,
	reconcileBufferedCloudEvents,
	resetCloudSessionManager,
} from "./cloud-sessions";
import { handleCommand } from "./commands";
import { disposeSidecarContext } from "./context";
import { discoverChatSessions } from "./session-data/discovery";
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

function jwtFor(subject: string, nonce: string): string {
	const encode = (value: unknown) =>
		Buffer.from(JSON.stringify(value)).toString("base64url");
	return `workos:${encode({ alg: "none" })}.${encode({ sub: subject, nonce })}.sig`;
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
	failNextSend = false;
	onFailedSend?: () => void;
	commandHook?: (command: string) => void | Promise<void>;
	invalidMessagesSnapshot = false;
	malformedQueueReply = false;
	listedSessions?: Array<Record<string, unknown>>;
	listedModel?: string;
	attachedModel?: string;
	subscriptionSessionId?: string;
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
		this.subscriptionSessionId = options?.sessionId;
		this.subscriptionSessionIds.push(options?.sessionId);
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
		if (command === "session.send_input" && this.failNextSend) {
			this.failNextSend = false;
			this.onFailedSend?.();
			throw new HubTransportError("hub_connection_closed", "socket closed");
		}
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
		if (command === "approval.list_pending") {
			return {
				ok: true,
				payload: { approvals: this.pendingApprovals },
			};
		}
		if (command === "session.pending_prompts" && this.malformedQueueReply) {
			return { ok: true, payload: {} };
		}
		if (
			command === "session.pending_prompts" ||
			command === "session.update_pending_prompt" ||
			command === "session.remove_pending_prompt"
		) {
			return {
				ok: true,
				payload: {
					updated: command === "session.update_pending_prompt",
					removed: command === "session.remove_pending_prompt",
					prompts: this.prompts.map((item) => ({
						...item,
						delivery:
							command === "session.update_pending_prompt"
								? (payload?.delivery ?? "queue")
								: item.delivery,
					})),
				},
			};
		}
		if (command === "session.messages") {
			return {
				ok: true,
				payload: this.invalidMessagesSnapshot
					? { messages: "invalid" }
					: { messages: this.messages },
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

describe("CloudSessionManager Hub runtime", () => {
	it("reuses the newest inner Hub session and translates events to the outer id", async () => {
		const { ctx, events } = createContext();
		const hub = new FakeHubClient();
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});

		await manager.list();
		await manager.attach("ses-outer");
		hub.events?.({
			version: "v1",
			event: "session.updated",
			eventId: "evt-1",
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

	it("ignores newer child sessions when reconnecting to the cloud root", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		hub.listedSessions = [
			{ sessionId: "inner-root", updatedAt: 20 },
			{
				sessionId: "inner-child",
				updatedAt: 30,
				metadata: { parentSessionId: "inner-root" },
			},
		];
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});

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
			const { ctx } = createContext();
			const manager = new CloudSessionManager(ctx, {
				api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
				apiBaseUrl: "https://api.example",
				getAuthToken: async () => "workos:fresh",
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
		expect(hubs.map((hub) => hub.subscriptionSessionId)).toEqual([
			"inner-1",
			"inner-1",
		]);
		expect(hubs.map((hub) => hub.subscriptionSessionIds)).toEqual([
			["inner-1"],
			["inner-1"],
		]);
	});

	it("drops replayed Hub events by eventId", async () => {
		const { ctx, events } = createContext();
		const hub = new FakeHubClient();
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
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
		const { ctx, events } = createContext();
		const hub = new FakeHubClient();
		const tokens = ["workos:first", "workos:refreshed"];
		let resolveHeaders:
			| (() =>
					| Readonly<Record<string, string>>
					| Promise<Readonly<Record<string, string>>>)
			| undefined;
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => tokens.shift(),
			createHubClient: (options) => {
				resolveHeaders = options.resolveConnectionHeaders;
				return hub as never;
			},
		});
		await manager.list();
		await manager.attach("ses-outer");

		expect(await resolveHeaders?.()).toEqual({
			Authorization: "Bearer workos:first",
		});
		expect(await resolveHeaders?.()).toEqual({
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

	it("refreshes the completion time for a later turn completed while disconnected", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.list();
		await manager.attach("ses-outer");

		const live = ctx.liveSessions.get("ses-outer");
		expect(live).toBeDefined();
		if (!live) throw new Error("missing live cloud session");
		live.status = "running";
		live.endedAt = 1;
		hub.sessionStatus = "completed";

		await manager.readMessages("ses-outer");

		expect(live.endedAt).toBeGreaterThan(1);
	});

	it("keeps an org connection when reconnect cleanup cannot resolve its scope", async () => {
		const { ctx, events } = createContext();
		const hub = new FakeHubClient();
		hub.commandHook = (command) => {
			if (command === "session.get") throw new Error("rehydration failed");
		};
		let resolveHeaders:
			| (() =>
					| Readonly<Record<string, string>>
					| Promise<Readonly<Record<string, string>>>)
			| undefined;
		let organizationLookups = 0;
		const listScopes: Array<string | undefined> = [];
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async (organizationId?: string) => {
					listScopes.push(organizationId);
					return organizationId ? [REMOTE_SESSION] : [];
				},
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			getActiveOrganizationId: async () => {
				organizationLookups += 1;
				if (organizationLookups > 1) throw new Error("account endpoint down");
				return "org-cline-bot";
			},
			createHubClient: (options) => {
				resolveHeaders = options.resolveConnectionHeaders;
				return hub as never;
			},
		});
		await manager.list();
		await manager.attach("ses-outer");

		await resolveHeaders?.();
		await resolveHeaders?.();
		await vi.waitFor(() => expect(organizationLookups).toBe(2));

		expect(hub.disposed).toBe(false);
		expect(listScopes).toEqual(["org-cline-bot"]);
		expect(
			events.some((event) => event.name === "cloud_session_sync_failed"),
		).toBe(true);
	});

	it("rejects malformed queue command replies instead of clearing the queue", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.list();
		await manager.attach("ses-outer");
		// Seed the queue from a valid snapshot first.
		hub.prompts[0].userImages = ["data:image/png;base64,AQID"];
		await manager.pendingPrompts("ses-outer");
		expect(ctx.liveSessions.get("ses-outer")?.promptsInQueue).toMatchObject([
			{ id: "q-1", userImages: ["data:image/png;base64,AQID"] },
		]);

		hub.malformedQueueReply = true;

		// A prompts-less reply must surface as an error, not become an
		// authoritative empty queue that hides queued prompts.
		await expect(manager.pendingPrompts("ses-outer")).rejects.toThrow(
			"invalid pending-prompts snapshot",
		);
		expect(ctx.liveSessions.get("ses-outer")?.promptsInQueue).toMatchObject([
			{ id: "q-1" },
		]);
	});

	it("queues one rerun when a second sync overlaps the active snapshot", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		let releaseFirst!: () => void;
		const firstBlocked = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		let reachedFirst!: () => void;
		const firstReached = new Promise<void>((resolve) => {
			reachedFirst = resolve;
		});
		let messageReads = 0;
		hub.commandHook = async (command) => {
			if (command !== "session.messages") return;
			messageReads += 1;
			if (messageReads === 1) {
				reachedFirst();
				await firstBlocked;
			}
		};
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.list();
		await manager.attach("ses-outer");

		const first = manager.readMessages("ses-outer");
		await firstReached;
		const second = manager.readMessages("ses-outer");
		releaseFirst();
		await Promise.all([first, second]);

		expect(messageReads).toBe(2);
	});

	it("retains the prior transcript and replays live events when a snapshot fails", async () => {
		const { ctx, events } = createContext();
		const hub = new FakeHubClient();
		hub.invalidMessagesSnapshot = true;
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.list();
		await manager.attach("ses-outer");
		const previous = [{ role: "assistant" as const, content: "keep me" }];
		const live = ctx.liveSessions.get("ses-outer");
		if (live) live.messages = previous;
		hub.commandHook = (command) => {
			if (command !== "session.messages") return;
			hub.events?.({
				version: "v1",
				event: "assistant.delta",
				eventId: "evt-during-failed-sync",
				timestamp: Date.now(),
				sessionId: "inner-1",
				payload: { text: "still live" },
			});
		};

		await expect(manager.readMessages("ses-outer")).rejects.toThrow(
			/invalid transcript snapshot/i,
		);
		expect(ctx.liveSessions.get("ses-outer")?.messages).toBe(previous);
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "chat_event",
					payload: expect.objectContaining({
						stream: "chat_text",
						chunk: "still live",
					}),
				}),
				expect.objectContaining({ name: "cloud_session_sync_failed" }),
			]),
		);
	});

	it("maps cloud approvals into the existing UI and responds on the inner id", async () => {
		const { ctx, events } = createContext();
		const hub = new FakeHubClient();
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
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
		const { ctx, events } = createContext();
		const hub = new FakeHubClient();
		hub.pendingApprovals = [
			{
				approvalId: "approval-restored",
				toolCallId: "tool-restored",
				toolName: "write_to_file",
				inputJson: '{"path":"README.md"}',
			},
		];
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
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

	it("does not restore pending approvals after the manager is disposed", async () => {
		const { ctx, events } = createContext();
		const hub = new FakeHubClient();
		hub.pendingApprovals = [
			{
				approvalId: "approval-old-account",
				toolCallId: "tool-old-account",
				toolName: "write_to_file",
				inputJson: '{"path":"secret.txt"}',
			},
		];
		let enterList!: () => void;
		let releaseList!: () => void;
		const listEntered = new Promise<void>((resolve) => {
			enterList = resolve;
		});
		const listReleased = new Promise<void>((resolve) => {
			releaseList = resolve;
		});
		hub.commandHook = async (command) => {
			if (command !== "approval.list_pending") return;
			enterList();
			await listReleased;
		};
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.list();

		const attaching = manager.attach("ses-outer");
		await listEntered;
		await manager.dispose();
		releaseList();
		await attaching;

		expect(ctx.pendingApprovals.size).toBe(0);
		expect(
			events.some((event) =>
				JSON.stringify(event.payload).includes("approval-old-account"),
			),
		).toBe(false);
	});

	it("creates and sends to an inner session while preserving the outer id", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient(false);
		const manager = new CloudSessionManager(ctx, {
			api: {
				create: async () => ({
					sessionId: "ses-outer",
					sandboxUrl: "",
				}),
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
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
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		hub.listedModel = "anthropic/claude-opus-4-1";
		const manager = new CloudSessionManager(ctx, {
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
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.list();
		await manager.attach("ses-outer");

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
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		const originalModel = REMOTE_SESSION.metadata.modelId ?? "";
		const externalModel = "anthropic/claude-opus-4-1";
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
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
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		const selectedModel = REMOTE_SESSION.metadata.modelId ?? "";
		const externalModel = "anthropic/claude-opus-4-1";
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
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

	it("restores the current model from the pod when reopening", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		hub.listedModel = "anthropic/claude-opus-4-1";
		const remote = {
			...REMOTE_SESSION,
			metadata: { ...REMOTE_SESSION.metadata },
		};
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [remote] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.list();

		const attached = await manager.attach("ses-outer");

		expect(attached.model).toBe("anthropic/claude-opus-4-1");
		expect(ctx.liveSessions.get("ses-outer")?.config.model).toBe(
			"anthropic/claude-opus-4-1",
		);
	});

	it("confirms recovery when the pod stored the prompt in its user_input wrapper", async () => {
		// Real pods persist prompts as <user_input mode="act">…</user_input>;
		// unwrapped fixtures previously let a broken matcher pass every test.
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.list();
		await manager.attach("ses-outer");
		hub.failNextSend = true;
		hub.onFailedSend = () => {
			hub.messages.push({
				role: "user",
				content: '<user_input mode="act">Do this once</user_input>',
			});
		};

		await expect(
			manager.send("ses-outer", "Do this once"),
		).resolves.toMatchObject({ ok: true, recoveredAfterDisconnect: true });
	});

	it("queues an implicit send when a cold session is already running", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		hub.sessionStatus = "running";
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.list();

		await expect(
			manager.send("ses-outer", "Run this next"),
		).resolves.toMatchObject({ ok: true, queued: true });
		expect(
			hub.commands.find((entry) => entry.command === "session.send_input"),
		).toMatchObject({
			payload: { prompt: "Run this next", delivery: "queue" },
		});
	});

	it("does not confirm a lost duplicate prompt against an earlier delivery", async () => {
		// Baseline must advance on delivered sends: without it, the first
		// delivery's occurrence falsely confirms a second, genuinely lost send.
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.list();
		await manager.attach("ses-outer");

		await manager.send("ses-outer", "yes");
		// The pod persisted the first send; the second is lost in transit.
		hub.messages.push({
			role: "user",
			content: '<user_input mode="act">yes</user_input>',
		});
		hub.failNextSend = true;
		hub.onFailedSend = () => {};

		await expect(manager.send("ses-outer", "yes")).rejects.toThrow(
			/please send it again/,
		);
	});

	it("includes an in-flight prompt in a concurrent send's recovery baseline", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.list();
		await manager.attach("ses-outer");
		await manager.readMessages("ses-outer");
		let releaseSend!: () => void;
		const blocked = new Promise<void>((resolve) => {
			releaseSend = resolve;
		});
		let reachedSend!: () => void;
		const reached = new Promise<void>((resolve) => {
			reachedSend = resolve;
		});
		let sendAttempts = 0;
		hub.commandHook = async (command) => {
			if (command !== "session.send_input") return;
			sendAttempts += 1;
			if (sendAttempts === 1) {
				reachedSend();
				await blocked;
			}
		};

		const sending = manager.send("ses-outer", "same prompt");
		await reached;

		hub.failNextSend = true;
		await expect(manager.send("ses-outer", "same prompt")).rejects.toThrow(
			/please send it again/,
		);
		releaseSend();
		await sending;
	});

	it("reattaches after a transport failure without retrying the prompt", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.list();
		await manager.attach("ses-outer");
		hub.failNextSend = true;
		hub.onFailedSend = () => {
			hub.messages.push({ role: "user", content: "Do this once" });
		};

		await expect(
			manager.send("ses-outer", "Do this once"),
		).resolves.toMatchObject({
			ok: true,
			recoveredAfterDisconnect: true,
			status: "running",
		});
		expect(
			hub.commands.filter((entry) => entry.command === "session.send_input"),
		).toHaveLength(1);
		expect(hub.commands.map((entry) => entry.command).slice(-5)).toEqual([
			"session.attach",
			"session.get",
			"session.messages",
			"session.pending_prompts",
			"approval.list_pending",
		]);
	});

	it("asks the user to resend when transport recovery cannot find the prompt", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.list();
		await manager.attach("ses-outer");
		hub.failNextSend = true;

		await expect(manager.send("ses-outer", "Lost prompt")).rejects.toThrow(
			/not found in the cloud session.*send it again/i,
		);
		expect(
			hub.commands.filter((entry) => entry.command === "session.send_input"),
		).toHaveLength(1);
	});

	it("confirms a steer accepted in buffered recovery events", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		hub.prompts = [];
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.list();
		await manager.attach("ses-outer");
		await manager.readMessages("ses-outer");
		hub.failNextSend = true;
		hub.commandHook = (command) => {
			if (command !== "session.messages") return;
			hub.events?.({
				version: "v1",
				event: "session.pending_prompt_submitted",
				eventId: "evt-steer-delivered",
				timestamp: Date.now(),
				sessionId: "inner-1",
				payload: {
					prompt: {
						id: "steer-1",
						prompt: "Steer accepted",
						delivery: "steer",
						attachmentCount: 0,
					},
				},
			});
		};

		await expect(
			manager.send("ses-outer", "Steer accepted", "steer"),
		).resolves.toMatchObject({ ok: true, recoveredAfterDisconnect: true });
		expect(
			hub.commands.filter((entry) => entry.command === "session.send_input"),
		).toHaveLength(1);
	});

	it("confirms a queued prompt from the recovered queue snapshot", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.list();
		await manager.attach("ses-outer");
		hub.failNextSend = true;
		hub.onFailedSend = () => {
			hub.prompts.push({
				id: "q-2",
				prompt: "Queued during disconnect",
				delivery: "queue",
				attachmentCount: 0,
			});
		};

		await expect(
			manager.send("ses-outer", "Queued during disconnect", "queue"),
		).resolves.toMatchObject({
			ok: true,
			queued: true,
			recoveredAfterDisconnect: true,
		});
	});

	it("disposes the Hub connection before deleting the outer session", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		let deleted = "";
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [REMOTE_SESSION],
				delete: async (sessionId: string) => {
					deleted = sessionId;
				},
			} as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.list();
		await manager.attach("ses-outer");

		await manager.delete("ses-outer");

		expect(hub.disposed).toBe(true);
		expect(deleted).toBe("ses-outer");
		expect(ctx.liveSessions.has("ses-outer")).toBe(false);
	});

	it("blocks a concurrent attach from re-dialing a session mid-delete", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		let releaseDelete!: () => void;
		const deleteBlocked = new Promise<void>((resolve) => {
			releaseDelete = resolve;
		});
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [REMOTE_SESSION],
				delete: async () => {
					await deleteBlocked;
				},
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
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
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [REMOTE_SESSION],
				delete: async () => {
					throw new CloudSessionError("session_not_found", "already gone");
				},
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.list();
		await manager.attach("ses-outer");

		await expect(manager.delete("ses-outer")).resolves.toBeUndefined();
		expect(hub.disposed).toBe(true);
		expect(ctx.liveSessions.has("ses-outer")).toBe(false);
	});

	it("reaps the connection when the sidebar poll reports the session expired", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		let expired = false;
		const manager = new CloudSessionManager(ctx, {
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
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.list();
		await manager.attach("ses-outer");
		expect(hub.disposed).toBe(false);

		// The session's TTL lapses while the app is open; the next sidebar
		// poll must stop the connection's reconnect loop.
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
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		ctx.cloudSessionManager = manager;
		await manager.list();
		await manager.attach("ses-outer");

		await resetCloudSessionManager(ctx);

		expect(hub.disposed).toBe(true);
		expect(ctx.cloudSessionManager).toBeNull();
		expect(ctx.liveSessions.has("ses-outer")).toBe(false);
	});

	it("propagates the live error when hydration fails and no snapshot exists", async () => {
		const { ctx } = createContext();
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [REMOTE_SESSION],
				history: async () => null,
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
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
		const { ctx } = createContext();
		const expired: CloudSessionRecord = {
			...REMOTE_SESSION,
			expiredAt: "2026-08-04T00:00:00.000Z",
		};
		let historyCalls = 0;
		const manager = new CloudSessionManager(ctx, {
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
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
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
		const { ctx } = createContext();
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [REMOTE_SESSION],
				create: async () => {
					throw new Error("must not create");
				},
				history: async () => [{ role: "assistant", content: "snapshot" }],
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => {
				throw new Error("sandbox unreachable");
			},
		});
		ctx.cloudSessionManager = manager;

		const messages = await manager.readMessages(REMOTE_SESSION.id);
		expect(messages).toEqual([{ role: "assistant", content: "snapshot" }]);
	});

	it("keeps server provisioning rows visible and reconciles their status", async () => {
		const { ctx } = createContext();
		let status = "provisioning";
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [{ ...REMOTE_SESSION, status: "provisioning" }],
				status: async () => ({ sessionId: REMOTE_SESSION.id, status }),
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
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
		const { ctx } = createContext();
		let authToken = "workos:original";
		let finishCreate: (() => void) | undefined;
		const deleteAuthorizations: string[] = [];
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => authToken,
			fetch: async (_input, init) => {
				if (init?.method === "POST") {
					return await new Promise<Response>((resolve) => {
						finishCreate = () =>
							resolve(
								jsonResponse(
									{
										success: true,
										data: {
											sessionId: "ses-created-late",
											sandboxUrl: "pod",
										},
									},
									201,
								),
							);
					});
				}
				deleteAuthorizations.push(
					new Headers(init?.headers).get("Authorization") ?? "",
				);
				return new Response(null, { status: 204 });
			},
		});
		const manager = new CloudSessionManager(ctx, {
			api,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => authToken,
		});
		const creating = manager.create({
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		authToken = "workos:new-account";
		await manager.dispose();

		finishCreate?.();

		await expect(creating).rejects.toThrow(/account changed/i);
		expect(deleteAuthorizations).toEqual(["Bearer workos:original"]);
		expect(ctx.liveSessions.has("ses-created-late")).toBe(false);
	});

	it("keeps refresh-after-connect-failure in the active organization", async () => {
		const { ctx } = createContext();
		const listCalls: Array<string | undefined> = [];
		const orgSession = { ...REMOTE_SESSION, id: "ses-org" };
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async (organizationId?: string) => {
					listCalls.push(organizationId);
					return organizationId === "org-cline-bot" ? [orgSession] : [];
				},
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			getActiveOrganizationId: async () => "org-cline-bot",
			createHubClient: () =>
				({
					command: async () => ({ ok: true as const }),
					connect: async () => {
						throw new Error("pod offline");
					},
					dispose: async () => undefined,
					getClientId: () => "code-cloud-ses-org",
					subscribe: () => () => undefined,
				}) as never,
		});
		ctx.cloudSessionManager = manager;

		await manager.list();
		await expect(manager.attach("ses-org")).rejects.toThrow("pod offline");

		expect(listCalls).toEqual(["org-cline-bot", "org-cline-bot"]);
	});

	it("recovers with a fresh connection after inner-session creation fails", async () => {
		const { ctx } = createContext();
		let clientCount = 0;
		let failNextInnerCreate = true;
		const clients: FakeHubClient[] = [];
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [{ ...REMOTE_SESSION, title: undefined }],
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => {
				clientCount += 1;
				const hub = new (class extends FakeHubClient {
					override async command(
						command: string,
						payload?: Record<string, unknown>,
						sessionId?: string,
						options?: { timeoutMs?: number | null },
					) {
						if (command === "session.create" && failNextInnerCreate) {
							failNextInnerCreate = false;
							throw new Error("insufficient balance");
						}
						return super.command(command, payload, sessionId, options);
					}
				})(false);
				clients.push(hub);
				return hub as never;
			},
		});
		ctx.cloudSessionManager = manager;
		await manager.list();

		// First send fails at inner-session creation…
		await expect(manager.send("ses-outer", "first")).rejects.toThrow(
			"insufficient balance",
		);
		// …and must NOT leave a poisoned connection behind: the retry gets a
		// fresh client with a live event subscription and succeeds.
		await manager.send("ses-outer", "second");
		expect(clientCount).toBe(2);
		expect(clients[1]?.events).toBeDefined();
		expect(
			clients[1]?.commands.some((entry) => entry.command === "session.create"),
		).toBe(true);
	});

	it("single-flights inner-session creation under concurrent sends", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient(false);
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [{ ...REMOTE_SESSION, title: undefined }],
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
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
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		let scope: string | undefined = "org-a";
		const orgSession = { ...REMOTE_SESSION, id: "ses-org-a", title: undefined };
		const personalSession = {
			...REMOTE_SESSION,
			id: "ses-personal",
			title: undefined,
		};
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async (organizationId?: string) =>
					organizationId ? [orgSession] : [personalSession],
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			getActiveOrganizationId: async () => scope,
			createHubClient: () => hub as never,
		});
		ctx.cloudSessionManager = manager;

		await manager.list();
		await manager.attach("ses-org-a");

		// The server-side active org changes (e.g. from the dashboard) and the
		// resolver picks it up: the sidebar re-scopes to personal…
		scope = undefined;
		const visible = (await manager.listForDiscovery()).map(
			(session) => session.sessionId,
		);
		expect(visible).toEqual(["ses-personal"]);

		// …but the org session that is already open must stay routable.
		await expect(manager.send("ses-org-a", "hello")).resolves.toMatchObject({
			ok: true,
		});
	});

	it("names the session from the first prompt and supports rename", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		const titleUpdates: Array<{ id: string; title: string }> = [];
		// Fresh record with no title: send() stamps titles onto the record
		// object, so the shared fixture may carry one from earlier tests.
		const record = { ...REMOTE_SESSION, title: undefined };
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [record],
				updateTitle: async (id: string, title: string) => {
					titleUpdates.push({ id, title });
					return { ...record, title };
				},
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		ctx.cloudSessionManager = manager;
		await manager.list();

		await manager.send(
			"ses-outer",
			"Fix the login bug\nwith more detail below",
		);
		expect(titleUpdates).toEqual([
			{ id: "ses-outer", title: "Fix the login bug" },
		]);
		expect(ctx.liveSessions.get("ses-outer")?.title).toBe("Fix the login bug");

		// Second send must not rename again.
		await manager.send("ses-outer", "another prompt");
		expect(titleUpdates).toHaveLength(1);

		// Explicit rename goes through REST and updates local state.
		await manager.updateTitle("ses-outer", "Renamed");
		expect(titleUpdates).toHaveLength(2);
		expect(ctx.liveSessions.get("ses-outer")?.title).toBe("Renamed");
	});
});
