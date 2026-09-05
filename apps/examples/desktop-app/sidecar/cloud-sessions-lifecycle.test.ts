import { HubTransportError } from "@cline/core";
import type { HubEventEnvelope } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	CloudSessionApi,
	CloudSessionError,
	CloudSessionManager,
	type CloudSessionRecord,
	cloudSessionToDiscoveryRecord,
	reconcileBufferedCloudEvents,
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
		hubBuildMismatch: null,
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

describe("reconcileBufferedCloudEvents", () => {
	const event = (
		name: HubEventEnvelope["event"],
		id: string,
		payload: Record<string, unknown> = {},
	): HubEventEnvelope => ({
		version: "v1",
		event: name,
		eventId: id,
		timestamp: Date.now(),
		sessionId: "inner-1",
		payload,
	});

	it("replays content the snapshot does NOT contain", () => {
		// The safety-critical direction: an unreflected buffered turn must
		// never be dropped, or a whole reply silently vanishes.
		const buffered = [
			event("assistant.delta", "a-1", { text: "unpersisted reply" }),
			event("run.completed", "done-1"),
		];
		expect(
			reconcileBufferedCloudEvents(buffered, [
				{ role: "assistant", content: "a completely different answer" },
			]).map((item) => item.event),
		).toEqual(["assistant.delta", "run.completed"]);
	});

	it("supersedes despite trailing whitespace in the streamed text", () => {
		const buffered = [
			event("assistant.finished", "f-1", { text: "the answer \n" }),
			event("run.completed", "done-1"),
		];
		expect(
			reconcileBufferedCloudEvents(buffered, [
				{ role: "assistant", content: "prefix the answer" },
			]).map((item) => item.event),
		).toEqual(["run.completed"]);
	});

	it("drops buffered queue snapshots when a fresh queue snapshot was applied", () => {
		const buffered = [
			event("session.pending_prompts", "q-1", { prompts: [] }),
			event("assistant.delta", "a-1", { text: "live tail" }),
		];
		expect(
			reconcileBufferedCloudEvents(buffered, []).map((item) => item.event),
		).toEqual(["assistant.delta"]);
	});

	it("replays the newest buffered queue snapshot when the queue fetch failed", () => {
		// Dropping the buffer here would silently lose queued/steered prompts
		// until some later change produces another queue snapshot.
		const buffered = [
			event("session.pending_prompts", "q-1", { prompts: [] }),
			event("session.pending_prompts", "q-2", {
				prompts: [{ id: "p-1", prompt: "queued work" }],
			}),
			event("assistant.delta", "a-1", { text: "live tail" }),
		];
		expect(
			reconcileBufferedCloudEvents(buffered, [], {
				queueSnapshotApplied: false,
			}).map((item) => item.eventId),
		).toEqual(["q-2", "a-1"]);
	});

	it("replays a queue snapshot received after the queue fetch", () => {
		const buffered = [
			event("session.pending_prompts", "q-old", { prompts: [] }),
			event("assistant.delta", "a-1", { text: "live tail" }),
			event("session.pending_prompts", "q-new", {
				prompts: [{ id: "p-1", prompt: "queued work" }],
			}),
		];
		expect(
			reconcileBufferedCloudEvents(buffered, [], {
				queueSnapshotEventCutoff: 1,
			}).map((item) => item.eventId),
		).toEqual(["a-1", "q-new"]);
	});

	it("supersedes content independently across two terminal run segments", () => {
		const buffered = [
			event("assistant.delta", "a-1", { text: "first tail" }),
			event("run.completed", "done-1"),
			event("assistant.delta", "a-2", { text: "second tail" }),
			event("run.completed", "done-2"),
		];

		expect(
			reconcileBufferedCloudEvents(buffered, [
				{ role: "assistant", content: "prefix first tail" },
				{ role: "assistant", content: "prefix second tail" },
			]).map((item) => item.event),
		).toEqual(["run.completed", "run.completed"]);
	});

	it("does not let an older identical reply supersede a new buffered turn", () => {
		const buffered = [
			event("assistant.delta", "a-2", { text: "Done" }),
			event("run.completed", "done-2"),
		];
		const baseline = [{ role: "assistant", content: "Done" }];

		expect(
			reconcileBufferedCloudEvents(buffered, baseline, {
				baselineMessages: baseline,
			}).map((item) => item.event),
		).toEqual(["assistant.delta", "run.completed"]);
		expect(
			reconcileBufferedCloudEvents(
				buffered,
				[...baseline, { role: "assistant", content: "Done" }],
				{ baselineMessages: baseline },
			).map((item) => item.event),
		).toEqual(["run.completed"]);
	});

	it("keeps run.failed while suppressing reflected content and dedupes tools by id", () => {
		const buffered = [
			event("assistant.delta", "a-1", { text: "partial failure" }),
			event("tool.started", "tool-1", { toolCallId: "call-1" }),
			event("run.failed", "failed-1", { error: "boom" }),
		];

		expect(
			reconcileBufferedCloudEvents(buffered, [
				{ role: "assistant", content: "saved partial failure" },
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "call-1", name: "read_file" }],
				},
			]).map((item) => item.event),
		).toEqual(["run.failed"]);
	});
});

describe("CloudSessionManager lifecycle", () => {
	it("does not retry an arbitrary 502 that could have provisioned", async () => {
		const { ctx } = createContext();
		const create = vi.fn(async () => {
			throw new CloudSessionError(
				"request_failed",
				"upstream request failed",
				undefined,
				502,
			);
		});
		const sleep = vi.fn(async () => undefined);
		const manager = new CloudSessionManager(ctx, {
			api: { create } as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			sleep,
		});

		await expect(
			manager.create({
				modelId: "model",
				repoUrl: "https://github.com/cline/test",
			}),
		).rejects.toThrow("upstream request failed");
		expect(create).toHaveBeenCalledOnce();
		expect(sleep).not.toHaveBeenCalled();
	});

	it("projects the outer remote-session id as the desktop session id", () => {
		expect(
			cloudSessionToDiscoveryRecord({
				...REMOTE_SESSION,
				repoContext: {
					...REMOTE_SESSION.repoContext,
					branch: "feature/cloud",
				},
			}),
		).toMatchObject({
			sessionId: "ses-outer",
			origin: "cloud",
			executionTarget: "cloud",
			repoUrl: "https://github.com/cline/test",
			workspaceRoot: "/workspace",
			branch: "feature/cloud",
			metadata: {
				git: {
					url: "https://github.com/cline/test",
					branch: "feature/cloud",
				},
			},
		});
	});

	it("treats a live session's future expiredAt as a TTL, not an end time", () => {
		// A future endedAt renders as "now" for every session in the sidebar.
		const alive = cloudSessionToDiscoveryRecord({
			...REMOTE_SESSION,
			expiredAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
		});
		expect(alive.endedAt).toBeUndefined();

		const expired = cloudSessionToDiscoveryRecord({
			...REMOTE_SESSION,
			expiredAt: "2026-08-01T00:00:00.000Z",
		});
		expect(expired.endedAt).toBe("2026-08-01T00:00:00.000Z");
	});

	it("overlays live status and prompt-derived title on refreshed REST rows", async () => {
		const { ctx } = createContext();
		ctx.liveSessions.set("ses-outer", {
			config: { executionTarget: "cloud" },
			messages: [],
			promptsInQueue: [],
			busy: true,
			startedAt: Date.now(),
			status: "running",
			prompt: "Fix reconnect behavior\nwith a regression test",
			attachedViaHub: true,
		});
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
		});

		const [session] = await manager.listForDiscovery();

		expect(session).toMatchObject({
			sessionId: "ses-outer",
			origin: "cloud",
			status: "running",
			prompt: "Fix reconnect behavior\nwith a regression test",
			repoUrl: "https://github.com/cline/test",
			metadata: {
				title: "Fix reconnect behavior",
				origin: "cloud",
			},
		});
	});

	it("single-flights repeated starts for the same client request", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient(false);
		let createCalls = 0;
		let finishCreate:
			| ((value: { sessionId: string; sandboxUrl: string }) => void)
			| undefined;
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [],
				create: () => {
					createCalls += 1;
					return new Promise((resolve) => {
						finishCreate = resolve;
					});
				},
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		const input = {
			requestId: "client-start-1",
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
		};

		const first = manager.create(input);
		const second = manager.create(input);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(createCalls).toBe(1);
		expect(
			(await manager.listForDiscovery()).filter(
				(session) => session.status === "provisioning",
			),
		).toHaveLength(1);

		finishCreate?.({ sessionId: "ses-created", sandboxUrl: "pod" });
		await expect(Promise.all([first, second])).resolves.toEqual([
			expect.objectContaining({ sessionId: "ses-created" }),
			expect.objectContaining({ sessionId: "ses-created" }),
		]);
	});

	it("keeps identical starts from separate chats independent", async () => {
		const { ctx } = createContext();
		let createCalls = 0;
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [],
				create: async () => {
					createCalls += 1;
					return {
						sessionId: `ses-created-${createCalls}`,
						sandboxUrl: "pod",
					};
				},
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => new FakeHubClient(false) as never,
		});
		const input = {
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
		};

		const [first, second] = await Promise.all([
			manager.create({ ...input, requestId: "chat-a" }),
			manager.create({ ...input, requestId: "chat-b" }),
		]);

		expect(createCalls).toBe(2);
		expect(first.sessionId).not.toBe(second.sessionId);
	});

	it("returns cached cloud discovery promptly while a refresh is slow", async () => {
		const { ctx } = createContext();
		let listCalls = 0;
		let finishRefresh: ((value: CloudSessionRecord[]) => void) | undefined;
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => {
					listCalls += 1;
					if (listCalls === 1) return [REMOTE_SESSION];
					return await new Promise((resolve) => {
						finishRefresh = resolve;
					});
				},
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
		});
		await manager.listForDiscovery();

		const cached = await manager.listForDiscovery({ timeoutMs: 1 });

		expect(cached).toEqual([
			expect.objectContaining({ sessionId: "ses-outer", origin: "cloud" }),
		]);
		finishRefresh?.([]);
		await new Promise((resolve) => setTimeout(resolve, 0));
	});

	it("uses only the active organization for billing and session listing", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient(false);
		const listCalls: Array<string | undefined> = [];
		const repositoryScopes: Array<string | undefined> = [];
		const branchScopes: Array<string | undefined> = [];
		let createInput: Record<string, unknown> | undefined;
		const orgSession = { ...REMOTE_SESSION, id: "ses-org", title: undefined };
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async (organizationId?: string) => {
					listCalls.push(organizationId);
					return organizationId
						? [orgSession]
						: [{ ...REMOTE_SESSION, title: undefined }];
				},
				create: async (input: Record<string, unknown>) => {
					createInput = input;
					return { sessionId: "ses-created", sandboxUrl: "pod" };
				},
				listRepositories: async (organizationId?: string) => {
					repositoryScopes.push(organizationId);
					return { connected: true, connectUrl: "", repositories: [] };
				},
				listBranches: async (
					_repositoryId: number,
					organizationId?: string,
				) => {
					branchScopes.push(organizationId);
					return { available: true, branches: [] };
				},
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			getActiveOrganizationId: async () => "org-cline-bot",
			createHubClient: () => hub as never,
		});
		const scoped = await manager.list();
		expect(listCalls).toEqual(["org-cline-bot"]);
		expect(scoped.map((session) => session.id)).toEqual(["ses-org"]);
		await manager.listRepositories();
		await manager.listBranches(42);
		expect(repositoryScopes).toEqual(["org-cline-bot"]);
		expect(branchScopes).toEqual(["org-cline-bot"]);

		await manager.create({
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
		});
		expect(createInput).toMatchObject({ organizationId: "org-cline-bot" });
	});

	it("refreshes the active organization before creating a session", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient(false);
		let serverScope = "org-a";
		let cachedScope = serverScope;
		const lookupOptions: Array<{ fresh?: boolean } | undefined> = [];
		let createInput: Record<string, unknown> | undefined;
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [],
				create: async (input: Record<string, unknown>) => {
					createInput = input;
					return { sessionId: "ses-created", sandboxUrl: "pod" };
				},
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			getActiveOrganizationId: async (options) => {
				lookupOptions.push(options);
				if (options?.fresh) cachedScope = serverScope;
				return cachedScope;
			},
			createHubClient: () => hub as never,
		});

		await manager.list();
		serverScope = "org-b";
		await manager.create({
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
		});

		expect(lookupOptions).toEqual([undefined, { fresh: true }]);
		expect(createInput).toMatchObject({ organizationId: "org-b" });
	});

	it("does not silently bill personal credits when account scope lookup fails", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient(false);
		let createInput: Record<string, unknown> | undefined;
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [],
				create: async (input: Record<string, unknown>) => {
					createInput = input;
					return { sessionId: "ses-created", sandboxUrl: "pod" };
				},
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			getActiveOrganizationId: async () => {
				throw new Error("account endpoint down");
			},
			createHubClient: () => hub as never,
		});
		await expect(
			manager.create({
				modelId: "anthropic/claude-sonnet-5",
				repoUrl: "https://github.com/cline/test",
			}),
		).rejects.toThrow("account endpoint down");
		expect(createInput?.organizationId).toBeUndefined();
	});
});
