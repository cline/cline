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

		expect(body).toMatchObject({
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
			title: expect.stringMatching(/^__cline_create_request__:/),
		});
		expect(body).not.toHaveProperty("branch");
	});

	it("waits for the current asynchronous provisioning contract", async () => {
		vi.useFakeTimers();
		let statusCalls = 0;
		try {
			const api = new CloudSessionApi({
				apiBaseUrl: "https://api.example",
				appBaseUrl: "https://app.example",
				getAuthToken: async () => "sk_test",
				fetch: async (input, init) => {
					const url = new URL(String(input));
					if (init?.method === "POST") {
						return jsonResponse(
							{
								success: true,
								data: { sessionId: "ses-1", status: "provisioning" },
							},
							201,
						);
					}
					expect(url.pathname).toBe("/api/v1/session/ses-1/status");
					statusCalls += 1;
					return jsonResponse({
						success: true,
						data: {
							sessionId: "ses-1",
							status: statusCalls === 1 ? "provisioning" : "ready",
						},
					});
				},
			});

			const creating = api.create({
				modelId: "anthropic/claude-sonnet-5",
				repoUrl: "https://github.com/cline/test",
			});
			await vi.waitFor(() => expect(statusCalls).toBe(1));
			await vi.advanceTimersByTimeAsync(3_000);

			await expect(creating).resolves.toMatchObject({
				sessionId: "ses-1",
				sandboxUrl: "",
			});
			expect(statusCalls).toBe(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps provisioning polls bound to the account that created the session", async () => {
		const tokens = ["workos:create", "workos:new-account"];
		const authorizations: string[] = [];
		vi.useFakeTimers();
		let statusCalls = 0;
		try {
			const api = new CloudSessionApi({
				apiBaseUrl: "https://api.example",
				appBaseUrl: "https://app.example",
				getAuthToken: async () => tokens.shift(),
				fetch: async (input, init) => {
					authorizations.push(
						new Headers(init?.headers).get("Authorization") ?? "",
					);
					if (init?.method === "POST") {
						return jsonResponse(
							{
								success: true,
								data: { sessionId: "ses-1", status: "provisioning" },
							},
							201,
						);
					}
					expect(new URL(String(input)).pathname).toBe(
						"/api/v1/session/ses-1/status",
					);
					statusCalls += 1;
					return jsonResponse({
						success: true,
						data: {
							sessionId: "ses-1",
							status: statusCalls === 1 ? "provisioning" : "ready",
						},
					});
				},
			});

			const creating = api.create({
				modelId: "anthropic/claude-sonnet-5",
				repoUrl: "https://github.com/cline/test",
			});
			await vi.waitFor(() => expect(statusCalls).toBe(1));
			await vi.advanceTimersByTimeAsync(3_000);
			await creating;

			expect(authorizations).toEqual([
				"Bearer workos:create",
				"Bearer workos:create",
				"Bearer workos:create",
			]);
			expect(tokens).toEqual(["workos:new-account"]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("refreshes an expired provisioning token without switching accounts", async () => {
		const original = jwtFor("user-1", "original");
		const refreshed = jwtFor("user-1", "refreshed");
		const tokens = [original, refreshed];
		const authorizations: string[] = [];
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => tokens.shift(),
			fetch: async (_input, init) => {
				const authorization =
					new Headers(init?.headers).get("Authorization") ?? "";
				authorizations.push(authorization);
				if (init?.method === "POST") {
					return jsonResponse(
						{
							success: true,
							data: { sessionId: "ses-1", status: "provisioning" },
						},
						201,
					);
				}
				if (authorization === `Bearer ${original}`) {
					return jsonResponse(
						{ success: false, error: "authentication required" },
						401,
					);
				}
				return jsonResponse({
					success: true,
					data: { sessionId: "ses-1", status: "ready" },
				});
			},
		});

		await expect(
			api.create({
				modelId: "model",
				repoUrl: "https://github.com/cline/test",
			}),
		).resolves.toMatchObject({ cleanupAuthToken: refreshed });
		expect(authorizations).toEqual([
			`Bearer ${original}`,
			`Bearer ${original}`,
			`Bearer ${refreshed}`,
		]);
	});

	it("does not switch accounts while refreshing provisioning auth", async () => {
		const original = jwtFor("user-1", "original");
		const otherAccount = jwtFor("user-2", "refreshed");
		const tokens = [original, otherAccount];
		let statusCalls = 0;
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => tokens.shift(),
			fetch: async (_input, init) => {
				if (init?.method === "POST") {
					return jsonResponse(
						{
							success: true,
							data: { sessionId: "ses-1", status: "provisioning" },
						},
						201,
					);
				}
				statusCalls += 1;
				return jsonResponse(
					{ success: false, error: "authentication required" },
					401,
				);
			},
		});

		await expect(
			api.create({
				modelId: "model",
				repoUrl: "https://github.com/cline/test",
			}),
		).rejects.toMatchObject({ code: "authentication_required" });
		expect(statusCalls).toBe(1);
	});

	it("waits for a recovered provisioning session before returning it", async () => {
		vi.useFakeTimers();
		let statusCalls = 0;
		let recoveryTitle = "";
		try {
			const now = new Date().toISOString();
			const api = new CloudSessionApi({
				apiBaseUrl: "https://api.example",
				appBaseUrl: "https://app.example",
				getAuthToken: async () => "workos:fresh",
				fetch: async (input, init) => {
					const path = new URL(String(input)).pathname;
					if (init?.method === "POST") {
						recoveryTitle = String(JSON.parse(String(init.body)).title);
						return jsonResponse({ success: false, error: "gateway" }, 500);
					}
					if (path.endsWith("/status")) {
						statusCalls += 1;
						return jsonResponse({
							success: true,
							data: {
								sessionId: "ses-recovered",
								status: statusCalls === 1 ? "provisioning" : "ready",
							},
						});
					}
					return jsonResponse({
						success: true,
						data: [
							{
								id: "ses-recovered",
								title: recoveryTitle,
								status: "provisioning",
								sandboxUrl: "",
								repoContext: { repoUrl: "https://github.com/cline/test" },
								metadata: { modelId: "anthropic/claude-sonnet-5" },
								createdAt: now,
								updatedAt: now,
							},
						],
					});
				},
			});

			const creating = api.create({
				modelId: "anthropic/claude-sonnet-5",
				repoUrl: "https://github.com/cline/test",
			});
			await vi.waitFor(() => expect(statusCalls).toBe(1));
			await vi.advanceTimersByTimeAsync(3_000);

			await expect(creating).resolves.toMatchObject({
				sessionId: "ses-recovered",
			});
			expect(statusCalls).toBe(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("uses a fresh timeout while recovering after the create request times out", async () => {
		vi.useFakeTimers();
		let statusCalls = 0;
		let recoveryTitle = "";
		try {
			const now = new Date().toISOString();
			const api = new CloudSessionApi({
				apiBaseUrl: "https://api.example",
				appBaseUrl: "https://app.example",
				createTimeoutMs: 100,
				getAuthToken: async () => "workos:fresh",
				fetch: async (input, init) => {
					const path = new URL(String(input)).pathname;
					if (init?.method === "POST") {
						recoveryTitle = String(JSON.parse(String(init.body)).title);
						return await new Promise<Response>((_resolve, reject) => {
							init.signal?.addEventListener(
								"abort",
								() => reject(init.signal?.reason),
								{ once: true },
							);
						});
					}
					if (path.endsWith("/status")) {
						statusCalls += 1;
						return jsonResponse({
							success: true,
							data: { sessionId: "ses-recovered", status: "ready" },
						});
					}
					return jsonResponse({
						success: true,
						data: [
							{
								id: "ses-recovered",
								title: recoveryTitle,
								status: "provisioning",
								sandboxUrl: "",
								repoContext: { repoUrl: "https://github.com/cline/test" },
								metadata: { modelId: "anthropic/claude-sonnet-5" },
								createdAt: now,
								updatedAt: now,
							},
						],
					});
				},
			});

			const creating = api.create({
				modelId: "anthropic/claude-sonnet-5",
				repoUrl: "https://github.com/cline/test",
			});
			await vi.advanceTimersByTimeAsync(100);

			await expect(creating).resolves.toMatchObject({
				sessionId: "ses-recovered",
			});
			expect(statusCalls).toBe(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("rejects and deletes a recovered session that failed provisioning", async () => {
		let recoveryTitle = "";
		let deleted = false;
		const now = new Date().toISOString();
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "workos:fresh",
			fetch: async (input, init) => {
				const path = new URL(String(input)).pathname;
				if (init?.method === "POST") {
					recoveryTitle = String(JSON.parse(String(init.body)).title);
					return jsonResponse({ success: false, error: "gateway" }, 500);
				}
				if (init?.method === "DELETE") {
					expect(path).toBe("/api/v1/session/ses-outer");
					deleted = true;
					return jsonResponse({ success: true, data: {} });
				}
				if (path.endsWith("/status")) {
					return jsonResponse({
						success: true,
						data: { status: "failed", statusReason: "clone failed" },
					});
				}
				return jsonResponse({
					success: true,
					data: [
						{
							...REMOTE_SESSION,
							title: recoveryTitle,
							status: "failed",
							createdAt: now,
							updatedAt: now,
						},
					],
				});
			},
		});

		await expect(
			api.create({
				modelId: REMOTE_SESSION.metadata.modelId ?? "",
				repoUrl: REMOTE_SESSION.repoContext.repoUrl ?? "",
			}),
		).rejects.toMatchObject({ code: "session_failed" });
		expect(deleted).toBe(true);
	});

	it("recovers a create accepted before a raw network failure", async () => {
		let recoveryTitle = "";
		let listCalls = 0;
		const now = new Date().toISOString();
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "sk_test",
			fetch: async (_input, init) => {
				if (init?.method === "POST") {
					recoveryTitle = String(JSON.parse(String(init.body)).title);
					throw new TypeError("fetch failed");
				}
				listCalls += 1;
				return jsonResponse({
					success: true,
					data: [
						{
							...REMOTE_SESSION,
							id: "ses-recovered",
							title: recoveryTitle,
							createdAt: now,
							updatedAt: now,
						},
					],
				});
			},
		});

		await expect(
			api.create({
				requestId: "request-a",
				modelId: REMOTE_SESSION.metadata.modelId ?? "",
				repoUrl: REMOTE_SESSION.repoContext.repoUrl ?? "",
			}),
		).resolves.toMatchObject({ sessionId: "ses-recovered" });
		expect(listCalls).toBe(1);
	});

	it("does not recover another process's identical session", async () => {
		const now = new Date().toISOString();
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "sk_test",
			fetch: async (_input, init) =>
				init?.method === "POST"
					? jsonResponse({ success: false, error: "gateway timeout" }, 500)
					: jsonResponse({
							success: true,
							data: [
								{
									...REMOTE_SESSION,
									id: "ses-other-process",
									title: "__cline_create_request__:other-request",
									createdAt: now,
									updatedAt: now,
								},
							],
						}),
		});

		await expect(
			api.create({
				requestId: "this-request",
				modelId: REMOTE_SESSION.metadata.modelId ?? "",
				repoUrl: REMOTE_SESSION.repoContext.repoUrl ?? "",
			}),
		).rejects.toMatchObject({ code: "request_failed" });
	});

	it("hides temporary create request titles from session lists", async () => {
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "sk_test",
			fetch: async () =>
				jsonResponse({
					success: true,
					data: [
						{
							...REMOTE_SESSION,
							title: "__cline_create_request__:request-a",
						},
					],
				}),
		});

		await expect(api.list()).resolves.toEqual([
			expect.objectContaining({
				id: "ses-outer",
				title: undefined,
				metadata: expect.objectContaining({
					createRequestTitle: "__cline_create_request__:request-a",
				}),
			}),
		]);
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
			nextToken: "",
		});
		expect(requestedPaths).toEqual([
			"/api/v1/integrations/github/repositories",
			"/api/v1/integrations/github/repositories/42/branches",
		]);
	});

	it("reads paginated branch responses and forwards search cursors", async () => {
		let requestedUrl = "";
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "workos:test",
			fetch: async (input) => {
				requestedUrl = String(input);
				return jsonResponse({
					success: true,
					data: {
						items: [{ name: "feature/cloud" }],
						nextToken: "next/page",
					},
				});
			},
		});

		expect(
			await api.listBranches(42, undefined, {
				cursor: "search cursor",
				query: "feature/cloud",
			}),
		).toEqual({
			available: true,
			branches: ["feature/cloud"],
			nextToken: "next/page",
		});
		const url = new URL(requestedUrl);
		expect(url.pathname).toBe(
			"/api/v1/integrations/github/repositories/42/branches",
		);
		expect(url.searchParams.get("query")).toBe("feature/cloud");
		expect(url.searchParams.get("cursor")).toBe("search cursor");
	});

	it("filters legacy branch responses while backends roll out", async () => {
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "workos:test",
			fetch: async () =>
				jsonResponse({
					success: true,
					data: [{ name: "main" }, { name: "feature/cloud" }],
				}),
		});

		expect(await api.listBranches(42, undefined, { query: "FEATURE" })).toEqual(
			{
				available: true,
				branches: ["feature/cloud"],
				nextToken: "",
			},
		);
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

	it("refuses ambiguous recovery for overlapping identical create requests", async () => {
		const now = new Date().toISOString();
		const record = (id: string, createdAt: string) => ({
			id,
			title: "__cline_create_request__:same-request",
			status: "running",
			sandboxUrl: `pod-${id}`,
			repoContext: { repoUrl: "https://github.com/cline/test" },
			metadata: { modelId: "anthropic/claude-sonnet-5" },
			createdAt,
			updatedAt: createdAt,
		});
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "sk_test",
			fetch: async (_input, init) =>
				init?.method === "POST"
					? jsonResponse({ success: false, error: "gateway timeout" }, 500)
					: jsonResponse({
							success: true,
							data: [
								record("ses-newer", now),
								record("ses-older", new Date(Date.now() - 1_000).toISOString()),
							],
						}),
		});
		const input = {
			requestId: "same-request",
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
		};

		// The API exposes no request id that can map either failed POST to one of
		// these rows. Newest-wins can steal another conversation's sandbox.
		const results = await Promise.allSettled([
			api.create(input),
			api.create(input),
		]);

		expect(results.map((result) => result.status)).toEqual([
			"rejected",
			"rejected",
		]);
		for (const result of results) {
			if (result.status === "rejected") {
				expect(result.reason).toMatchObject({ code: "request_failed" });
				expect(String(result.reason)).toContain("ambiguous result");
			}
		}
	});

	it("cleans up terminal provisioning failures with the creation identity", async () => {
		const authorizations: string[] = [];
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "workos:create",
			fetch: async (input, init) => {
				authorizations.push(
					new Headers(init?.headers).get("Authorization") ?? "",
				);
				if (init?.method === "POST") {
					return jsonResponse({
						success: true,
						data: { sessionId: "ses-failed", status: "provisioning" },
					});
				}
				if (init?.method === "DELETE") {
					expect(new URL(String(input)).pathname).toBe("/api/v1/session/ses-failed");
					return new Response(undefined, { status: 204 });
				}
				expect(new URL(String(input)).pathname).toBe(
					"/api/v1/session/ses-failed/status",
				);
				return jsonResponse({
					success: true,
					data: {
						sessionId: "ses-failed",
						status: "failed",
						statusReason: "clone failed",
					},
				});
			},
		});

		await expect(
			api.create({
				modelId: "model",
				repoUrl: "https://github.com/cline/test",
			}),
		).rejects.toMatchObject({ code: "session_failed", detail: "clone failed" });
		expect(authorizations).toEqual([
			"Bearer workos:create",
			"Bearer workos:create",
			"Bearer workos:create",
		]);
	});

	it("turns a generic forbidden response into actionable account guidance", async () => {
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "workos:test",
			fetch: async () =>
				jsonResponse({ success: false, error: "forbidden" }, 403),
		});

		const error = await api
			.create({ modelId: "model", repoUrl: "https://github.com/cline/test" })
			.catch((caught) => caught);

		expect(error).toBeInstanceOf(CloudSessionError);
		expect(error.code).toBe("request_failed");
		expect(error.status).toBe(403);
		expect(error.message).toContain(
			"Switch to Personal or another organization in Settings → Account",
		);
	});

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

	it("does not run list recovery after a fast client-side rejection", async () => {
		let listRequests = 0;
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "sk_test",
			fetch: async (_input, init) => {
				if (init?.method === "POST") {
					return jsonResponse({ success: false, error: "invalid branch" }, 422);
				}
				listRequests += 1;
				return jsonResponse({ success: true, data: [] });
			},
		});

		await expect(
			api.create({
				modelId: "anthropic/claude-sonnet-5",
				repoUrl: "https://github.com/cline/test",
			}),
		).rejects.toThrow(/invalid branch/);
		// A 4xx never provisioned anything; recovering on it could adopt an
		// identical-config session created by another device on the account.
		expect(listRequests).toBe(0);
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

describe("cloud session discovery", () => {
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
});

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
});
