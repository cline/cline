import { describe, expect, it, vi } from "vitest";
import { asRemoteSessionId } from "../../session";
import type { FetchLike } from "../http";
import {
	AmbiguousCloudSessionCreateError,
	CloudSessionApiError,
	CloudSessionGateway,
	CloudSessionResponseError,
	type CreatedRemoteSession,
	GitHubIntegrationRequiredError,
	mapRemoteSessionStatus,
} from "./CloudSessionGateway";

const API = "https://core-api.test";

function jsonResponse(status: number, body: unknown): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
		text: async () => JSON.stringify(body),
		headers: { get: () => null },
	} as unknown as Response;
}

const DTO = {
	id: "ses-1",
	status: "ready",
	sandboxUrl: "https://ses-1.instances.cline.bot/hub",
	title: "Review auth",
	metadata: { modelId: "anthropic/claude" },
	repoContext: { repoUrl: "https://github.com/o/r" },
	expiredAt: "2026-01-01T12:00:00Z",
	createdAt: "2025-12-01T00:00:00Z",
	updatedAt: "2025-12-02T00:00:00Z",
};

describe("Cloud lifecycle parity", () => {
	it("stops the exact workspace through suspend and validates confirmation", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse(200, {
				success: true,
				data: {
					...DTO,
					status: "suspended",
					metadata: { sandboxType: "resumable" },
				},
			}),
		);
		const api = new CloudSessionGateway({
			apiBaseUrl: API,
			getAccessToken: async () => "jwt",
			fetchImpl,
		});
		await expect(
			api.suspendRemoteSession(asRemoteSessionId("ses-1")),
		).resolves.toBeUndefined();
		expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
			`${API}/api/v1/session/ses-1/suspend`,
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					Authorization: "Bearer workos:jwt",
				}),
			}),
		);
		fetchImpl.mockResolvedValueOnce(
			jsonResponse(200, {
				success: true,
				data: { ...DTO, id: "other", status: "suspended" },
			}),
		);
		await expect(
			api.suspendRemoteSession(asRemoteSessionId("ses-1")),
		).rejects.toBeInstanceOf(CloudSessionResponseError);
		fetchImpl.mockResolvedValueOnce(
			jsonResponse(409, {
				success: false,
				error: "session is not in a suspendable status",
			}),
		);
		await expect(
			api.suspendRemoteSession(asRemoteSessionId("ses-1")),
		).rejects.toMatchObject({
			status: 409,
			message: "session is not in a suspendable status",
		});
	});
	it("reconciles only Starting rows with scoped read-only status requests", async () => {
		const fetchImpl = vi.fn(async (url: string) =>
			jsonResponse(200, {
				success: true,
				data: url.includes("/status")
					? { sessionId: "ses-1", status: "ready" }
					: [
							{
								...DTO,
								status: "provisioning",
								phase: "cloning",
								lastActivityAt: "2026-09-30T12:00:00Z",
							},
							{ ...DTO, id: "paused", status: "suspended" },
							{ ...DTO, id: "ready" },
						],
			}),
		);
		const api = new CloudSessionGateway({
			apiBaseUrl: API,
			getAccessToken: async () => "jwt",
			organizationId: "org",
			fetchImpl,
		});
		const rows = await api.listRemoteSessions({ refreshProvisioning: true });
		expect(rows.map((row) => row.status)).toEqual([
			"running",
			"suspended",
			"running",
		]);
		expect(rows[0]).toMatchObject({
			organizationId: "org",
			lastActivityAt: Date.parse("2026-09-30T12:00:00Z"),
		});
		expect(rows[0]?.phase).toBeUndefined();
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(fetchImpl).toHaveBeenNthCalledWith(
			1,
			`${API}/api/v1/session?organizationId=org`,
			expect.objectContaining({ method: "GET" }),
		);
		expect(fetchImpl).toHaveBeenLastCalledWith(
			`${API}/api/v1/session/ses-1/status`,
			expect.objectContaining({
				method: "GET",
				headers: expect.objectContaining({
					Authorization: "Bearer workos:jwt",
				}),
			}),
		);
	});
	it.each([
		"failure",
		"wrong-session",
	])("keeps the listed row if a status probe returns %s", async (kind) => {
		const fetchImpl = vi.fn(async (url: string) =>
			url.endsWith("/status")
				? jsonResponse(kind === "failure" ? 503 : 200, {
						success: true,
						data: { sessionId: "other", status: "ready" },
					})
				: jsonResponse(200, {
						success: true,
						data: [{ ...DTO, status: "provisioning", phase: "cloning" }],
					}),
		);
		expect(
			(
				await gateway(fetchImpl).listRemoteSessions({
					refreshProvisioning: true,
				})
			)[0],
		).toMatchObject({ id: "ses-1", status: "provisioning", phase: "cloning" });
	});
	function gateway(fetchImpl: FetchLike) {
		return new CloudSessionGateway({
			apiBaseUrl: API,
			getAccessToken: async () => "jwt",
			fetchImpl,
			sleep: async () => {},
			provisioningTimeoutMs: 1000,
		});
	}
	it("retains canonical identity, branch, and failure detail from session metadata", async () => {
		const api = gateway(async () =>
			jsonResponse(200, {
				success: true,
				data: [
					{
						...DTO,
						status: "failed",
						metadata: {
							taskId: "tsk-root",
							sandboxType: "standard",
							statusReason: "Repository clone failed",
						},
						repoContext: { repoUrl: "repo", branch: "feature" },
						phase: "cloning",
					},
				],
			}),
		);
		expect((await api.listRemoteSessions())[0]).toMatchObject({
			taskId: "tsk-root",
			branch: "feature",
			phase: "cloning",
			statusReason: "Repository clone failed",
		});
		expect(
			await api.getRemoteSession(asRemoteSessionId("ses-1")),
		).toMatchObject({
			status: "failed",
			statusReason: "Repository clone failed",
		});
	});
	it("retries transient status reads without repeating create and reports phase", async () => {
		const replies = [
			jsonResponse(502, {}),
			jsonResponse(200, {
				success: true,
				data: { sessionId: "ses-1", status: "provisioning", phase: "cloning" },
			}),
			jsonResponse(200, {
				success: true,
				data: { sessionId: "ses-1", status: "ready" },
			}),
		];
		const fetchImpl = vi.fn(
			async () => replies.shift() ?? jsonResponse(400, {}),
		);
		const progress = vi.fn();
		await gateway(fetchImpl).waitUntilReady(
			asRemoteSessionId("ses-1"),
			"provisioning",
			{ onProgress: progress },
		);
		expect(fetchImpl).toHaveBeenCalledTimes(3);
		expect(progress).toHaveBeenCalledWith(
			expect.objectContaining({ phase: "cloning" }),
		);
	});
	it.each([
		"network",
		"5xx",
		"invalid",
	])("marks an uncertain %s create without retrying it", async (kind) => {
		const fetchImpl = vi.fn(async () => {
			if (kind === "network") throw new TypeError("Response lost");
			return jsonResponse(kind === "5xx" ? 502 : 200, {});
		});
		await expect(
			gateway(fetchImpl).createRemoteSession({ modelId: "m", repoUrl: "repo" }),
		).rejects.toBeInstanceOf(AmbiguousCloudSessionCreateError);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
	it("distinguishes missing history from an empty archive", async () => {
		expect(
			await gateway(async () => jsonResponse(404, {})).readHistory(
				asRemoteSessionId("ses-1"),
			),
		).toBeUndefined();
		expect(
			await gateway(async () =>
				jsonResponse(200, { version: 1, messages: [] }),
			).readHistory(asRemoteSessionId("ses-1")),
		).toEqual([]);
	});
	it.each([
		401, 500, 200,
	])("rejects unauthorized, failed or malformed history (%i)", async (status) => {
		await expect(
			gateway(async () => jsonResponse(status, {})).readHistory(
				asRemoteSessionId("ses-1"),
			),
		).rejects.toBeInstanceOf(CloudSessionApiError);
	});
	it("stops a pending readiness request on cancellation", async () => {
		const controller = new AbortController();
		let started!: () => void;
		const requestStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		const fetchImpl = vi.fn(
			async (_url, init) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(new Error("aborted")),
					);
					started();
				}),
		);
		const waiting = gateway(fetchImpl).waitUntilReady(
			asRemoteSessionId("ses-1"),
			"provisioning",
			{ signal: controller.signal },
		);
		await requestStarted;
		controller.abort(new Error("User left"));
		await expect(waiting).rejects.toThrow("User left");
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
	it("bounds repeated transient failures by the provisioning deadline", async () => {
		vi.useFakeTimers();
		try {
			const fetchImpl = vi.fn(async () => jsonResponse(503, {}));
			const api = new CloudSessionGateway({
				apiBaseUrl: API,
				getAccessToken: async () => "jwt",
				fetchImpl,
				provisioningPollMs: 10,
				provisioningTimeoutMs: 35,
			});
			const waiting = expect(
				api.waitUntilReady(asRemoteSessionId("ses-1"), "provisioning"),
			).rejects.toMatchObject({ status: 408 });
			await vi.advanceTimersByTimeAsync(35);
			await waiting;
			expect(fetchImpl).toHaveBeenCalledTimes(3);
		} finally {
			vi.useRealTimers();
		}
	});
	it("updates only the title through the existing PATCH route", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse(200, { success: true }));
		await gateway(fetchImpl).updateTitle(
			asRemoteSessionId("ses-1"),
			" New name ",
		);
		expect(fetchImpl).toHaveBeenCalledWith(
			`${API}/api/v1/session/ses-1`,
			expect.objectContaining({
				method: "PATCH",
				body: JSON.stringify({ title: "New name" }),
			}),
		);
	});
});

describe("mapRemoteSessionStatus", () => {
	it("maps known states and defaults unknown/ready to running", () => {
		expect(mapRemoteSessionStatus("ready")).toBe("running");
		expect(mapRemoteSessionStatus("provisioning")).toBe("provisioning");
		expect(mapRemoteSessionStatus("stopped")).toBe("stopped");
		expect(mapRemoteSessionStatus("expired")).toBe("expired");
		expect(mapRemoteSessionStatus("failed")).toBe("failed");
		expect(mapRemoteSessionStatus("something-new")).toBe("unknown");
		expect(mapRemoteSessionStatus(undefined)).toBe("unknown");
	});
});

describe("CloudSessionGateway.listRemoteSessions", () => {
	it("maps DTOs to RemoteSessions with the proxy URL as sandboxUrl", async () => {
		let seenUrl = "";
		let seenAuth: string | undefined;
		const fetchImpl: FetchLike = vi.fn(async (url, init) => {
			seenUrl = url;
			seenAuth = (init?.headers as Record<string, string>)?.Authorization;
			return jsonResponse(200, { success: true, data: [DTO] });
		});
		const gateway = new CloudSessionGateway({
			apiBaseUrl: API,
			getAccessToken: async () => "jwt-123",
			organizationId: "org-9",
			fetchImpl,
		});

		const sessions = await gateway.listRemoteSessions();
		expect(seenUrl).toBe(`${API}/api/v1/session?organizationId=org-9`);
		expect(seenAuth).toBe("Bearer workos:jwt-123");
		expect(sessions).toEqual([
			{
				id: asRemoteSessionId("ses-1"),
				sandboxUrl: `${API}/api/v1/session/ses-1`,
				status: "running",
				expiredAt: Date.parse("2026-01-01T12:00:00Z"),
				modelId: "anthropic/claude",
				repoUrl: "https://github.com/o/r",
				organizationId: "org-9",
				title: "Review auth",
				createdAt: Date.parse("2025-12-01T00:00:00Z"),
				updatedAt: Date.parse("2025-12-02T00:00:00Z"),
			},
		]);
	});

	it("does not double the workos: prefix if the token already carries it", async () => {
		let seenAuth: string | undefined;
		const gateway = new CloudSessionGateway({
			apiBaseUrl: API,
			getAccessToken: async () => "workos:already",
			fetchImpl: async (_url, init) => {
				seenAuth = (init?.headers as Record<string, string>)?.Authorization;
				return jsonResponse(200, { success: true, data: [] });
			},
		});
		await gateway.listRemoteSessions();
		expect(seenAuth).toBe("Bearer workos:already");
	});

	it("throws CloudSessionApiError on a non-OK response", async () => {
		const gateway = new CloudSessionGateway({
			apiBaseUrl: API,
			getAccessToken: async () => "jwt",
			fetchImpl: async () => jsonResponse(403, { error: "not a member" }),
		});
		await expect(gateway.listRemoteSessions()).rejects.toBeInstanceOf(
			CloudSessionApiError,
		);
	});

	it("extracts a readable message from an object-shaped API error", async () => {
		const gateway = new CloudSessionGateway({
			apiBaseUrl: API,
			getAccessToken: async () => "jwt",
			fetchImpl: async () =>
				jsonResponse(503, {
					error: { message: "Cloud workspaces are temporarily unavailable." },
				}),
		});

		await expect(gateway.listRemoteSessions()).rejects.toThrow(
			"Cloud workspaces are temporarily unavailable.",
		);
	});

	it("rejects a non-array data instead of silently rendering no sessions", async () => {
		for (const data of [{ sessions: [] }, "none", null, 7]) {
			const gateway = new CloudSessionGateway({
				apiBaseUrl: API,
				getAccessToken: async () => "jwt",
				fetchImpl: async () => jsonResponse(200, { success: true, data }),
			});
			await expect(gateway.listRemoteSessions()).rejects.toBeInstanceOf(
				CloudSessionResponseError,
			);
		}
	});

	it("rejects a row missing its id instead of leaking internal text", async () => {
		const gateway = new CloudSessionGateway({
			apiBaseUrl: API,
			getAccessToken: async () => "jwt",
			fetchImpl: async () =>
				jsonResponse(200, {
					success: true,
					data: [DTO, { status: "ready", title: "no id" }],
				}),
		});

		const error = await gateway.listRemoteSessions().catch((e: unknown) => e);
		expect(error).toBeInstanceOf(CloudSessionResponseError);
		// Typed and attributable: names the offending path, not an internal throw.
		expect((error as CloudSessionResponseError).message).toContain("1.id");
		// Still a CloudSessionApiError, so existing call sites keep working.
		expect(error).toBeInstanceOf(CloudSessionApiError);
	});

	it("accepts rows carrying unknown forward-compatible fields", async () => {
		const gateway = new CloudSessionGateway({
			apiBaseUrl: API,
			getAccessToken: async () => "jwt",
			fetchImpl: async () =>
				jsonResponse(200, {
					success: true,
					data: [{ ...DTO, somethingNew: { nested: true } }],
				}),
		});
		const sessions = await gateway.listRemoteSessions();
		expect(sessions).toHaveLength(1);
	});
});

describe("CloudSessionGateway.deleteRemoteSession", () => {
	it("accepts a 204", async () => {
		const gateway = new CloudSessionGateway({
			apiBaseUrl: API,
			getAccessToken: async () => "jwt",
			fetchImpl: async () => jsonResponse(204, {}),
		});
		await expect(
			gateway.deleteRemoteSession(asRemoteSessionId("ses-1")),
		).resolves.toBeUndefined();
	});

	it("throws on a 200 body that reports failure", async () => {
		const gateway = new CloudSessionGateway({
			apiBaseUrl: API,
			getAccessToken: async () => "jwt",
			fetchImpl: async () =>
				jsonResponse(200, { success: false, error: "session is locked" }),
		});

		await expect(
			gateway.deleteRemoteSession(asRemoteSessionId("ses-1")),
		).rejects.toThrow("session is locked");
	});

	it("accepts a 200 body that reports success", async () => {
		const gateway = new CloudSessionGateway({
			apiBaseUrl: API,
			getAccessToken: async () => "jwt",
			fetchImpl: async () => jsonResponse(200, { success: true }),
		});
		await expect(
			gateway.deleteRemoteSession(asRemoteSessionId("ses-1")),
		).resolves.toBeUndefined();
	});
});

describe("CloudSessionGateway.getRemoteSession", () => {
	it("resolves a session by filtering the list", async () => {
		const gateway = new CloudSessionGateway({
			apiBaseUrl: API,
			getAccessToken: async () => "jwt",
			fetchImpl: async () => jsonResponse(200, { success: true, data: [DTO] }),
		});
		const found = await gateway.getRemoteSession(asRemoteSessionId("ses-1"));
		expect(found?.id).toBe(asRemoteSessionId("ses-1"));
		const missing = await gateway.getRemoteSession(asRemoteSessionId("ses-x"));
		expect(missing).toBeUndefined();
	});
});

describe("CloudSessionGateway.createRemoteSession", () => {
	it("waits for durable onCreated work before polling provisioning", async () => {
		let releasePersistence: (() => void) | undefined;
		const persistence = new Promise<void>((resolve) => {
			releasePersistence = resolve;
		});
		const seenUrls: string[] = [];
		const gateway = new CloudSessionGateway({
			apiBaseUrl: API,
			getAccessToken: async () => "jwt",
			sleep: async () => {},
			fetchImpl: async (url) => {
				seenUrls.push(url);
				return url.endsWith("/status")
					? jsonResponse(200, {
							success: true,
							data: { sessionId: "ses-durable", status: "ready" },
						})
					: jsonResponse(201, {
							success: true,
							data: { sessionId: "ses-durable", status: "provisioning" },
						});
			},
		});

		const creating = gateway.createRemoteSession(
			{ modelId: "m", repoUrl: "https://github.com/o/r" },
			{ onCreated: () => persistence },
		);
		for (let index = 0; index < 4; index += 1) await Promise.resolve();
		expect(seenUrls).toEqual([`${API}/api/v1/session`]);
		releasePersistence?.();
		await creating;
		expect(seenUrls).toEqual([
			`${API}/api/v1/session`,
			`${API}/api/v1/session/ses-durable/status`,
		]);
	});

	it("polls a newly-created session until Cloud API reports it ready", async () => {
		let seenBody: unknown;
		const seenUrls: string[] = [];
		const sleep = vi.fn(async () => {});
		const gateway = new CloudSessionGateway({
			apiBaseUrl: API,
			getAccessToken: async () => "jwt",
			sleep,
			fetchImpl: async (url, init) => {
				seenUrls.push(url);
				if (url.endsWith("/status")) {
					return jsonResponse(200, {
						success: true,
						data: { sessionId: "ses-new", status: "ready" },
					});
				}
				seenBody = JSON.parse(String(init?.body));
				return jsonResponse(201, {
					success: true,
					data: {
						sessionId: "ses-new",
						status: "provisioning",
					},
				});
			},
		});
		const result = await gateway.createRemoteSession({
			modelId: "anthropic/claude",
			repoUrl: "https://github.com/o/r",
			organizationId: "org-1",
			branch: "develop",
		});
		expect(seenBody).toEqual({
			modelId: "anthropic/claude",
			repoUrl: "https://github.com/o/r",
			sandboxType: "resumable",
			organizationId: "org-1",
			branch: "develop",
		});
		expect(result).toEqual({
			sessionId: asRemoteSessionId("ses-new"),
			sandboxUrl: `${API}/api/v1/session/ses-new`,
		});
		expect(seenUrls).toEqual([
			`${API}/api/v1/session`,
			`${API}/api/v1/session/ses-new/status`,
		]);
		expect(sleep).toHaveBeenCalledWith(3_000);
	});

	it("resumes polling an already-created session without posting a duplicate", async () => {
		const seenMethods: string[] = [];
		let statusCalls = 0;
		let created: CreatedRemoteSession | undefined;
		const gateway = new CloudSessionGateway({
			apiBaseUrl: API,
			getAccessToken: async () => "jwt",
			sleep: async () => {},
			fetchImpl: async (url, init) => {
				seenMethods.push(init?.method ?? "GET");
				if (!url.endsWith("/status")) {
					return jsonResponse(201, {
						success: true,
						data: { sessionId: "ses-once", status: "provisioning" },
					});
				}
				statusCalls += 1;
				return statusCalls === 1
					? jsonResponse(401, { success: false, error: "sign in again" })
					: jsonResponse(200, {
							success: true,
							data: { sessionId: "ses-once", status: "ready" },
						});
			},
		});

		await expect(
			gateway.createRemoteSession(
				{ modelId: "m", repoUrl: "https://github.com/o/r" },
				{ onCreated: (session) => (created = session) },
			),
		).rejects.toThrow("Failed to read session status: 401");
		expect(created).toBeDefined();
		if (!created) throw new Error("create callback was not called");
		await expect(gateway.resumeRemoteSession(created)).resolves.toMatchObject({
			sessionId: asRemoteSessionId("ses-once"),
		});
		expect(seenMethods).toEqual(["POST", "GET", "GET"]);
	});

	it("surfaces the provisioning failure reason instead of opening the proxy", async () => {
		const gateway = new CloudSessionGateway({
			apiBaseUrl: API,
			getAccessToken: async () => "jwt",
			sleep: async () => {},
			fetchImpl: async (url) =>
				url.endsWith("/status")
					? jsonResponse(200, {
							success: true,
							data: {
								sessionId: "ses-new",
								status: "failed",
								statusReason: "Sandbox image could not start.",
							},
						})
					: jsonResponse(201, {
							success: true,
							data: { sessionId: "ses-new", status: "provisioning" },
						}),
		});

		await expect(
			gateway.createRemoteSession({
				modelId: "m",
				repoUrl: "https://github.com/o/r",
			}),
		).rejects.toMatchObject({
			name: "CloudSessionApiError",
			message: "Sandbox image could not start.",
		});
	});

	it("accepts the older ready-on-return response when status is absent", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse(201, { success: true, data: { sessionId: "ses-old" } }),
		);
		const gateway = new CloudSessionGateway({
			apiBaseUrl: API,
			getAccessToken: async () => "jwt",
			fetchImpl,
		});

		await expect(
			gateway.createRemoteSession({
				modelId: "m",
				repoUrl: "https://github.com/o/r",
			}),
		).resolves.toMatchObject({ sessionId: asRemoteSessionId("ses-old") });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("maps a 412 to GitHubIntegrationRequiredError", async () => {
		const gateway = new CloudSessionGateway({
			apiBaseUrl: API,
			getAccessToken: async () => "jwt",
			fetchImpl: async () =>
				jsonResponse(412, {
					success: false,
					error: "GitHub is not connected",
				}),
		});
		await expect(
			gateway.createRemoteSession({
				modelId: "m",
				repoUrl: "https://github.com/o/r",
			}),
		).rejects.toBeInstanceOf(GitHubIntegrationRequiredError);
	});

	it("reports a malformed successful create response at the REST boundary", async () => {
		const gateway = new CloudSessionGateway({
			apiBaseUrl: API,
			getAccessToken: async () => "jwt",
			fetchImpl: async () =>
				jsonResponse(201, { success: true, data: { sessionId: 42 } }),
		});
		await expect(
			gateway.createRemoteSession({
				modelId: "m",
				repoUrl: "https://github.com/o/r",
			}),
		).rejects.toMatchObject({
			name: "AmbiguousCloudSessionCreateError",
			status: 201,
		});
	});
});
