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
});
