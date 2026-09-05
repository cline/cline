import { describe, expect, it, vi } from "vitest";
import {
	CloudSessionApi,
	CloudSessionError,
	type CloudSessionRecord,
} from "./cloud-sessions";

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
	return (
		"workos:" +
		encode({ alg: "none" }) +
		"." +
		encode({ sub: subject, nonce }) +
		".sig"
	);
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
					expect(new URL(String(input)).pathname).toBe(
						"/api/v1/session/ses-failed",
					);
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
