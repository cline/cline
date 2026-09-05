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

beforeAll(() => {
	process.env.CLINE_CODE_CLOUD_AGENTS = "1";
});
afterAll(() => {
	delete process.env.CLINE_CODE_CLOUD_AGENTS;
});

describe("Cloud sessions sidecar wiring", () => {
	it("blocks cloud session creation when the flag is off", async () => {
		process.env.CLINE_CODE_CLOUD_AGENTS = "0";
		try {
			const { ctx } = createContext();
			const manager = new CloudSessionManager(ctx, {
				api: {
					list: async () => [],
					create: async () => {
						throw new Error("must not create");
					},
				} as unknown as CloudSessionApi,
				apiBaseUrl: "https://api.example",
				getAuthToken: async () => "workos:fresh",
				createHubClient: () => {
					throw new Error("must not connect");
				},
			});
			ctx.cloudSessionManager = manager;

			await expect(
				handleChatSessionCommand(ctx, {
					action: "start",
					config: {
						executionTarget: "cloud",
						repoUrl: "https://github.com/cline/test",
						model: "anthropic/claude-sonnet-5",
					},
				}),
			).rejects.toThrow(/not enabled/);
		} finally {
			process.env.CLINE_CODE_CLOUD_AGENTS = "1";
		}
	});

	it("does not project a live cloud session through local discovery", () => {
		const { ctx } = createContext();
		ctx.liveSessions.set("ses-cloud", {
			busy: true,
			messages: [{ role: "user", content: "cloud prompt" }],
			promptsInQueue: [],
			status: "running",
			config: { executionTarget: "cloud" },
			startedAt: Date.now(),
		});

		const sessions = discoverChatSessions(ctx) as Array<{ sessionId?: string }>;
		expect(sessions.some((session) => session.sessionId === "ses-cloud")).toBe(
			false,
		);
	});

	it("treats a Hub pending session as an active desktop run", async () => {
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
			eventId: "evt-pending",
			timestamp: Date.now(),
			sessionId: "inner-1",
			payload: { session: { status: "pending" } },
		});

		expect(ctx.liveSessions.get("ses-outer")).toMatchObject({
			busy: true,
			status: "running",
		});
		expect(events.at(-1)).toEqual({
			name: "chat_session_status",
			payload: { sessionId: "ses-outer", status: "running" },
		});
	});

	it("keeps buffered queue state when the queue snapshot reply is malformed", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		hub.malformedQueueReply = true;
		// A queue event arrives while the rehydration snapshot is in flight,
		// so it lands in the reconnect buffer.
		hub.commandHook = async (command) => {
			if (command !== "session.messages") return;
			hub.events?.({
				version: "v1",
				event: "session.pending_prompts",
				eventId: "evt-queue-buffered",
				timestamp: Date.now(),
				sessionId: "inner-1",
				payload: {
					prompts: [
						{
							id: "q-buffered",
							prompt: "still queued",
							delivery: "queue",
							attachmentCount: 0,
						},
					],
				},
			});
		};
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.list();
		await manager.attach("ses-outer");
		// Reading with an unknown transcript forces the rehydration snapshot.
		await manager.readMessages("ses-outer");

		// The malformed reply must not count as an authoritative snapshot;
		// the buffered queue event is replayed and keeps the queued prompt.
		expect(ctx.liveSessions.get("ses-outer")?.promptsInQueue).toMatchObject([
			{ id: "q-buffered", prompt: "still queued" },
		]);
	});

	it("updates the cloud model before sending and skips redundant updates", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
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
		ctx.cloudSessionManager = manager;
		await manager.list();
		await manager.attach("ses-outer");

		for (const prompt of ["First turn", "Second turn"]) {
			await handleChatSessionCommand(ctx, {
				action: "send",
				sessionId: "ses-outer",
				prompt,
				config: {
					executionTarget: "cloud",
					model: "anthropic/claude-opus-4-1",
				},
			});
		}

		const updateCommands = hub.commands.filter(
			(command) => command.command === "session.update_connection",
		);
		expect(updateCommands).toEqual([
			expect.objectContaining({
				payload: {
					sessionId: "inner-1",
					updates: { modelId: "anthropic/claude-opus-4-1" },
				},
				sessionId: "inner-1",
			}),
		]);
		expect(
			hub.commands.findIndex(
				(command) => command.command === "session.update_connection",
			),
		).toBeLessThan(
			hub.commands.findIndex(
				(command) => command.command === "session.send_input",
			),
		);
		expect(ctx.liveSessions.get("ses-outer")?.config.model).toBe(
			"anthropic/claude-opus-4-1",
		);
	});

	it("forwards cloud images and continues rejecting file attachments", async () => {
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
		const image = "data:image/png;base64,aGVsbG8=";

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId: "ses-outer",
			prompt: "Inspect this image",
			attachments: { userImages: [image] },
			config: {
				executionTarget: "cloud",
				model: "anthropic/claude-sonnet-5",
			},
		});

		expect(hub.commands.at(-1)).toMatchObject({
			command: "session.send_input",
			payload: {
				prompt: "Inspect this image",
				delivery: undefined,
				attachments: { userImages: [image] },
			},
			sessionId: "inner-1",
		});
		await expect(
			handleChatSessionCommand(ctx, {
				action: "send",
				sessionId: "ses-outer",
				prompt: "Inspect this file",
				attachments: {
					userFiles: [{ name: "notes.txt", content: "hello" }],
				},
				config: { executionTarget: "cloud" },
			}),
		).rejects.toThrow("File attachments are not supported in cloud sessions");
	});

	it("keeps the confirmed model when the pod rejects an update", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		const remote = {
			...REMOTE_SESSION,
			metadata: { ...REMOTE_SESSION.metadata },
		};
		hub.commandHook = (command) => {
			if (command === "session.update_connection") {
				throw new Error("unsupported command");
			}
		};
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [remote] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		ctx.cloudSessionManager = manager;
		await manager.list();
		await manager.attach("ses-outer");

		await expect(
			handleChatSessionCommand(ctx, {
				action: "send",
				sessionId: "ses-outer",
				prompt: "Use Opus",
				config: {
					executionTarget: "cloud",
					model: "anthropic/claude-opus-4-1",
				},
			}),
		).rejects.toThrow("unsupported command");
		expect(ctx.liveSessions.get("ses-outer")?.config.model).toBe(
			remote.metadata.modelId,
		);
		expect(
			hub.commands.some((command) => command.command === "session.send_input"),
		).toBe(false);
	});

	it("leaves cloud approvals pending on app shutdown instead of denying them", async () => {
		const { ctx } = createContext();
		ctx.cloudSessionManager = {
			dispose: async () => {},
			isCloudSession: (sessionId: string) => sessionId === "ses-outer",
		};
		const approvalItem = {
			requestId: "",
			sessionId: "",
			createdAt: new Date().toISOString(),
			toolCallId: "call-1",
			toolName: "run_command",
			input: {},
		};
		const cloudResolve = vi.fn();
		const localResolve = vi.fn();
		ctx.pendingApprovals.set("ses-outer:app-1", {
			item: {
				...approvalItem,
				requestId: "ses-outer:app-1",
				sessionId: "ses-outer",
			},
			owner: { data: { canApproveTools: true }, send: vi.fn() },
			resolve: cloudResolve,
		});
		ctx.pendingApprovals.set("local-1:app-2", {
			item: {
				...approvalItem,
				requestId: "local-1:app-2",
				sessionId: "local-1",
			},
			owner: { data: { canApproveTools: true }, send: vi.fn() },
			resolve: localResolve,
		});

		await disposeSidecarContext(ctx, "code_sidecar_shutdown");

		// The pod outlives the app; its approval must stay answerable from
		// another surface. Local sessions die with the app and are denied.
		expect(cloudResolve).not.toHaveBeenCalled();
		expect(localResolve).toHaveBeenCalledWith({
			approved: false,
			reason: "code_sidecar_shutdown",
		});
		expect(ctx.pendingApprovals.size).toBe(0);
	});

	it("reopens an existing outer session instead of provisioning a duplicate", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		let creates = 0;
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [REMOTE_SESSION],
				create: async () => {
					creates += 1;
					return { sessionId: "unexpected", sandboxUrl: "pod" };
				},
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		ctx.cloudSessionManager = manager;
		await manager.list();

		const reopened = await handleChatSessionCommand(ctx, {
			action: "start",
			config: {
				executionTarget: "cloud",
				sessionId: "ses-outer",
				repoUrl: "https://github.com/cline/test",
				model: "anthropic/claude-sonnet-5",
			},
		});

		expect(reopened).toMatchObject({
			sessionId: "ses-outer",
			origin: "cloud",
		});
		expect(creates).toBe(0);
		expect(hub.commands).toContainEqual(
			expect.objectContaining({
				command: "session.attach",
				sessionId: "inner-1",
			}),
		);
	});

	it("bridges pending-prompt events and queue commands to the hub", async () => {
		const { ctx, events } = createContext();
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

		// Queue snapshot event from the pod updates the live session + webview.
		hub.events?.({
			version: "v1",
			event: "session.pending_prompts",
			sessionId: "inner-1",
			payload: {
				sessionId: "inner-1",
				prompts: [
					{
						id: "q-1",
						prompt: "queued prompt",
						delivery: "queue",
						attachmentCount: 0,
					},
				],
			},
		} as HubEventEnvelope);
		expect(ctx.liveSessions.get("ses-outer")?.promptsInQueue).toMatchObject([
			{ id: "q-1", prompt: "queued prompt", steer: false },
		]);
		expect(
			events.some((event) => event.name === "prompts_in_queue_state"),
		).toBe(true);

		// Submission event surfaces the queued user message in the transcript.
		hub.events?.({
			version: "v1",
			event: "session.pending_prompt_submitted",
			sessionId: "inner-1",
			payload: {
				sessionId: "inner-1",
				prompt: { id: "q-1", prompt: "queued prompt", attachmentCount: 0 },
			},
		} as HubEventEnvelope);
		expect(
			events.some(
				(event) =>
					event.name === "chat_event" &&
					event.payload.stream === "chat_queued_prompt_start",
			),
		).toBe(true);

		// Queue management actions route to hub commands, not local handlers.
		const steered = await handleChatSessionCommand(ctx, {
			action: "steer_prompt",
			sessionId: "ses-outer",
			promptId: "q-1",
		});
		expect(steered).toMatchObject({ sessionId: "ses-outer", updated: true });
		expect(hub.commands).toContainEqual(
			expect.objectContaining({
				command: "session.update_pending_prompt",
				payload: expect.objectContaining({
					sessionId: "inner-1",
					promptId: "q-1",
					delivery: "steer",
				}),
			}),
		);

		const removed = await handleChatSessionCommand(ctx, {
			action: "remove_pending_prompt",
			sessionId: "ses-outer",
			promptId: "q-1",
		});
		expect(removed).toMatchObject({ sessionId: "ses-outer", removed: true });
		expect(
			hub.commands.some(
				(entry) => entry.command === "session.remove_pending_prompt",
			),
		).toBe(true);
	});

	it("passes branch and the user's approval policy through to the cloud session", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient(false);
		let createBody: Record<string, unknown> | undefined;
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [],
				create: async (input: Record<string, unknown>) => {
					createBody = input;
					return { sessionId: "ses-created", sandboxUrl: "pod" };
				},
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		ctx.cloudSessionManager = manager;

		await handleChatSessionCommand(ctx, {
			action: "start",
			prompt: "Fix the provisioning flow",
			config: {
				executionTarget: "cloud",
				repoUrl: "https://github.com/cline/test",
				model: "anthropic/claude-sonnet-5",
				branch: "feature/login-fix",
				autoApproveTools: false,
			},
		});

		expect(createBody).toMatchObject({
			repoUrl: "https://github.com/cline/test",
			modelId: "anthropic/claude-sonnet-5",
			initialPrompt: "Fix the provisioning flow",
			branch: "feature/login-fix",
			autoApproveTools: false,
		});
		const innerCreate = hub.commands.find(
			(entry) => entry.command === "session.create",
		);
		expect(innerCreate?.payload?.toolPolicies).toEqual({
			"*": { autoApprove: false },
		});
	});

	it("shows a provisioning placeholder in the session list until create settles", async () => {
		const { ctx, events } = createContext();
		const hub = new FakeHubClient(false);
		let serverReady = false;
		let finishCreate:
			| ((value: { sessionId: string; sandboxUrl: string }) => void)
			| undefined;
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [
					{
						...REMOTE_SESSION,
						id: "ses-existing",
						status: "failed",
						title: "Existing session",
					},
					{
						...REMOTE_SESSION,
						id: "ses-created",
						status: serverReady ? "ready" : "provisioning",
						title: undefined,
						metadata: {
							...REMOTE_SESSION.metadata,
							createRequestTitle: "__cline_create_request__:client-start-1",
						},
					},
				],
				create: () =>
					new Promise((resolve) => {
						finishCreate = resolve;
					}),
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		ctx.cloudSessionManager = manager;

		const creating = manager.create({
			requestId: "client-start-1",
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
			initialPrompt: "Fix the provisioning flow",
		});
		// Let create() register the placeholder before asserting.
		await new Promise((resolve) => setTimeout(resolve, 0));

		const during = await manager.listForDiscovery();
		const provisioning = during.filter(
			(session) => session.status === "provisioning",
		);
		expect(provisioning).toHaveLength(1);
		const placeholder = provisioning[0];
		expect(during.some((session) => session.sessionId === "ses-existing")).toBe(
			true,
		);
		expect(during.some((session) => session.sessionId === "ses-created")).toBe(
			false,
		);
		expect(placeholder).toMatchObject({
			origin: "cloud",
			prompt: "Fix the provisioning flow",
			repoUrl: "https://github.com/cline/test",
			metadata: expect.objectContaining({
				title: "Provisioning cline/test…",
			}),
		});

		// Opening the placeholder is benign (loading state), reads are empty,
		// and only mutating actions fail with a clear message.
		const placeholderId = String(placeholder?.sessionId);
		await expect(
			handleCommand(ctx, "get_cloud_provisioning_outcome", { placeholderId }),
		).resolves.toEqual({ status: "provisioning" });
		await expect(manager.attach(placeholderId)).resolves.toMatchObject({
			sessionId: placeholderId,
			status: "provisioning",
		});
		await expect(manager.readMessages(placeholderId)).resolves.toEqual([]);
		await expect(manager.send(placeholderId, "hello")).rejects.toThrow(
			/still provisioning/,
		);

		serverReady = true;
		finishCreate?.({ sessionId: "ses-created", sandboxUrl: "pod" });
		await creating;

		const after = await manager.listForDiscovery();
		expect(after.some((session) => session.status === "provisioning")).toBe(
			false,
		);

		// The webview swaps placeholder threads to the real session on this.
		const provisioned = events.find(
			(event) => event.name === "cloud_session_provisioned",
		);
		expect(provisioned?.payload).toMatchObject({
			placeholderId,
			sessionId: "ses-created",
		});
		await expect(
			handleCommand(ctx, "get_cloud_provisioning_outcome", { placeholderId }),
		).resolves.toEqual({ status: "ready", sessionId: "ses-created" });
	});

	it("retains a failed provisioning outcome after removing its placeholder", async () => {
		const { ctx, events } = createContext();
		const manager = new CloudSessionManager(ctx, {
			api: {
				create: async () => {
					throw new Error("sandbox failed");
				},
				list: async () => [],
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
		});
		ctx.cloudSessionManager = manager;

		const creating = manager.create({
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
		});
		const rejected = expect(creating).rejects.toThrow("sandbox failed");
		const placeholderId = String(
			events.find(
				(event) =>
					event.name === "chat_session_status" &&
					event.payload.status === "provisioning",
			)?.payload.sessionId,
		);
		await rejected;

		await expect(
			handleCommand(ctx, "get_cloud_provisioning_outcome", { placeholderId }),
		).resolves.toEqual({ status: "failed", message: "sandbox failed" });
	});

	it("surfaces run.failed errors as a visible error message", async () => {
		const { ctx, events } = createContext();
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

		hub.events?.({
			version: "v1",
			event: "run.failed",
			sessionId: "inner-1",
			payload: {
				reason: "error",
				error: "Insufficient balance. Your Cline Credits balance is $-1.55",
			},
		} as HubEventEnvelope);

		const errorChunk = events.find(
			(event) =>
				event.name === "chat_event" &&
				event.payload.stream === "chat_core_log" &&
				String(event.payload.chunk).includes("Insufficient balance"),
		);
		expect(errorChunk).toBeDefined();
		expect(events.some((event) => event.name === "chat_session_ended")).toBe(
			true,
		);
	});

	it("attaches instead of creating when start carries an existing outer id and the registry is cold", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient(true);
		let creates = 0;
		const outerId = "ses-01H9XKYHEC1YFBXMJ8ZBES772P";
		const manager = new CloudSessionManager(ctx, {
			api: {
				// Registry is cold: the record is only resolvable via REST list.
				list: async () => [{ ...REMOTE_SESSION, id: outerId }],
				create: async () => {
					creates += 1;
					return { sessionId: "ses-unwanted", sandboxUrl: "pod" };
				},
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		ctx.cloudSessionManager = manager;

		const attached = await handleChatSessionCommand(ctx, {
			action: "start",
			config: {
				executionTarget: "cloud",
				sessionId: outerId,
				repoUrl: "https://github.com/cline/test",
				model: "anthropic/claude-sonnet-5",
			},
		});

		expect(attached).toMatchObject({ sessionId: outerId, origin: "cloud" });
		expect(creates).toBe(0);
		expect(
			hub.commands.some((entry) => entry.command === "session.attach"),
		).toBe(true);
	});

	it("ignores a new client-planned id and provisions a canonical outer id", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient(false);
		let creates = 0;
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [],
				create: async () => {
					creates += 1;
					return { sessionId: "ses-server", sandboxUrl: "pod" };
				},
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		ctx.cloudSessionManager = manager;

		const created = await handleChatSessionCommand(ctx, {
			action: "start",
			config: {
				executionTarget: "cloud",
				sessionId: "client-planned-id",
				repoUrl: "https://github.com/cline/test",
				model: "anthropic/claude-sonnet-5",
			},
		});

		expect(created).toMatchObject({
			sessionId: "ses-server",
			origin: "cloud",
		});
		expect(creates).toBe(1);
		expect(ctx.liveSessions.has("client-planned-id")).toBe(false);
		expect(ctx.liveSessions.has("ses-server")).toBe(true);
	});
});
