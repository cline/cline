import {
	CloudHandoffTranscriptMismatchError,
	cloudHandoffTranscriptsEqual,
	HubCommandError,
	HubTransportError,
} from "@cline/core";
import type { HubEventEnvelope, MessageWithMetadata } from "@cline/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handleChatSessionCommand } from "./chat-session";
import {
	CloudHandoffSeedUnsupportedError,
	type CloudProvisioningPhase,
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

describe("cloud handoff transcript comparison", () => {
	it("compares roles and rich image content exactly", () => {
		const expected = [
			{
				role: "user",
				content: [
					{ type: "text", text: "inspect this" },
					{ type: "image", source: { type: "base64", data: "abc" } },
				],
				metadata: { localOnly: true },
			},
		];
		expect(
			cloudHandoffTranscriptsEqual(expected, [
				{ ...expected[0], metadata: { cloudOnly: true } },
			]),
		).toBe(true);
		expect(
			cloudHandoffTranscriptsEqual(expected, [
				{
					...expected[0],
					content: [
						{ type: "text", text: "inspect this" },
						{ type: "image", source: { type: "base64", data: "xyz" } },
					],
				},
			]),
		).toBe(false);
	});
});

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
	} as unknown as SidecarContext;
	return { ctx, events };
}

describe("cloud handoff target existence", () => {
	function createManager(status: () => Promise<unknown>): CloudSessionManager {
		const { ctx } = createContext();
		return new CloudSessionManager(ctx, {
			api: { status } as never,
			getAuthToken: async () => "token",
			apiBaseUrl: "https://api.example.com",
		});
	}

	it("reports an existing target without waiting for provisioning", async () => {
		await expect(
			createManager(async () => ({
				status: "provisioning",
			})).handoffTargetExists("ses-existing"),
		).resolves.toBe(true);
	});

	it.each([
		"session_not_found",
		"session_expired",
	] as const)("treats %s as authoritative absence", async (code) => {
		await expect(
			createManager(async () => {
				throw new CloudSessionError(code, "gone");
			}).handoffTargetExists("ses-gone"),
		).resolves.toBe(false);
	});

	it("does not treat transient lookup failures as absence", async () => {
		await expect(
			createManager(async () => {
				throw new CloudSessionError("request_failed", "unavailable");
			}).handoffTargetExists("ses-unknown"),
		).rejects.toMatchObject({ code: "request_failed" });
	});
});

class FakeHubClient {
	events?: (event: HubEventEnvelope) => void;
	disposed = false;
	failNextSend = false;
	onFailedSend?: () => void;
	commandHook?: (command: string) => void | Promise<void>;
	invalidMessagesSnapshot = false;
	malformedQueueReply = false;
	listedModel?: string;
	attachedModel?: string;
	sessionStatus?: string;
	sessionRows?: Array<Record<string, unknown>>;
	subscriptionSessionId?: string;
	readonly subscriptionSessionIds: Array<string | undefined> = [];
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
						this.sessionRows ??
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
	it("never adopts a list-recovered session for a handoff without request identity", async () => {
		const now = new Date().toISOString();
		const onOuterSessionCreated = vi.fn();
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "workos:fresh",
			fetch: async (_input, init) =>
				init?.method === "POST"
					? jsonResponse({ success: false, error: "gateway timeout" }, 500)
					: jsonResponse({
							success: true,
							data: [
								{
									id: "ses-unproven",
									status: "ready",
									sandboxUrl: "https://pod.example",
									repoContext: {
										repoUrl: "https://github.com/cline/test",
									},
									metadata: { modelId: "model" },
									createdAt: now,
									updatedAt: now,
								},
							],
						}),
		});

		const error = await api
			.create({
				modelId: "model",
				repoUrl: "https://github.com/cline/test",
				handoff: {
					sourceSessionId: "local-1",
					resolveMessages: async () => [],
					onOuterSessionCreated,
				},
			})
			.catch((caught) => caught);

		expect(error).toMatchObject({
			code: "request_failed",
			connectUrl: "https://app.example/agents",
		});
		expect(String(error)).toContain("cannot prove it created it");
		expect(onOuterSessionCreated).not.toHaveBeenCalled();
	});

	it("reports the outer id before returning and keeps handoff hooks off the wire", async () => {
		let postedBody: Record<string, unknown> | undefined;
		const order: string[] = [];
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "workos:fresh",
			fetch: async (_input, init) => {
				postedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
				return jsonResponse({
					success: true,
					data: {
						sessionId: "ses-handoff",
						sandboxUrl: "https://pod.example",
						status: "ready",
					},
				});
			},
		});

		const created = await api.create({
			modelId: "model",
			repoUrl: "https://github.com/cline/test",
			handoff: {
				sourceSessionId: "local-1",
				resolveMessages: async () => [],
				onOuterSessionCreated: async (sessionId) => {
					order.push(`pending:${sessionId}`);
				},
			},
		});
		order.push("returned");

		expect(order).toEqual(["pending:ses-handoff", "returned"]);
		expect(created.sessionId).toBe("ses-handoff");
		expect(postedBody).toEqual({
			modelId: "model",
			repoUrl: "https://github.com/cline/test",
		});
	});

	it("deletes a new outer session when its local recovery record cannot be saved", async () => {
		const methods: string[] = [];
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "workos:fresh",
			fetch: async (_input, init) => {
				methods.push(init?.method ?? "GET");
				if (init?.method === "DELETE") {
					return new Response(undefined, { status: 204 });
				}
				return jsonResponse({
					success: true,
					data: {
						sessionId: "ses-unrecorded",
						sandboxUrl: "https://pod.example",
						status: "ready",
					},
				});
			},
		});

		await expect(
			api.create({
				modelId: "model",
				repoUrl: "https://github.com/cline/test",
				handoff: {
					sourceSessionId: "local-1",
					resolveMessages: async () => [],
					onOuterSessionCreated: async () => {
						throw new Error("metadata write failed");
					},
				},
			}),
		).rejects.toThrow("metadata write failed");
		expect(methods).toEqual(["POST", "DELETE"]);
	});

	it("surfaces the recovery URL when an unrecorded outer session cannot be cleaned up", async () => {
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "workos:fresh",
			fetch: async (_input, init) => {
				if (init?.method === "DELETE") {
					return jsonResponse({ error: "cleanup unavailable" }, 503);
				}
				return jsonResponse({
					success: true,
					data: {
						sessionId: "ses-needs-recovery",
						sandboxUrl: "https://pod.example",
						status: "ready",
					},
				});
			},
		});

		await expect(
			api.create({
				modelId: "model",
				repoUrl: "https://github.com/cline/test",
				handoff: {
					sourceSessionId: "local-1",
					resolveMessages: async () => [],
					onOuterSessionCreated: async () => {
						throw new Error("metadata write failed");
					},
				},
			}),
		).rejects.toThrow(
			"Cloud session ses-needs-recovery: https://app.example/agents?sessionId=ses-needs-recovery",
		);
	});

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
		});
		expect(body?.title).toEqual(
			expect.stringMatching(/^__cline_create_request__:/),
		);
		expect(body).not.toHaveProperty("branch");
	});

	it("waits for the current asynchronous provisioning contract", async () => {
		vi.useFakeTimers();
		let statusCalls = 0;
		const phases: Array<string | undefined> = [];
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
							phase: statusCalls === 1 ? "cloning_repo" : "ready",
						},
					});
				},
			});

			const creating = api.create(
				{
					modelId: "anthropic/claude-sonnet-5",
					repoUrl: "https://github.com/cline/test",
				},
				({ phase }) => phases.push(phase),
			);
			await vi.waitFor(() => expect(statusCalls).toBe(1));
			await vi.advanceTimersByTimeAsync(3_000);

			await expect(creating).resolves.toMatchObject({
				sessionId: "ses-1",
				sandboxUrl: "",
			});
			expect(statusCalls).toBe(2);
			expect(phases).toEqual(["cloning_repo", "ready"]);
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

	it("cleans up terminal provisioning failures with the creation identity", async () => {
		const authorizations: string[] = [];
		const removed = vi.fn();
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
				handoff: {
					sourceSessionId: "local-1",
					resolveMessages: async () => [],
					onOuterSessionCreated: async () => undefined,
					onOuterSessionRemoved: removed,
				},
			}),
		).rejects.toMatchObject({ code: "session_failed", detail: "clone failed" });
		expect(removed).toHaveBeenCalledWith("ses-failed");
		expect(authorizations).toEqual([
			"Bearer workos:create",
			"Bearer workos:create",
			"Bearer workos:create",
		]);
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

	it("recovery never steals a session whose successful POST is still completing", async () => {
		const now = new Date().toISOString();
		let releaseSlowCreate!: () => void;
		const slowCreateBlocked = new Promise<void>((resolve) => {
			releaseSlowCreate = resolve;
		});
		let posts = 0;
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "sk_test",
			fetch: async (_input, init) => {
				if (init?.method === "POST") {
					posts += 1;
					if (posts === 1) {
						// The server has already provisioned ses-inflight (it shows
						// up in the list below) but the response is still in flight.
						await slowCreateBlocked;
						return jsonResponse(
							{
								success: true,
								data: { sessionId: "ses-inflight", sandboxUrl: "pod" },
							},
							201,
						);
					}
					return jsonResponse(
						{ success: false, error: "gateway timeout" },
						500,
					);
				}
				return jsonResponse({
					success: true,
					data: [
						{
							id: "ses-inflight",
							status: "provisioning",
							sandboxUrl: "pod",
							repoContext: { repoUrl: "https://github.com/cline/test" },
							metadata: { modelId: "anthropic/claude-sonnet-5" },
							createdAt: now,
							updatedAt: now,
						},
					],
				});
			},
		});
		const input = {
			requestId: "client-start-1",
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
		};

		const slow = api.create(input);
		// Yield so the slow POST registers before the failing one starts.
		await new Promise((resolve) => setTimeout(resolve, 0));
		const failing = api.create(input);
		await new Promise((resolve) => setTimeout(resolve, 0));
		releaseSlowCreate();

		// The recovery waits for the earlier request's claim, so it cannot
		// adopt ses-inflight; with no unclaimed candidate it surfaces its own
		// failure instead of handing both composers the same sandbox.
		await expect(slow).resolves.toMatchObject({ sessionId: "ses-inflight" });
		await expect(failing).rejects.toThrow();
	});

	it("never adopts a session that a successful concurrent create already owns", async () => {
		const now = new Date().toISOString();
		let posts = 0;
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "sk_test",
			fetch: async (_input, init) => {
				if (init?.method === "POST") {
					posts += 1;
					return posts === 1
						? jsonResponse(
								{
									success: true,
									data: { sessionId: "ses-owned", sandboxUrl: "pod" },
								},
								201,
							)
						: jsonResponse({ success: false, error: "gateway timeout" }, 500);
				}
				return jsonResponse({
					success: true,
					data: [
						{
							id: "ses-owned",
							status: "running",
							sandboxUrl: "pod",
							repoContext: { repoUrl: "https://github.com/cline/test" },
							metadata: { modelId: "anthropic/claude-sonnet-5" },
							createdAt: now,
							updatedAt: now,
						},
					],
				});
			},
		});
		const input = {
			requestId: "client-start-1",
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
		};

		await expect(api.create(input)).resolves.toMatchObject({
			sessionId: "ses-owned",
		});
		// The only listed candidate is already owned; surface the failure
		// instead of silently attaching to the first request's session.
		await expect(api.create(input)).rejects.toThrow();
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

	it("an earlier failing create waits out a later in-flight POST instead of adopting its session", async () => {
		const now = new Date().toISOString();
		let posts = 0;
		let releaseSlowCreate!: () => void;
		const slowCreateBlocked = new Promise<void>((resolve) => {
			releaseSlowCreate = resolve;
		});
		let announceSecondPost!: () => void;
		const secondPostStarted = new Promise<void>((resolve) => {
			announceSecondPost = resolve;
		});
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "sk_test",
			fetch: async (_input, init) => {
				if (init?.method === "POST") {
					posts += 1;
					if (posts === 1) {
						// The earlier request fails only once the later POST is
						// in flight — the inverted direction of the claim race.
						await secondPostStarted;
						return jsonResponse(
							{ success: false, error: "gateway timeout" },
							500,
						);
					}
					announceSecondPost();
					await slowCreateBlocked;
					return jsonResponse(
						{
							success: true,
							data: { sessionId: "ses-inflight", sandboxUrl: "pod" },
						},
						201,
					);
				}
				return jsonResponse({
					success: true,
					data: [
						{
							id: "ses-inflight",
							status: "provisioning",
							sandboxUrl: "pod",
							repoContext: { repoUrl: "https://github.com/cline/test" },
							metadata: { modelId: "anthropic/claude-sonnet-5" },
							createdAt: now,
							updatedAt: now,
						},
					],
				});
			},
		});
		const input = {
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
		};

		const failing = api.create(input);
		await new Promise((resolve) => setTimeout(resolve, 0));
		const slow = api.create(input);
		await secondPostStarted;
		// Give the failing request time to reach its recovery wait; it must
		// block on the later peer instead of adopting ses-inflight.
		await new Promise((resolve) => setTimeout(resolve, 0));
		releaseSlowCreate();

		await expect(slow).resolves.toMatchObject({ sessionId: "ses-inflight" });
		await expect(failing).rejects.toThrow();
	});

	it("rechecks peers that start while the recovery list is loading", async () => {
		const now = new Date().toISOString();
		let releaseSuccessfulPost!: () => void;
		const successfulPostBlocked = new Promise<void>((resolve) => {
			releaseSuccessfulPost = resolve;
		});
		let releaseRecoveryList!: () => void;
		const recoveryListBlocked = new Promise<void>((resolve) => {
			releaseRecoveryList = resolve;
		});
		let announceRecoveryList!: () => void;
		const recoveryListStarted = new Promise<void>((resolve) => {
			announceRecoveryList = resolve;
		});
		let posts = 0;
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "sk_test",
			fetch: async (_input, init) => {
				if (init?.method === "POST") {
					posts += 1;
					if (posts === 1) {
						return jsonResponse(
							{ success: false, error: "gateway timeout" },
							500,
						);
					}
					await successfulPostBlocked;
					return jsonResponse(
						{
							success: true,
							data: { sessionId: "ses-late", sandboxUrl: "pod" },
						},
						201,
					);
				}
				announceRecoveryList();
				await recoveryListBlocked;
				return jsonResponse({
					success: true,
					data: [
						{
							id: "ses-late",
							status: "running",
							sandboxUrl: "pod",
							repoContext: { repoUrl: "https://github.com/cline/test" },
							metadata: { modelId: "anthropic/claude-sonnet-5" },
							createdAt: now,
							updatedAt: now,
						},
					],
				});
			},
		});
		const input = {
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
		};

		const failing = api.create(input);
		await recoveryListStarted;
		const successful = api.create(input);
		releaseRecoveryList();
		await new Promise((resolve) => setTimeout(resolve, 0));
		releaseSuccessfulPost();

		await expect(successful).resolves.toMatchObject({ sessionId: "ses-late" });
		await expect(failing).rejects.toThrow();
	});

	it("a branchless recovery cannot adopt a branch-specific peer's in-flight session", async () => {
		const now = new Date().toISOString();
		let posts = 0;
		let releaseSlowCreate!: () => void;
		const slowCreateBlocked = new Promise<void>((resolve) => {
			releaseSlowCreate = resolve;
		});
		let announceSecondPost!: () => void;
		const secondPostStarted = new Promise<void>((resolve) => {
			announceSecondPost = resolve;
		});
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "sk_test",
			fetch: async (_input, init) => {
				if (init?.method === "POST") {
					posts += 1;
					if (posts === 1) {
						await secondPostStarted;
						return jsonResponse(
							{ success: false, error: "gateway timeout" },
							500,
						);
					}
					announceSecondPost();
					await slowCreateBlocked;
					return jsonResponse(
						{
							success: true,
							data: { sessionId: "ses-branch", sandboxUrl: "pod" },
						},
						201,
					);
				}
				return jsonResponse({
					success: true,
					data: [
						{
							id: "ses-branch",
							status: "provisioning",
							sandboxUrl: "pod",
							repoContext: {
								repoUrl: "https://github.com/cline/test",
								branch: "dev",
							},
							metadata: { modelId: "anthropic/claude-sonnet-5" },
							createdAt: now,
							updatedAt: now,
						},
					],
				});
			},
		});

		// The branchless create's recovery filter accepts any branch, so it
		// must wait on the branch-specific peer despite the different config.
		const branchless = api.create({
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		const branchSpecific = api.create({
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
			branch: "dev",
		});
		await secondPostStarted;
		await new Promise((resolve) => setTimeout(resolve, 0));
		releaseSlowCreate();

		await expect(branchSpecific).resolves.toMatchObject({
			sessionId: "ses-branch",
		});
		await expect(branchless).rejects.toThrow();
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
				lastActivityAt: "2026-08-05T10:02:00.000Z",
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
			lastActivityAt: "2026-08-05T10:02:00.000Z",
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
		hub.sessionRows = [
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

	it("uses unique Hub client ids and keeps subscriptions session-scoped", async () => {
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
		expect(hub.subscriptionSessionId).toBe("ses-outer");
		await manager.dispose();
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
		const previous: MessageWithMetadata[] = [
			{ role: "assistant", content: "keep me" },
		];
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
				list: async () => [
					{
						...REMOTE_SESSION,
						metadata: { ...REMOTE_SESSION.metadata, taskId: "task-created" },
					},
				],
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
					requestedSessionId: "task-created",
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

	it("retries only the transient GitHub installation-token failure", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient(false);
		const create = vi
			.fn()
			.mockRejectedValueOnce(
				new CloudSessionError(
					"request_failed",
					"couldn't authenticate with GitHub; try reconnecting the integration",
					undefined,
					502,
				),
			)
			.mockRejectedValueOnce(
				new CloudSessionError(
					"request_failed",
					"couldn't authenticate with GitHub; try reconnecting the integration",
					undefined,
					502,
				),
			)
			.mockResolvedValue({ sessionId: "ses-retried", sandboxUrl: "pod" });
		const sleep = vi.fn(async () => undefined);
		const manager = new CloudSessionManager(ctx, {
			api: { create, list: async () => [] } as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
			sleep,
		});

		await expect(
			manager.create({
				modelId: "model",
				repoUrl: "https://github.com/cline/test",
			}),
		).resolves.toMatchObject({ sessionId: "ses-retried" });
		expect(create).toHaveBeenCalledTimes(3);
		expect(sleep.mock.calls).toEqual([[500], [1000]]);
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

	it("persists the outer handoff before seeding rich initial messages", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient(false);
		const order: string[] = [];
		const initialMessages = [
			{
				role: "user" as const,
				content: [
					{ type: "text" as const, text: "continue with this image" },
					{
						type: "image" as const,
						data: "abc",
						mediaType: "image/png",
					},
				],
			},
		];
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [],
				create: async (input: {
					handoff?: {
						onOuterSessionCreated(id: string): Promise<void>;
					};
				}) => {
					await input.handoff?.onOuterSessionCreated("ses-handoff");
					order.push("provisioned");
					return { sessionId: "ses-handoff", sandboxUrl: "pod" };
				},
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});

		const created = await manager.create({
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
			branch: "main",
			mode: "plan",
			workspaceRelativePath: "apps/examples/desktop-app",
			handoff: {
				sourceSessionId: "local-1",
				onOuterSessionCreated: async () => {
					order.push("pending");
				},
				resolveMessages: async () => {
					order.push("read-live");
					return initialMessages;
				},
				onSeeding: () => order.push("seeding"),
			},
		});

		expect(order).toEqual(["pending", "provisioned", "read-live", "seeding"]);
		expect(created).toMatchObject({
			sessionId: "ses-handoff",
			innerSessionId: "inner-created",
		});
		const innerCreate = hub.commands.find(
			(entry) => entry.command === "session.create",
		);
		expect(innerCreate?.payload).toMatchObject({
			workspaceRoot: "/workspace",
			cwd: "/workspace/apps/examples/desktop-app",
			initialMessages,
			sessionConfig: {
				workspaceRoot: "/workspace",
				cwd: "/workspace/apps/examples/desktop-app",
				mode: "plan",
			},
			runtimeOptions: { mode: "plan" },
			metadata: {
				handoff: {
					from: "local",
					sourceSessionId: "local-1",
					outerSessionId: "ses-handoff",
				},
			},
		});
		expect(
			(innerCreate?.payload?.sessionConfig as { systemPrompt?: string })
				.systemPrompt,
		).toContain("fresh clone");
	});

	it("verifies handoff seeding from the live Hub without archive fallback", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient(false);
		const expected = [{ role: "user" as const, content: "continue" }];
		const history = vi.fn(async () => expected);
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [],
				create: async () => ({ sessionId: "ses-handoff", sandboxUrl: "pod" }),
				history,
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.create({
			modelId: "model",
			repoUrl: "https://github.com/cline/test",
			handoff: {
				sourceSessionId: "local-1",
				resolveMessages: async () => expected,
				onOuterSessionCreated: async () => undefined,
			},
		});
		hub.commandHook = (command) => {
			if (command === "session.messages") throw new Error("live read failed");
		};

		await expect(
			manager.verifyHandoffTranscript("ses-handoff", expected),
		).rejects.toThrow("live read failed");
		expect(history).not.toHaveBeenCalled();
	});

	it("identifies a runtime that ignored seeded initialMessages", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient(false);
		hub.messages = [];
		const expected = [{ role: "user" as const, content: "continue" }];
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [],
				create: async () => ({ sessionId: "ses-handoff", sandboxUrl: "pod" }),
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.create({
			modelId: "model",
			repoUrl: "https://github.com/cline/test",
			handoff: {
				sourceSessionId: "local-1",
				resolveMessages: async () => expected,
				onOuterSessionCreated: async () => undefined,
			},
		});

		const error = await manager
			.verifyHandoffTranscript("ses-handoff", expected)
			.catch((caught) => caught);
		expect(error).toBeInstanceOf(CloudHandoffSeedUnsupportedError);
		expect(String(error)).toContain("must use @cline/core 0.0.72 or newer");
	});

	it("accepts newer cloud turns after the seeded transcript on resume", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		const expected = [{ role: "user" as const, content: "continue" }];
		hub.messages = [
			...expected,
			{ role: "assistant", content: "continued in cloud" },
		];
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});
		await manager.list();

		await expect(
			manager.verifyHandoffTranscript("ses-outer", expected, {
				allowAppendedMessages: true,
			}),
		).resolves.toBeUndefined();
		await expect(
			manager.verifyHandoffTranscript("ses-outer", expected),
		).rejects.toBeInstanceOf(CloudHandoffTranscriptMismatchError);
	});

	it("reuses only one inner session owned by the same handoff source", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		hub.sessionRows = [
			{
				sessionId: "inner-handoff",
				metadata: {
					handoff: { sourceSessionId: "local-1" },
				},
			},
		];
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});

		const seeded = await manager.seedHandoff("ses-outer", {
			sourceSessionId: "local-1",
			messages: [{ role: "user", content: "continue" }],
		});

		expect(seeded.innerSessionId).toBe("inner-handoff");
		expect(
			hub.commands.some((entry) => entry.command === "session.create"),
		).toBe(false);
	});

	it.each([
		{
			name: "an unrelated inner session",
			rows: [
				{
					sessionId: "inner-unrelated",
					metadata: { handoff: { sourceSessionId: "another-local" } },
				},
			],
		},
		{
			name: "multiple inner sessions",
			rows: [
				{
					sessionId: "inner-handoff",
					metadata: { handoff: { sourceSessionId: "local-1" } },
				},
				{
					sessionId: "inner-other",
					metadata: { handoff: { sourceSessionId: "local-1" } },
				},
			],
		},
	])("refuses handoff adoption with $name", async ({ rows }) => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		hub.sessionRows = rows;
		const manager = new CloudSessionManager(ctx, {
			api: { list: async () => [REMOTE_SESSION] } as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			createHubClient: () => hub as never,
		});

		await expect(
			manager.seedHandoff("ses-outer", {
				sourceSessionId: "local-1",
				messages: [{ role: "user", content: "continue" }],
			}),
		).rejects.toThrow("already contains another conversation");
		expect(
			hub.commands.some((entry) => entry.command === "session.create"),
		).toBe(false);
	});

	it("revalidates all inner sessions before reusing a cached handoff connection", async () => {
		const { ctx } = createContext();
		const hub = new FakeHubClient();
		hub.sessionRows = [
			{
				sessionId: "inner-handoff",
				metadata: { handoff: { sourceSessionId: "local-1" } },
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
		hub.sessionRows = [
			{
				sessionId: "inner-handoff",
				metadata: { handoff: { sourceSessionId: "local-1" } },
			},
			{
				sessionId: "inner-sibling",
				metadata: { handoff: { sourceSessionId: "another-local" } },
			},
		];

		await expect(
			manager.seedHandoff("ses-outer", {
				sourceSessionId: "local-1",
				messages: [{ role: "user", content: "continue" }],
			}),
		).rejects.toThrow("already contains another conversation");
		expect(
			hub.commands.some((entry) => entry.command === "session.create"),
		).toBe(false);
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

	it("forwards image-only cloud messages and rejects file attachments", async () => {
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

	it("confirms a queued prompt after an ambiguous command timeout", async () => {
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
		hub.commandHook = (command) => {
			if (command !== "session.send_input") return;
			hub.commandHook = undefined;
			hub.prompts.push({
				id: "q-timeout",
				prompt: "Queued before the timeout",
				delivery: "queue",
				attachmentCount: 0,
			});
			throw new HubCommandError(
				"session.send_input",
				"hub_command_timeout",
				"timed out",
			);
		};

		await expect(
			manager.send("ses-outer", "Queued before the timeout", "queue"),
		).resolves.toMatchObject({
			ok: true,
			queued: true,
			recoveredAfterDisconnect: true,
		});
		expect(
			hub.commands.filter((entry) => entry.command === "session.send_input"),
		).toHaveLength(1);
	});

	it("does not advise resending when queue recovery itself is unavailable", async () => {
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
		hub.malformedQueueReply = true;

		await expect(
			manager.send("ses-outer", "Possibly queued", "queue"),
		).rejects.toThrow(/check the cloud session before resending/i);
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
		await manager.list();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(hub.disposed).toBe(true);
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
			resolve: cloudResolve,
		});
		ctx.pendingApprovals.set("local-1:app-2", {
			item: {
				...approvalItem,
				requestId: "local-1:app-2",
				sessionId: "local-1",
			},
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
		let serverReady = false;
		let finishCreate:
			| ((value: { sessionId: string; sandboxUrl: string }) => void)
			| undefined;
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [
					{
						...REMOTE_SESSION,
						id: "ses-created",
						status: serverReady ? "ready" : "provisioning",
					},
					{ ...REMOTE_SESSION, id: "ses-failed", status: "failed" },
				],
				create: (
					_input: unknown,
					onStatus?: (status: { phase?: CloudProvisioningPhase }) => void,
				) =>
					new Promise((resolve) => {
						onStatus?.({ phase: "cloning_repo" });
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
		expect(during.some((session) => session.sessionId === "ses-failed")).toBe(
			true,
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
		).resolves.toEqual({ status: "provisioning", phase: "cloning_repo" });
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

	it("single-flights identical cloud creates", async () => {
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

	it("falls back to a cached cloud session when fresh discovery fails", async () => {
		const { ctx } = createContext();
		let listCalls = 0;
		let failListing = false;
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => {
					listCalls += 1;
					if (failListing) throw new Error("environment lookup failed");
					return [REMOTE_SESSION];
				},
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
		});
		await manager.list();
		ctx.cloudSessionManager = manager;
		failListing = true;

		await expect(
			handleCommand(ctx, "get_discovered_session", {
				session_id: "ses-outer",
			}),
		).resolves.toEqual(
			expect.objectContaining({
				sessionId: "ses-outer",
				origin: "cloud",
			}),
		);
		expect(listCalls).toBe(2);
	});

	it("does not reopen a cached cloud session removed on another device", async () => {
		const { ctx } = createContext();
		let sessions = [REMOTE_SESSION];
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => sessions,
				status: async () => {
					throw new CloudSessionError("session_not_found", "gone");
				},
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
		});
		await manager.list();
		ctx.cloudSessionManager = manager;
		sessions = [];

		await expect(
			handleCommand(ctx, "get_discovered_session", {
				session_id: "ses-outer",
			}),
		).resolves.toBeNull();
	});

	it("opens a cached session from another scope after id revalidation", async () => {
		const { ctx } = createContext();
		let sessions = [REMOTE_SESSION];
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => sessions,
				status: async () => ({ status: "ready" }),
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
		});
		await manager.list();
		ctx.cloudSessionManager = manager;
		sessions = [];

		await expect(
			handleCommand(ctx, "get_discovered_session", {
				session_id: "ses-outer",
			}),
		).resolves.toEqual(
			expect.objectContaining({ sessionId: "ses-outer", status: "ready" }),
		);
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

	it("keeps an explicitly personal handoff out of the active organization", async () => {
		const { ctx } = createContext();
		let createInput: Record<string, unknown> | undefined;
		const scopeLookup = vi.fn(async () => "org-cline-bot");
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [],
				create: async (input: Record<string, unknown>) => {
					createInput = input;
					return { sessionId: "ses-personal", sandboxUrl: "pod" };
				},
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			getActiveOrganizationId: scopeLookup,
		});

		await manager.create({
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
			organizationId: null,
		});

		expect(scopeLookup).not.toHaveBeenCalled();
		expect(createInput?.organizationId).toBeUndefined();
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
