import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	CloudHandoffCreationRejectedError,
	CloudSessionApi,
	type CloudSessionApiOptions,
	CloudSessionError,
	type CloudSessionRecord,
	type CreateCloudSessionInput,
} from "./api";

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
	it.each([
		"rotated",
		"changed",
		"revoked",
	] as const)("rechecks scoped credentials before lost-create recovery: %s", async (mode) => {
		let token: string | undefined = jwtFor("original-user", "initial");
		const original = token;
		const rotated = jwtFor("original-user", "rotated");
		const requests: Array<{ method: string; authorization: string }> = [];
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => token,
			fetch: async (_input, init) => {
				requests.push({
					method: init?.method ?? "GET",
					authorization: new Headers(init?.headers).get("Authorization") ?? "",
				});
				if (init?.method === "POST") {
					token =
						mode === "rotated"
							? rotated
							: mode === "changed"
								? jwtFor("other-user", "new")
								: undefined;
					throw new Error("POST response lost");
				}
				return jsonResponse({ success: true, data: [] });
			},
		});
		await expect(
			api.create({ modelId: "model", repoUrl: "repo" }),
		).rejects.toThrow("POST response lost");
		expect(requests).toEqual([
			{ method: "POST", authorization: `Bearer ${original}` },
			...(mode === "rotated"
				? [{ method: "GET", authorization: `Bearer ${rotated}` }]
				: []),
		]);
		// Explicit credentials remain available solely for caller-authorized cleanup.
		await api.delete("created-id", original);
		expect(requests.at(-1)).toEqual({
			method: "DELETE",
			authorization: `Bearer ${original}`,
		});
	});

	it.each([
		["https://api.example", "https://api.example"],
		["https://api.example///", "https://api.example"],
		[
			`https://api.example/${"/".repeat(100_000)}base///`,
			`https://api.example/${"/".repeat(100_000)}base`,
		],
	])("trims only trailing base-URL slashes (%#)", async (baseUrl, expected) => {
		const requests: string[] = [];
		const api = new CloudSessionApi({
			apiBaseUrl: baseUrl,
			appBaseUrl: "https://app.example///",
			getAuthToken: async () => "token",
			fetch: async (input) => {
				requests.push(String(input));
				return jsonResponse({ success: true, data: [] });
			},
		});
		await api.list();
		expect(requests).toEqual([`${expected}/api/v1/session`]);
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

	it("uses the dashboard create body and includes branch only when requested", async () => {
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

		expect(bodies[0]).toMatchObject({
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
			branch: "feature/login-fix",
			title: expect.stringMatching(/^__cline_create_request__:/),
		});
		expect(bodies[1]).toMatchObject({
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
			title: expect.stringMatching(/^__cline_create_request__:/),
		});
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

	it("accepts v1 history and rejects malformed snapshots instead of returning empty history", async () => {
		const messages = [{ role: "user", content: "Hello" }];
		let snapshot: unknown = { version: 1, messages };
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "sk_test",
			fetch: async () => jsonResponse(snapshot),
		});

		expect(await api.history("ses-1")).toEqual(messages);
		snapshot = { version: 1, messages: [] };
		expect(await api.history("ses-1")).toEqual([]);
		for (const invalid of [
			null,
			{ version: 1 },
			{ version: 2, messages: [] },
		]) {
			snapshot = invalid;
			await expect(api.history("ses-1")).rejects.toMatchObject({
				code: "request_failed",
				detail: "Invalid archived session history",
			});
		}
	});

	it("returns the real id before polling readiness and reports provisioning phases", async () => {
		vi.useFakeTimers();
		const tokens = [
			...Array<string>(5).fill("workos:create"),
			"workos:new-account",
		];
		const authorizations: string[] = [];
		let statusCalls = 0;
		const phases: Array<string | undefined> = [];
		try {
			const api = new CloudSessionApi({
				apiBaseUrl: "https://api.example",
				appBaseUrl: "https://app.example",
				getAuthToken: async () => tokens.shift(),
				fetch: async (input, init) => {
					authorizations.push(
						new Headers(init?.headers).get("Authorization") ?? "",
					);
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

			const created = await api.create({
				modelId: "anthropic/claude-sonnet-5",
				repoUrl: "https://github.com/cline/test",
			});
			expect(created).toMatchObject({
				sessionId: "ses-1",
				status: "provisioning",
			});
			expect(statusCalls).toBe(0);
			const ready = api.waitUntilReady(
				created.sessionId,
				new AbortController().signal,
				({ phase }) => phases.push(phase),
			);
			await vi.waitFor(() => expect(statusCalls).toBe(1));
			await vi.advanceTimersByTimeAsync(3_000);

			await expect(ready).resolves.toBeUndefined();
			expect(statusCalls).toBe(2);
			expect(phases).toEqual(["cloning_repo", "ready"]);
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
		const tokens = [original, original, refreshed];
		const authorizations: string[] = [];
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => tokens.shift(),
			fetch: async (_input, init) => {
				const authorization =
					new Headers(init?.headers).get("Authorization") ?? "";
				authorizations.push(authorization);
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
			api.waitUntilReady("ses-1", new AbortController().signal),
		).resolves.toBeUndefined();
		expect(authorizations).toEqual([
			`Bearer ${original}`,
			`Bearer ${refreshed}`,
		]);
	});

	it("does not switch accounts while refreshing provisioning auth", async () => {
		const original = jwtFor("user-1", "original");
		const otherAccount = jwtFor("user-2", "refreshed");
		const tokens = [original, original, otherAccount];
		let statusCalls = 0;
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => tokens.shift(),
			fetch: async () => {
				statusCalls += 1;
				return jsonResponse(
					{ success: false, error: "authentication required" },
					401,
				);
			},
		});

		await expect(
			api.waitUntilReady("ses-1", new AbortController().signal),
		).rejects.toMatchObject({ code: "authentication_required" });
		expect(statusCalls).toBe(1);
	});

	it("returns a recovered real id without waiting for provisioning", async () => {
		const requests: string[] = [];
		let recoveryTitle = "";
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "workos:fresh",
			fetch: async (input, init) => {
				requests.push(
					`${init?.method ?? "GET"} ${new URL(String(input)).pathname}`,
				);
				if (init?.method === "POST") {
					recoveryTitle = String(JSON.parse(String(init.body)).title);
					return jsonResponse({ success: false, error: "gateway" }, 500);
				}
				return jsonResponse({
					success: true,
					data: [
						{
							...REMOTE_SESSION,
							id: "ses-recovered",
							title: recoveryTitle,
							status: "provisioning",
							sandboxUrl: "",
						},
					],
				});
			},
		});

		await expect(
			api.create({
				modelId: "anthropic/claude-sonnet-5",
				repoUrl: "https://github.com/cline/test",
			}),
		).resolves.toMatchObject({
			sessionId: "ses-recovered",
			status: "provisioning",
		});
		expect(requests).toEqual(["POST /api/v1/session", "GET /api/v1/session"]);
	});

	it("recovers the real id after the create request times out", async () => {
		vi.useFakeTimers();
		const requests: string[] = [];
		let recoveryTitle = "";
		try {
			const api = new CloudSessionApi({
				apiBaseUrl: "https://api.example",
				appBaseUrl: "https://app.example",
				createTimeoutMs: 100,
				getAuthToken: async () => "workos:fresh",
				fetch: async (input, init) => {
					requests.push(
						`${init?.method ?? "GET"} ${new URL(String(input)).pathname}`,
					);
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
					return jsonResponse({
						success: true,
						data: [
							{
								...REMOTE_SESSION,
								id: "ses-recovered",
								title: recoveryTitle,
								status: "provisioning",
								sandboxUrl: "",
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
			expect(requests).toEqual(["POST /api/v1/session", "GET /api/v1/session"]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("returns a failed recovered session without hiding its real id", async () => {
		let recoveryTitle = "";
		const requests: string[] = [];
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "workos:fresh",
			fetch: async (input, init) => {
				requests.push(
					`${init?.method ?? "GET"} ${new URL(String(input)).pathname}`,
				);
				if (init?.method === "POST") {
					recoveryTitle = String(JSON.parse(String(init.body)).title);
					return jsonResponse({ success: false, error: "gateway" }, 500);
				}
				return jsonResponse({
					success: true,
					data: [
						{
							...REMOTE_SESSION,
							title: recoveryTitle,
							status: "failed",
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
		).resolves.toMatchObject({ sessionId: "ses-outer", status: "failed" });
		expect(requests).toEqual(["POST /api/v1/session", "GET /api/v1/session"]);
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

		const error = await api.create(input).catch((caught) => caught);
		expect(error).toMatchObject({ code: "request_failed" });
		expect(String(error)).toContain("ambiguous result");
	});

	it("reports provisioning failure without deleting the known session", async () => {
		const authorizations: string[] = [];
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api.example",
			appBaseUrl: "https://app.example",
			getAuthToken: async () => "workos:create",
			fetch: async (input, init) => {
				authorizations.push(
					new Headers(init?.headers).get("Authorization") ?? "",
				);
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
			api.waitUntilReady("ses-failed", new AbortController().signal),
		).rejects.toMatchObject({ code: "session_failed", detail: "clone failed" });
		expect(authorizations).toEqual(["Bearer workos:create"]);
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

describe("seeded cloud provisioning recovery", () => {
	const record: CloudSessionRecord = {
		id: "ses-seeded",
		status: "ready",
		sandboxUrl: "",
		repoContext: { repoUrl: "https://github.com/cline/repo", branch: "main" },
		metadata: { modelId: "model" },
		createdAt: "2026-01-01",
		updatedAt: "2026-01-01",
	};
	const messages: MessageWithMetadata[] = [
		{ role: "user", content: [{ type: "text", text: "Prior request" }] },
		{ role: "assistant", content: [{ type: "text", text: "Prior answer" }] },
	];
	function response(data: unknown, status = 200) {
		return jsonResponse({ data }, status);
	}
	function createApi(fetch: CloudSessionApiOptions["fetch"]) {
		return new CloudSessionApi({
			apiBaseUrl: "https://api",
			appBaseUrl: "https://app",
			getAuthToken: async () => "token",
			fetch,
		});
	}
	const input = (
		hooks: Partial<NonNullable<CreateCloudSessionInput["handoff"]>> = {},
	): CreateCloudSessionInput => ({
		requestId: "handoff:source:sha",
		repoUrl: record.repoContext.repoUrl!,
		modelId: "model",
		handoff: {
			sourceSessionId: "source",
			resolveMessages: async () => messages,
			onOuterSessionCreated: async () => {},
			...hooks,
		},
	});

	it("awaits durable create intent after lookup and before any POST", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const methods: string[] = [];
		const onCreating = vi.fn(() => gate);
		const api = createApi(async (_url, init) => {
			methods.push(init?.method ?? "GET");
			return response(
				init?.method === "POST"
					? { sessionId: record.id, status: "ready" }
					: [],
			);
		});
		const creating = api.create(input({ onCreating }));
		await vi.waitFor(() => expect(onCreating).toHaveBeenCalledOnce());
		expect(methods).toEqual(["GET"]);
		release();
		await creating;
		expect(methods).toEqual(["GET", "POST"]);
	});
	it("does not POST when durable create intent cannot be saved", async () => {
		const methods: string[] = [];
		const api = createApi(async (_url, init) => {
			methods.push(init?.method ?? "GET");
			return response([]);
		});
		await expect(
			api.create(
				input({
					onCreating: async () => {
						throw new Error("intent persistence failed");
					},
				}),
			),
		).rejects.toBeInstanceOf(CloudHandoffCreationRejectedError);
		expect(methods).toEqual(["GET"]);
	});
	it.each([
		400, 401, 403, 404, 429,
	])("marks HTTP %s as definitely rejected and allows an explicit retry", async (status) => {
		let posts = 0;
		const api = createApi(async (_url, init) => {
			if (init?.method === "POST") {
				posts++;
				return response(undefined, status);
			}
			return response([]);
		});
		await expect(api.create(input())).rejects.toBeInstanceOf(
			CloudHandoffCreationRejectedError,
		);
		await expect(api.create(input())).rejects.toBeInstanceOf(
			CloudHandoffCreationRejectedError,
		);
		expect(posts).toBe(2);
	});
	it.each([
		408, 409, 500,
	])("preserves ambiguity and does not repeat a POST after HTTP %s", async (status) => {
		let posts = 0;
		const api = createApi(async (_url, init) => {
			if (init?.method === "POST") {
				posts++;
				return response(undefined, status);
			}
			return response([]);
		});
		await expect(api.create(input())).rejects.not.toBeInstanceOf(
			CloudHandoffCreationRejectedError,
		);
		await expect(api.create(input())).rejects.toThrow("unconfirmed");
		expect(posts).toBe(1);
	});
	it("does not mark a failed pre-list as definitely rejected or write dispatch intent", async () => {
		const onCreating = vi.fn();
		const api = createApi(async () => {
			throw new Error("lookup unavailable");
		});
		await expect(api.create(input({ onCreating }))).rejects.not.toBeInstanceOf(
			CloudHandoffCreationRejectedError,
		);
		expect(onCreating).not.toHaveBeenCalled();
	});
	it("marks a scope rejection between lookup and POST without dispatching", async () => {
		let resolutions = 0;
		const methods: string[] = [];
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api",
			appBaseUrl: "https://app",
			getAuthToken: async () => {
				if (++resolutions === 3) throw new Error("scope revoked");
				return "token";
			},
			fetch: async (_url, init) => {
				methods.push(init?.method ?? "GET");
				return response([]);
			},
		});
		await expect(api.create(input())).rejects.toBeInstanceOf(
			CloudHandoffCreationRejectedError,
		);
		expect(methods).toEqual(["GET"]);
	});
	it("permits a fresh create after the original sandbox was explicitly deleted", async () => {
		let posts = 0;
		const api = createApi(async (_url, init) => {
			if (init?.method === "POST") {
				posts++;
				return response({ sessionId: record.id, status: "ready" });
			}
			return response([]);
		});
		await api.create(input());
		await api.delete(record.id);
		await api.create(input());
		expect(posts).toBe(2);
	});
	it("adopts the exact stable marker before any POST and persists the recovered outer id", async () => {
		const persist = vi.fn(async () => {});
		const fetch = vi.fn(async () =>
			response([
				{ ...record, title: "__cline_create_request__:handoff:source:sha" },
			]),
		);
		const api = createApi(fetch);
		expect(
			(await api.create(input({ onOuterSessionCreated: persist }))).sessionId,
		).toBe(record.id);
		expect(persist).toHaveBeenCalledWith(record.id, { created: false });
		expect(fetch.mock.calls).toHaveLength(1);
	});
	it("removes a terminal recovered marker before allowing an explicit retry", async () => {
		const methods: string[] = [];
		const removed = vi.fn(async () => {});
		let failedMarkerVisible = false;
		let posts = 0;
		const api = createApi(async (_url, init) => {
			const method = init?.method ?? "GET";
			methods.push(method);
			if (method === "DELETE") {
				failedMarkerVisible = false;
				return response(undefined);
			}
			if (method === "POST") {
				posts++;
				if (posts === 1) {
					failedMarkerVisible = true;
					throw new Error("lost create reply");
				}
				return response({ sessionId: "ses-retry", status: "ready" });
			}
			return response(
				failedMarkerVisible
					? [
							{
								...record,
								status: "failed",
								title: "__cline_create_request__:handoff:source:sha",
							},
						]
					: [],
			);
		});

		await expect(
			api.create(input({ onOuterSessionRemoved: removed })),
		).rejects.toMatchObject({ code: "session_failed" });
		expect(methods).toEqual(["GET", "POST", "GET", "DELETE"]);
		expect(removed).toHaveBeenCalledWith(record.id);

		await expect(api.create(input())).resolves.toMatchObject({
			sessionId: "ses-retry",
		});
		expect(posts).toBe(2);
	});
	it("fences an invisible accepted POST instead of issuing another create", async () => {
		let posts = 0;
		const api = createApi(async (_url, init) => {
			if (init?.method === "POST") {
				posts++;
				throw new Error("lost response");
			}
			return response([]);
		});
		await expect(api.create(input())).rejects.toThrow("lost response");
		await expect(api.create(input())).rejects.toThrow("unconfirmed");
		expect(posts).toBe(1);
	});
	it("cleans up a newly created outer session when its durable id cannot be saved", async () => {
		const methods: string[] = [];
		const removed = vi.fn(async () => {});
		const api = createApi(async (_url, init) => {
			methods.push(init?.method ?? "GET");
			return response(
				init?.method === "POST"
					? { sessionId: record.id, status: "ready" }
					: [],
			);
		});
		await expect(
			api.create(
				input({
					onOuterSessionCreated: async () => {
						throw new Error("disk full");
					},
					onOuterSessionRemoved: removed,
				}),
			),
		).rejects.toThrow("disk full");
		expect(methods).toEqual(["GET", "POST", "DELETE"]);
		expect(removed).toHaveBeenCalledWith(record.id);
	});
	it("does not delete an adopted workspace when persistence fails", async () => {
		const methods: string[] = [];
		const api = createApi(async (_url, init) => {
			methods.push(init?.method ?? "GET");
			return response([
				{ ...record, title: "__cline_create_request__:handoff:source:sha" },
			]);
		});
		await expect(
			api.create(
				input({
					onOuterSessionCreated: async () => {
						throw new Error("disk full");
					},
				}),
			),
		).rejects.toThrow("disk full");
		expect(methods).toEqual(["GET"]);
	});
});
