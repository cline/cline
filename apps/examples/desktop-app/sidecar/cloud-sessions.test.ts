import { HubTransportError } from "@cline/core";
import type { HubEventEnvelope } from "@cline/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleChatSessionCommand } from "./chat-session";
import {
	CloudSessionApi,
	CloudSessionError,
	CloudSessionManager,
	type CloudSessionRecord,
	cloudSessionToDiscoveryRecord,
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
		wsClients: new Set([
			{
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
		options?: { timeoutMs?: number | null },
	): Promise<{
		ok: true;
		payload?: Record<string, unknown>;
	}> {
		this.commands.push({ command, payload, sessionId, options });
		if (command === "session.send_input" && this.failNextSend) {
			this.failNextSend = false;
			throw new HubTransportError("hub_connection_closed", "socket closed");
		}
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
					prompts: [
						{
							id: "q-1",
							prompt: "queued prompt",
							delivery:
								command === "session.update_pending_prompt"
									? (payload?.delivery ?? "queue")
									: "queue",
							attachmentCount: 0,
						},
					],
				},
			};
		}
		if (command === "session.messages") {
			return {
				ok: true,
				payload: { messages: [{ role: "user", content: "hi" }] },
			};
		}
		return { ok: true, payload: {} };
	}

	async dispose(): Promise<void> {
		this.disposed = true;
	}
}

describe("CloudSessionApi", () => {
	it("resolves a fresh bearer token for every REST request", async () => {
		const tokens = ["workos:first", "workos:second"];
		const authorizations: string[] = [];
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example/",
			appBaseUrl: "https://app.example/",
			getAuthToken: async () => tokens.shift(),
			fetch: async (_input, init) => {
				authorizations.push(
					new Headers(init?.headers).get("Authorization") ?? "",
				);
				return jsonResponse({ success: true, data: [] });
			},
		});

		await api.list();
		await api.list();

		expect(authorizations).toEqual([
			"Bearer workos:first",
			"Bearer workos:second",
		]);
	});

	it("includes branch in the create body only when one was requested", async () => {
		const bodies: Array<Record<string, unknown>> = [];
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "sk_test",
			fetch: async (_input, init) => {
				bodies.push(JSON.parse(String(init?.body)));
				return jsonResponse(
					{ success: true, data: { sessionId: "ses-1", sandboxUrl: "pod" } },
					201,
				);
			},
		});

		await api.create({
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
			branch: "feature/login-fix",
		});
		await api.create({
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
		});

		expect(bodies[0]).toMatchObject({ branch: "feature/login-fix" });
		expect(bodies[1]).not.toHaveProperty("branch");
	});

	it("treats a missing history snapshot (404) as null, not an empty archive", async () => {
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "sk_test",
			fetch: async () => new Response("not found", { status: 404 }),
		});

		expect(await api.history("ses-1")).toBeNull();
	});

	it("creates with the dashboard-parity contract and no branch field", async () => {
		let body: Record<string, unknown> | undefined;
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "sk_test",
			fetch: async (_input, init) => {
				body = JSON.parse(String(init?.body));
				return jsonResponse(
					{ success: true, data: { sessionId: "ses-1", sandboxUrl: "pod" } },
					201,
				);
			},
		});

		await api.create({
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
		});

		expect(body).toEqual({
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
		});
		expect(body).not.toHaveProperty("branch");
	});

	it("returns a stable, environment-aware GitHub connection error", async () => {
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://staging-app.example/",
			getAuthToken: async () => "workos:test",
			fetch: async () =>
				jsonResponse({ success: false, error: "GitHub is not connected" }, 412),
		});

		const error = await api
			.create({ modelId: "model", repoUrl: "https://github.com/cline/test" })
			.catch((caught) => caught);

		expect(error).toBeInstanceOf(CloudSessionError);
		expect(error.code).toBe("github_not_connected");
		expect(error.message).toBe(
			'CLOUD_SESSION_ERROR:{"code":"github_not_connected","message":"GitHub is not connected","connectUrl":"https://staging-app.example/dashboard/integrations"}',
		);
	});

	it("routes organization GitHub setup to organization integrations", async () => {
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://staging-app.example/",
			getAuthToken: async () => "workos:test",
			fetch: async () =>
				jsonResponse({ success: false, error: "GitHub is not connected" }, 412),
		});

		const error = await api
			.create({
				modelId: "model",
				repoUrl: "https://github.com/cline/test",
				organizationId: "org-cline-bot",
			})
			.catch((caught) => caught);

		expect(error).toBeInstanceOf(CloudSessionError);
		expect(error.connectUrl).toBe(
			"https://staging-app.example/dashboard/organization/integrations",
		);
	});

	it("surfaces a stable authentication error for REST requests", async () => {
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "expired",
			fetch: async () =>
				jsonResponse({ success: false, error: "authentication required" }, 401),
		});

		const error = await api.list().catch((caught) => caught);

		expect(error).toBeInstanceOf(CloudSessionError);
		expect(error.code).toBe("authentication_required");
	});

	it("lists connected GitHub repositories and their branches", async () => {
		const requestedPaths: string[] = [];
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "workos:test",
			fetch: async (input) => {
				const path = new URL(String(input)).pathname;
				requestedPaths.push(path);
				if (path.endsWith("/branches")) {
					return jsonResponse({
						success: true,
						data: [{ name: "main" }, { name: "feature/cloud" }],
					});
				}
				return jsonResponse({
					success: true,
					data: [
						{
							id: 42,
							name: "cline",
							full_name: "cline/cline",
							html_url: "https://github.com/cline/cline",
							clone_url: "https://github.com/cline/cline.git",
							default_branch: "main",
						},
					],
				});
			},
		});

		expect(await api.listRepositories()).toEqual({
			connected: true,
			connectUrl: "https://app.example/dashboard/integrations",
			repositories: [
				{
					id: 42,
					name: "cline",
					fullName: "cline/cline",
					url: "https://github.com/cline/cline",
					defaultBranch: "main",
				},
			],
		});
		expect(await api.listBranches(42)).toEqual({
			available: true,
			branches: ["main", "feature/cloud"],
		});
		expect(requestedPaths).toEqual([
			"/api/v1/integrations/github/repositories",
			"/api/v1/integrations/github/repositories/42/branches",
		]);
	});

	it("falls back to the repository default when the branch API is unavailable", async () => {
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "workos:test",
			fetch: async () =>
				jsonResponse({ success: false, error: "route not found" }, 404),
		});

		expect(await api.listBranches(42)).toEqual({
			available: false,
			branches: [],
		});
	});

	it("uses organization-scoped repository and branch endpoints", async () => {
		const requestedPaths: string[] = [];
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "workos:test",
			fetch: async (input) => {
				const path = new URL(String(input)).pathname;
				requestedPaths.push(path);
				return jsonResponse({ success: true, data: [] });
			},
		});

		expect(await api.listRepositories("org-cline-bot")).toMatchObject({
			connected: true,
			connectUrl: "https://app.example/dashboard/organization/integrations",
		});
		await api.listBranches(42, "org-cline-bot");
		expect(requestedPaths).toEqual([
			"/api/v1/organizations/org-cline-bot/integrations/github/repositories",
			"/api/v1/organizations/org-cline-bot/integrations/github/repositories/42/branches",
		]);
	});

	it("returns the GitHub connection action when no integration exists", async () => {
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example/",
			getAuthToken: async () => "workos:test",
			fetch: async () =>
				jsonResponse({ success: false, error: "not connected" }, 404),
		});

		expect(await api.listRepositories()).toEqual({
			connected: false,
			connectUrl: "https://app.example/dashboard/integrations",
			repositories: [],
		});
	});
});

// Cloud-session creation is feature-flagged (default off); force it on for
// this suite via the env override and prove the gate separately below.
beforeAll(() => {
	process.env.CLINE_CODE_CLOUD_AGENTS = "1";
});
afterAll(() => {
	delete process.env.CLINE_CODE_CLOUD_AGENTS;
});

describe("cloud agents feature flag", () => {
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
});

describe("CloudSessionManager", () => {
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

	it("resolves fresh bearer headers for each WebSocket connection attempt", async () => {
		const { ctx } = createContext();
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

	it("creates and sends to an inner session while preserving the outer id", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient(false);
		const manager = new CloudSessionManager(ctx, {
			api: {
				create: async () => ({
					sessionId: "ses-outer",
					sandboxUrl: "https://pod.example/hub",
				}),
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});

		const created = await manager.create({
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
			thinking: true,
			reasoningEffort: "high",
		});
		const sent = await manager.send("ses-outer", "Fix it");

		expect(created.sessionId).toBe("ses-outer");
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
		expect(hub.commands.map((entry) => entry.command).slice(-4)).toEqual([
			"session.attach",
			"session.get",
			"session.messages",
			"session.pending_prompts",
		]);
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

	it("shows a provisioning placeholder in the session list until create settles", async () => {
		const { ctx, events } = createContext();
		const hub = new FakeHubClient(false);
		let finishCreate:
			| ((value: { sessionId: string; sandboxUrl: string }) => void)
			| undefined;
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [],
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
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
		});
		// Let create() register the placeholder before asserting.
		await new Promise((resolve) => setTimeout(resolve, 0));

		const during = await manager.listForDiscovery();
		const placeholder = during.find(
			(session) => session.status === "provisioning",
		);
		expect(placeholder).toMatchObject({
			origin: "cloud",
			repoUrl: "https://github.com/cline/test",
			metadata: expect.objectContaining({
				title: "Provisioning cline/test…",
			}),
		});

		// Opening the placeholder is benign (loading state), reads are empty,
		// and only mutating actions fail with a clear message.
		const placeholderId = String(placeholder?.sessionId);
		await expect(manager.attach(placeholderId)).resolves.toMatchObject({
			sessionId: placeholderId,
			status: "provisioning",
		});
		await expect(manager.readMessages(placeholderId)).resolves.toEqual([]);
		await expect(manager.send(placeholderId, "hello")).rejects.toThrow(
			/still provisioning/,
		);

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
		ctx.cloudSessionManager = manager;

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
		ctx.cloudSessionManager = manager;

		await expect(
			manager.create({
				modelId: "anthropic/claude-sonnet-5",
				repoUrl: "https://github.com/cline/test",
			}),
		).rejects.toThrow("account endpoint down");
		expect(createInput?.organizationId).toBeUndefined();
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
