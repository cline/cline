import type { HubEventEnvelope } from "@cline/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handleChatSessionCommand } from "./chat-session";
import {
	type CloudSessionApi,
	CloudSessionError,
	CloudSessionManager,
	type CloudSessionRecord,
	getCloudSessionManager,
	resetCloudSessionManager,
} from "./cloud-sessions";
import {
	createSidecarContext,
	disposeSidecarContext,
	getEnvironmentContext,
} from "./context";
import {
	discoverChatSessions,
	mergeDiscoveredSessionLists,
} from "./session-data/discovery";
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
	const ctx = createSidecarContext("/local/workspace");
	ctx.wsClients.add({
		data: { canApproveTools: true },
		send: (message) => events.push(JSON.parse(message).event),
	});
	return { ctx, events };
}

class FakeHubClient {
	events?: (event: HubEventEnvelope) => void;
	prompts: Array<Record<string, unknown>> = [
		{
			id: "q-1",
			prompt: "queued prompt",
			delivery: "queue",
			attachmentCount: 0,
		},
	];
	readonly commands: Array<{
		command: string;
		payload?: Record<string, unknown>;
		sessionId?: string;
	}> = [];

	constructor(private readonly hasExistingInner = true) {}

	async connect(): Promise<void> {}

	getClientId(): string {
		return "code-cloud-ses-outer";
	}

	subscribe(listener: (event: HubEventEnvelope) => void): () => void {
		this.events = listener;
		return () => {
			this.events = undefined;
		};
	}

	async command(
		command: string,
		payload?: Record<string, unknown>,
		sessionId?: string,
	): Promise<{
		ok: true;
		payload?: Record<string, unknown>;
	}> {
		this.commands.push({ command, payload, sessionId });
		if (command === "session.list") {
			return {
				ok: true,
				payload: {
					sessions: this.hasExistingInner
						? [{ sessionId: "inner-1", updatedAt: 20 }]
						: [],
				},
			};
		}
		if (command === "session.create") {
			return {
				ok: true,
				payload: { session: { sessionId: "inner-created" } },
			};
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
			return { ok: true, payload: { messages: [] } };
		}
		return { ok: true, payload: {} };
	}

	async dispose(): Promise<void> {}
}

function createFixture({
	hub = new FakeHubClient(),
	api = {
		list: async () => [
			{ ...REMOTE_SESSION, metadata: { ...REMOTE_SESSION.metadata } },
		],
	} as CloudSessionApi,
}: {
	hub?: FakeHubClient;
	api?: CloudSessionApi;
} = {}) {
	const { ctx, events } = createContext();
	const manager = new CloudSessionManager(ctx, {
		api,
		apiBaseUrl: "https://api.example",
		getAuthToken: async () => "workos:fresh",
		createHubClient: () => hub as never,
	});
	ctx.cloudSessionManager = manager;
	return { ctx, events, hub, manager };
}

beforeAll(() => {
	process.env.CLINE_CODE_CLOUD_AGENTS = "1";
});
afterAll(() => {
	delete process.env.CLINE_CODE_CLOUD_AGENTS;
});

describe("Cloud sessions sidecar wiring", () => {
	it.each([
		"local",
		"ssh-remote",
	])("shares cloud manager ownership with the %s context", async (environmentId) => {
		const { ctx } = createContext();
		const scoped = getEnvironmentContext(ctx, environmentId);
		const manager = getCloudSessionManager(scoped);
		const dispose = vi.spyOn(manager, "dispose");
		expect(getCloudSessionManager(ctx)).toBe(manager);
		await resetCloudSessionManager(ctx);
		expect(dispose).toHaveBeenCalledOnce();
		expect(scoped.cloudSessionManager).toBeNull();
		const replacement = getCloudSessionManager(ctx);
		expect(getCloudSessionManager(scoped)).toBe(replacement);
		await resetCloudSessionManager(scoped);
		expect(ctx.cloudSessionManager).toBeNull();
	});

	it("blocks cloud session creation when the flag is off", async () => {
		process.env.CLINE_CODE_CLOUD_AGENTS = "0";
		try {
			const create = vi.fn();
			const { ctx, hub } = createFixture({
				api: { create } as unknown as CloudSessionApi,
			});
			const connect = vi.spyOn(hub, "connect");
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
			expect(create).not.toHaveBeenCalled();
			expect(connect).not.toHaveBeenCalled();
			expect(hub.commands).toEqual([]);
		} finally {
			process.env.CLINE_CODE_CLOUD_AGENTS = "1";
		}
	});

	it.each([
		"lastActivityAt",
		"updatedAt",
		"endedAt",
	])("keeps recently active sessions in limited discovery using %s", (activityField) => {
		const active = {
			sessionId: "ses-active",
			startedAt: "2026-09-01T00:00:00Z",
			[activityField]: "2026-09-18T00:00:00Z",
		};
		const newer = Array.from({ length: 50 }, (_, i) => ({
			sessionId: `local-${i}`,
			startedAt: "2026-09-17T00:00:00Z",
		}));
		const result = mergeDiscoveredSessionLists([active], newer, 50);
		expect(result).toHaveLength(50);
		expect(result[0]).toMatchObject({ sessionId: "ses-active" });
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

	it("keeps cloud discovery and run events local after switching to SSH", async () => {
		const { ctx, events, hub, manager } = createFixture();

		await manager.list();
		await manager.attach("ses-outer");
		ctx.activeEnvironmentId = "ssh-remote";
		for (const session of [
			...(await manager.listForDiscovery()),
			manager.getCachedDiscoveryRecord("ses-outer"),
		]) {
			expect(session).toMatchObject({
				environmentId: "local",
				executionTarget: "cloud",
			});
		}
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
			payload: {
				sessionId: "ses-outer",
				status: "running",
				environmentId: "local",
			},
		});
	});

	it("updates cloud settings from an SSH-scoped command before sending", async () => {
		const { ctx, hub, manager } = createFixture();
		await manager.list();
		await manager.attach("ses-outer");

		await handleChatSessionCommand(getEnvironmentContext(ctx, "ssh-remote"), {
			action: "send",
			sessionId: "ses-outer",
			prompt: "First turn",
			config: {
				executionTarget: "cloud",
				model: "anthropic/claude-opus-4-1",
				autoApproveTools: true,
			},
		});

		const actions = hub.commands.filter(({ command }) =>
			["session.update_connection", "session.send_input"].includes(command),
		);
		expect(actions).toEqual([
			expect.objectContaining({
				command: "session.update_connection",
				payload: {
					sessionId: "inner-1",
					updates: { modelId: "anthropic/claude-opus-4-1" },
				},
				sessionId: "inner-1",
			}),
			expect.objectContaining({ command: "session.send_input" }),
		]);
		expect(ctx.liveSessions.get("ses-outer")?.config).toMatchObject({
			model: "anthropic/claude-opus-4-1",
			autoApproveTools: true,
		});
	});

	it("forwards image-only cloud messages and rejects file attachments", async () => {
		const { ctx, hub, manager } = createFixture();
		await manager.list();
		await manager.attach("ses-outer");
		const image = "data:image/png;base64,aGVsbG8=";
		const commandsBeforeInvalidPrompt = hub.commands.length;
		await expect(
			handleChatSessionCommand(ctx, {
				action: "send",
				sessionId: "ses-outer",
				prompt: "",
				attachments: { userImages: ["", "   "] },
				config: { executionTarget: "cloud" },
			}),
		).rejects.toThrow("prompt or image is required");
		expect(hub.commands).toHaveLength(commandsBeforeInvalidPrompt);

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId: "ses-outer",
			prompt: "",
			attachments: { userImages: [image] },
			config: {
				executionTarget: "cloud",
				model: "anthropic/claude-sonnet-5",
			},
		});

		expect(hub.commands.at(-1)).toMatchObject({
			command: "session.send_input",
			payload: {
				prompt: "",
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

	it("bridges pending-prompt events and queue commands to the hub", async () => {
		const { ctx, events, hub, manager } = createFixture();
		await manager.list();
		await manager.attach("ses-outer");

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

	it("creates a canonical session with the requested branch and approval policy", async () => {
		const create = vi.fn(async () => ({
			sessionId: "ses-created",
			status: "ready",
			sandboxUrl: "pod",
		}));
		const { ctx, hub, manager } = createFixture({
			hub: new FakeHubClient(false),
			api: {
				list: async () => [],
				create,
			} as unknown as CloudSessionApi,
		});

		const created = await handleChatSessionCommand(ctx, {
			action: "start",
			prompt: "Fix the provisioning flow",
			config: {
				executionTarget: "cloud",
				repoUrl: "https://github.com/cline/test",
				model: "anthropic/claude-sonnet-5",
				sessionId: "client-planned-id",
				branch: "feature/login-fix",
				autoApproveTools: false,
			},
		});

		expect(created).toMatchObject({
			sessionId: "ses-created",
			origin: "cloud",
		});
		expect(ctx.liveSessions.has("client-planned-id")).toBe(false);
		expect(ctx.liveSessions.has("ses-created")).toBe(true);
		expect(create).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				repoUrl: "https://github.com/cline/test",
				modelId: "anthropic/claude-sonnet-5",
				initialPrompt: "Fix the provisioning flow",
				branch: "feature/login-fix",
				autoApproveTools: false,
			}),
		);
		await manager.send("ses-created", "Fix the provisioning flow");
		const innerCreate = hub.commands.find(
			(entry) => entry.command === "session.create",
		);
		expect(innerCreate?.payload?.toolPolicies).toEqual({
			"*": { autoApprove: false },
		});
	});

	it.each([
		false,
		true,
	])("preserves pending creation policy across manager reset (updated: %s)", async (updateBeforeReset) => {
		const session = { ...REMOTE_SESSION, id: "ses-created" };
		const api = {
			list: async () => [session],
			create: async () => ({ sessionId: session.id, status: "ready" }),
		} as unknown as CloudSessionApi;
		const { ctx, manager } = createFixture({
			hub: new FakeHubClient(false),
			api,
		});
		const policy = {
			autoApproveTools: false,
			thinking: false,
			reasoningEffort: "high" as const,
		};
		try {
			await manager.create({
				repoUrl: "https://github.com/cline/test",
				modelId: "anthropic/claude-sonnet-5",
				...(updateBeforeReset
					? { autoApproveTools: true, thinking: true }
					: policy),
			});
			if (updateBeforeReset) manager.restoreCreationOptions(session.id, policy);
			await resetCloudSessionManager(ctx);
			expect(ctx.liveSessions.has(session.id)).toBe(false);

			const hub = new FakeHubClient(false);
			const replacement = new CloudSessionManager(ctx, {
				api,
				apiBaseUrl: "https://api.example",
				getAuthToken: async () => "workos:fresh",
				createHubClient: () => hub as never,
			});
			ctx.cloudSessionManager = replacement;
			await replacement.attach(session.id);
			await replacement.send(session.id, "First prompt after reset");
			expect(
				hub.commands.filter((entry) => entry.command === "session.create"),
			).toEqual([
				expect.objectContaining({
					payload: expect.objectContaining({
						toolPolicies: { "*": { autoApprove: false } },
						sessionConfig: expect.objectContaining({
							thinking: false,
							reasoningEffort: "high",
						}),
					}),
				}),
			]);
		} finally {
			await resetCloudSessionManager(ctx);
		}
	});

	it("returns the real id immediately and sends only after readiness", async () => {
		const ready = Promise.withResolvers<void>();
		const waitUntilReady = vi.fn(() => ready.promise);
		const session = {
			...REMOTE_SESSION,
			id: "ses-created",
			status: "provisioning",
		};
		const { events, hub, manager } = createFixture({
			hub: new FakeHubClient(false),
			api: {
				create: async () => ({
					sessionId: session.id,
					status: "provisioning",
					sandboxUrl: "",
				}),
				list: async () => [REMOTE_SESSION, session],
				status: async () => ({ status: session.status }),
				waitUntilReady,
			} as unknown as CloudSessionApi,
		});
		const created = await manager.create({
			modelId: "model",
			repoUrl: "https://github.com/cline/test",
			initialPrompt: "Fix this",
		});
		expect(created).toMatchObject({
			sessionId: "ses-created",
			status: "provisioning",
		});
		expect(waitUntilReady).not.toHaveBeenCalled();
		expect(hub.commands).toEqual([]);
		expect(
			(await manager.listForDiscovery()).map((row) => row.sessionId),
		).toEqual(["ses-outer", "ses-created"]);
		await expect(manager.attach("ses-created")).resolves.toMatchObject({
			sessionId: "ses-created",
			status: "provisioning",
		});
		await expect(manager.readMessages("ses-created")).resolves.toEqual([]);
		await expect(manager.pendingPrompts("ses-created")).resolves.toMatchObject({
			promptsInQueue: [],
		});
		expect(waitUntilReady).not.toHaveBeenCalled();
		const sending = manager.send("ses-created", "Fix this");
		await vi.waitFor(() => expect(waitUntilReady).toHaveBeenCalledOnce());
		expect(hub.commands).toEqual([]);
		ready.resolve();
		await sending;
		expect(
			hub.commands.filter((entry) => entry.command === "session.send_input"),
		).toHaveLength(1);
		expect(
			events.some(
				(event) =>
					event.name === "chat_session_status" &&
					event.payload.sessionId === "ses-created" &&
					event.payload.status === "provisioning",
			),
		).toBe(true);
	});

	it("retains a failed real session and rejects its first send", async () => {
		const { events, hub, manager } = createFixture({
			hub: new FakeHubClient(false),
			api: {
				create: async () => ({
					sessionId: "ses-created",
					status: "provisioning",
					sandboxUrl: "",
				}),
				list: async () => [],
				waitUntilReady: async () => {
					throw new CloudSessionError("session_failed", "clone failed");
				},
			} as unknown as CloudSessionApi,
		});
		await manager.create({
			modelId: "model",
			repoUrl: "https://github.com/cline/test",
		});
		await expect(manager.send("ses-created", "Fix this")).rejects.toThrow(
			/clone failed/,
		);
		await expect(manager.attach("ses-created")).resolves.toMatchObject({
			sessionId: "ses-created",
			status: "failed",
		});
		await expect(manager.send("ses-created", "Retry")).rejects.toMatchObject({
			detail: "clone failed",
		});
		expect(hub.commands).toEqual([]);
		expect(
			events.some(
				(event) =>
					event.name === "chat_session_status" &&
					event.payload.sessionId === "ses-created" &&
					event.payload.status === "error",
			),
		).toBe(true);
	});

	it("surfaces run.failed errors as a visible error message", async () => {
		const { ctx, events, hub, manager } = createFixture();
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

	it.each([
		"start",
		"attach",
	] as const)("%s attaches an existing outer id with a cold registry", async (action) => {
		const create = vi.fn();
		const outerId = "ses-01H9XKYHEC1YFBXMJ8ZBES772P";
		const { ctx, hub } = createFixture({
			api: {
				list: async () => [{ ...REMOTE_SESSION, id: outerId }],
				create,
			} as unknown as CloudSessionApi,
		});

		const attached = await handleChatSessionCommand(
			ctx,
			action === "attach"
				? { action, sessionId: outerId }
				: {
						action,
						config: {
							executionTarget: "cloud",
							sessionId: outerId,
							repoUrl: "https://github.com/cline/test",
							model: "anthropic/claude-sonnet-5",
						},
					},
		);

		expect(attached).toMatchObject({ sessionId: outerId, origin: "cloud" });
		expect(create).not.toHaveBeenCalled();
		expect(
			hub.commands.some((entry) => entry.command === "session.attach"),
		).toBe(true);
	});
});
