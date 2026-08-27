import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentResultSchema } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	CloudTeammateProvisionInput,
	CloudTeammateRunInput,
} from "./cloud-teammate";
import {
	defaultSleep,
	HttpCloudTeammateControlPlane,
} from "./http-cloud-teammate-control-plane";

const timestamp = "2026-08-27T12:00:00.000Z";
const archiveSha = "a".repeat(64);
const manifestSha = "b".repeat(64);
const temporaryDirectories: string[] = [];

function response(data: unknown, status = 200): Response {
	return new Response(JSON.stringify({ success: true, data }), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function team() {
	return {
		id: "ctm-server-team",
		clientTeamId: "t_local",
		name: "Local team",
		contractVersion: 1,
		status: "active",
		createdAt: timestamp,
		updatedAt: timestamp,
	};
}

function capsule() {
	return {
		id: "wcp-capsule",
		teamId: "ctm-server-team",
		manifestVersion: 1,
		manifestSha256: manifestSha,
		manifest: {},
		archiveSha256: archiveSha,
		archiveFormat: "tar+gzip",
		archiveMediaType: "application/vnd.cline.workspace-capsule.v1+tar+gzip",
		archiveSizeBytes: 13,
		unpackedSizeBytes: 5,
		createdAt: timestamp,
	};
}

function node(
	status:
		| "provisioning"
		| "online"
		| "busy"
		| "offline"
		| "terminating"
		| "terminated" = "online",
) {
	return {
		id: "cnd-cloud-node",
		teamId: "ctm-server-team",
		initialCapsuleId: "wcp-capsule",
		name: "reviewer",
		rolePrompt: "Review the selected files",
		kind: "cloud",
		status,
		createdAt: timestamp,
		updatedAt: timestamp,
	};
}

function run(status: "queued" | "running" | "completed" = "queued") {
	return {
		id: "crn-server-run",
		teamId: "ctm-server-team",
		taskId: "tsk-server-task",
		nodeId: "cnd-cloud-node",
		clientRunId: "run_00001",
		status,
		prompt: "Review now",
		...(status !== "queued" ? { startedAt: timestamp } : {}),
		...(status === "completed" ? { completedAt: timestamp } : {}),
		createdAt: timestamp,
		updatedAt: timestamp,
	};
}

async function provisionInput(): Promise<CloudTeammateProvisionInput> {
	const directory = await mkdtemp(join(tmpdir(), "cline-http-core-test-"));
	temporaryDirectories.push(directory);
	const archivePath = join(directory, "capsule.tar.gz");
	await writeFile(archivePath, "archive-bytes");
	return {
		teamId: "t_local",
		teamName: "Local team",
		agentId: "reviewer",
		rolePrompt: "Review the selected files",
		initialCapsule: {
			archivePath,
			metadata: {
				version: 1,
				manifestVersion: 1,
				mediaType: "application/vnd.cline.workspace-capsule.v1+tar+gzip",
				format: "tar+gzip",
				sha256: archiveSha,
				manifestSha256: manifestSha,
				archiveSizeBytes: 13,
				unpackedSizeBytes: 5,
			},
			manifest: {
				version: 1,
				createdAt: timestamp,
				roots: [{ id: "workspace" }],
				entries: [
					{
						kind: "file",
						path: "a.txt",
						sourceRootId: "workspace",
						purpose: "workspace",
						mode: 0o644,
						size: 5,
						sha256: "c".repeat(64),
					},
				],
				totalBytes: 5,
				team: { teamId: "t_local", agentId: "reviewer" },
			},
		},
	};
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("HttpCloudTeammateControlPlane", () => {
	it("sends exact Core JSON and multipart contracts, polls a durable run, and destroys safely", async () => {
		const calls: Array<{ path: string; method: string }> = [];
		let runPostAttempts = 0;
		let nodePostAttempts = 0;
		let pollCount = 0;
		let nodeDeleteAttempts = 0;
		const fetchImplementation = vi.fn(async (request, init) => {
			const url = new URL(String(request));
			const method = init?.method ?? "GET";
			calls.push({ path: url.pathname, method });
			expect(init?.redirect).toBe("error");
			expect(new Headers(init?.headers).get("authorization")).toBe(
				"Bearer local-token",
			);

			if (url.pathname.endsWith("/teams") && method === "POST") {
				expect(JSON.parse(String(init?.body))).toEqual({
					contractVersion: 1,
					clientTeamId: "t_local",
					name: "Local team",
				});
				return response(team(), 201);
			}
			if (url.pathname.endsWith("/ctm-server-team/capsules")) {
				const form = init?.body as FormData;
				expect([...form.keys()]).toEqual(["metadata", "archive"]);
				const metadataPart = form.get("metadata") as Blob;
				expect(JSON.parse(await metadataPart.text())).toEqual({
					contractVersion: 1,
					teamId: "ctm-server-team",
					manifest: (await provisionInput()).initialCapsule.manifest,
					archive: {
						format: "tar+gzip",
						mediaType: "application/vnd.cline.workspace-capsule.v1+tar+gzip",
						sha256: archiveSha,
						manifestSha256: manifestSha,
						archiveSizeBytes: 13,
						unpackedSizeBytes: 5,
					},
				});
				expect(await (form.get("archive") as Blob).text()).toBe(
					"archive-bytes",
				);
				return response(capsule(), 201);
			}
			if (
				url.pathname.endsWith("/ctm-server-team/nodes") &&
				method === "POST"
			) {
				nodePostAttempts++;
				expect(JSON.parse(String(init?.body))).toEqual({
					contractVersion: 1,
					name: "reviewer",
					rolePrompt: "Review the selected files",
					compatibility: {
						kind: "cloud",
						os: "linux",
						architecture: "amd64",
					},
					initialCapsuleId: "wcp-capsule",
				});
				if (nodePostAttempts === 1) {
					return new Response(null, { status: 503 });
				}
				return response(node(), 201);
			}
			if (url.pathname.endsWith("/cnd-cloud-node/runs") && method === "POST") {
				runPostAttempts++;
				expect(JSON.parse(String(init?.body))).toEqual({
					contractVersion: 1,
					message: "Review now",
					runId: "run_00001",
					taskId: "task_0001",
					fromAgentId: "lead",
					continueConversation: true,
				});
				if (runPostAttempts === 1) return new Response(null, { status: 503 });
				return response(run(), 202);
			}
			if (url.pathname.endsWith("/runs/crn-server-run") && method === "GET") {
				pollCount++;
				if (pollCount === 1) return response({ run: run("running") });
				if (pollCount === 2) {
					return response({
						run: run("completed"),
						serverExtension: "forward-compatible",
					});
				}
				return response({
					run: run("completed"),
					outcome: {
						id: "cot-outcome",
						teamId: "ctm-server-team",
						taskId: "tsk-server-task",
						runId: "crn-server-run",
						status: "finalized",
						payload: {
							text: "Review complete",
							finishReason: "completed",
							iterations: 2,
							usage: { inputTokens: 4, outputTokens: 2 },
							model: { id: "claude", provider: "anthropic" },
							toolCalls: [
								{
									name: "read_file",
									input: { path: "a.txt" },
									output: "hello",
									startedAt: "2026-08-27T11:59:59.250Z",
									endedAt: "2026-08-27T11:59:59.750Z",
								},
							],
							startedAt: "2026-08-27T11:59:59.000Z",
							endedAt: timestamp,
							durationMs: 1000,
						},
						createdAt: timestamp,
						updatedAt: timestamp,
					},
				});
			}
			if (
				url.pathname.endsWith("/nodes/cnd-cloud-node") &&
				method === "DELETE"
			) {
				nodeDeleteAttempts++;
				return new Response(null, {
					status: nodeDeleteAttempts === 1 ? 503 : 404,
				});
			}
			if (
				url.pathname.endsWith("/teams/ctm-server-team") &&
				method === "DELETE"
			) {
				return new Response(null, { status: 404 });
			}
			throw new Error(`Unexpected request ${method} ${url.pathname}`);
		}) as typeof fetch;
		const controlPlane = new HttpCloudTeammateControlPlane({
			baseUrl: "https://core.example.test/",
			fetch: fetchImplementation,
			headers: { Authorization: "Bearer local-token" },
			pollIntervalMs: 10,
			maxRequestAttempts: 2,
			compatibility: { os: "linux", architecture: "amd64" },
			sleep: async () => undefined,
		});

		await expect(
			controlPlane.provisionTeammate(await provisionInput()),
		).resolves.toEqual({ nodeId: "cnd-cloud-node" });
		const runInput: CloudTeammateRunInput = {
			teamId: "t_local",
			teamName: "Local team",
			nodeId: "cnd-cloud-node",
			agentId: "reviewer",
			message: "Review now",
			runId: "run_00001",
			taskId: "task_0001",
			fromAgentId: "lead",
			continueConversation: true,
		};
		const agentResult = await controlPlane.runTeammateTask(runInput);
		expect(agentResult).toEqual(
			expect.objectContaining({
				text: "Review complete",
				iterations: 2,
				finishReason: "completed",
				model: { id: "claude", provider: "anthropic" },
			}),
		);
		expect(agentResult.startedAt).toBeInstanceOf(Date);
		expect(agentResult.endedAt).toBeInstanceOf(Date);
		expect(agentResult.startedAt.toISOString()).toBe(
			"2026-08-27T11:59:59.000Z",
		);
		expect(agentResult.durationMs).toBe(1000);
		expect(agentResult.toolCalls).toEqual([
			expect.objectContaining({
				id: "cloud-tool-1",
				name: "read_file",
				durationMs: 500,
				startedAt: new Date("2026-08-27T11:59:59.250Z"),
				endedAt: new Date("2026-08-27T11:59:59.750Z"),
			}),
		]);
		expect(() => AgentResultSchema.parse(agentResult)).not.toThrow();
		expect(runPostAttempts).toBe(2);
		expect(nodePostAttempts).toBe(2);
		expect(pollCount).toBe(3);

		await controlPlane.destroyTeammate({
			teamId: "t_local",
			teamName: "Local team",
			nodeId: "cnd-cloud-node",
			agentId: "reviewer",
			reason: "manual shutdown",
		});
		expect(nodeDeleteAttempts).toBe(2);
		await expect(
			controlPlane.destroyTeammate({
				teamId: "t_local",
				teamName: "Local team",
				nodeId: "cnd-cloud-node",
				agentId: "reviewer",
				reason: "team_cleanup",
			}),
		).resolves.toBeUndefined();
		await expect(
			controlPlane.destroyTeammate({
				teamId: "t_local",
				teamName: "Local team",
				nodeId: "cnd-other-node",
				agentId: "other",
				reason: "team_cleanup",
			}),
		).resolves.toBeUndefined();
		expect(calls).toContainEqual({
			path: "/api/v2/cloud-agent-clusters/teams/ctm-server-team",
			method: "DELETE",
		});
		expect(
			calls.filter(
				(call) =>
					call.path === "/api/v2/cloud-agent-clusters/teams" &&
					call.method === "POST",
			),
		).toHaveLength(1);
		expect(
			calls.filter(
				(call) =>
					call.path === "/api/v2/cloud-agent-clusters/teams/ctm-server-team" &&
					call.method === "DELETE",
			),
		).toHaveLength(1);
	});

	it("polls a durable provisioning node through retryable 503 responses", async () => {
		let readinessCalls = 0;
		const sleeps: number[] = [];
		const fetchImplementation = vi.fn(async (request, init) => {
			const url = new URL(String(request));
			const method = init?.method ?? "GET";
			if (url.pathname.endsWith("/teams") && method === "POST") {
				return response(team(), 201);
			}
			if (url.pathname.endsWith("/ctm-server-team/capsules")) {
				return response(capsule(), 201);
			}
			if (
				url.pathname.endsWith("/ctm-server-team/nodes") &&
				method === "POST"
			) {
				return response(node("provisioning"), 201);
			}
			if (url.pathname.endsWith("/nodes/cnd-cloud-node") && method === "GET") {
				readinessCalls++;
				if (readinessCalls === 1) {
					return new Response(null, {
						status: 503,
						headers: { "retry-after": "1" },
					});
				}
				if (readinessCalls === 2) {
					return new Response(null, { status: 502 });
				}
				return response(node("online"));
			}
			throw new Error(`Unexpected request ${method} ${url.pathname}`);
		}) as typeof fetch;
		const controlPlane = new HttpCloudTeammateControlPlane({
			baseUrl: "https://core.example.test/",
			fetch: fetchImplementation,
			maxRequestAttempts: 1,
			provisioningTimeoutMs: 5_000,
			provisioningPollIntervalMs: 20,
			sleep: async (milliseconds) => {
				sleeps.push(milliseconds);
			},
		});

		await expect(
			controlPlane.provisionTeammate(await provisionInput()),
		).resolves.toEqual({ nodeId: "cnd-cloud-node" });
		expect(readinessCalls).toBe(3);
		expect(sleeps).toEqual(expect.arrayContaining([20, 1000]));
	});

	it("deletes a created node when readiness fails", async () => {
		let nodePosts = 0;
		let nodeDeletes = 0;
		const fetchImplementation = vi.fn(async (request, init) => {
			const url = new URL(String(request));
			const method = init?.method ?? "GET";
			if (url.pathname.endsWith("/teams") && method === "POST") {
				return response(team(), 201);
			}
			if (url.pathname.endsWith("/ctm-server-team/capsules")) {
				return response(capsule(), 201);
			}
			if (
				url.pathname.endsWith("/ctm-server-team/nodes") &&
				method === "POST"
			) {
				nodePosts++;
				return response(node("provisioning"), 201);
			}
			if (url.pathname.endsWith("/nodes/cnd-cloud-node") && method === "GET") {
				return response(node("offline"));
			}
			if (
				url.pathname.endsWith("/nodes/cnd-cloud-node") &&
				method === "DELETE"
			) {
				nodeDeletes++;
				return new Response(null, { status: 204 });
			}
			throw new Error(`Unexpected request ${method} ${url.pathname}`);
		}) as typeof fetch;
		const controlPlane = new HttpCloudTeammateControlPlane({
			baseUrl: "https://core.example.test/",
			fetch: fetchImplementation,
			sleep: async () => undefined,
		});

		await expect(
			controlPlane.provisionTeammate(await provisionInput()),
		).rejects.toThrow("became unavailable with status offline");
		expect(nodePosts).toBe(1);
		expect(nodeDeletes).toBe(1);
	});

	it("rejects a capsule response whose team or hashes do not match the upload", async () => {
		let nodePosts = 0;
		const fetchImplementation = vi.fn(async (request, init) => {
			const url = new URL(String(request));
			const method = init?.method ?? "GET";
			if (url.pathname.endsWith("/teams") && method === "POST") {
				return response(team(), 201);
			}
			if (url.pathname.endsWith("/ctm-server-team/capsules")) {
				return response({ ...capsule(), archiveSha256: "f".repeat(64) }, 201);
			}
			if (
				url.pathname.endsWith("/ctm-server-team/nodes") &&
				method === "POST"
			) {
				nodePosts++;
				return response(node(), 201);
			}
			throw new Error(`Unexpected request ${method} ${url.pathname}`);
		}) as typeof fetch;
		const controlPlane = new HttpCloudTeammateControlPlane({
			baseUrl: "https://core.example.test/",
			fetch: fetchImplementation,
		});

		await expect(
			controlPlane.provisionTeammate(await provisionInput()),
		).rejects.toThrow("upload workspace capsule returned mismatched identity");
		expect(nodePosts).toBe(0);
	});

	it("validates a durable node before reattaching it", async () => {
		const fetchImplementation = vi.fn(async (request, init) => {
			const url = new URL(String(request));
			const method = init?.method ?? "GET";
			if (url.pathname.endsWith("/teams") && method === "POST") {
				return response(team(), 201);
			}
			if (url.pathname.endsWith("/nodes/cnd-cloud-node") && method === "GET") {
				return response(node("busy"));
			}
			throw new Error(`Unexpected request ${method} ${url.pathname}`);
		}) as typeof fetch;
		const controlPlane = new HttpCloudTeammateControlPlane({
			baseUrl: "https://core.example.test/",
			fetch: fetchImplementation,
		});

		await expect(
			controlPlane.reattachTeammate({
				teamId: "t_local",
				teamName: "Local team",
				nodeId: "cnd-cloud-node",
				agentId: "reviewer",
			}),
		).resolves.toEqual({ nodeId: "cnd-cloud-node" });
	});

	it("removes the abort listener after the default sleep resolves", async () => {
		vi.useFakeTimers();
		try {
			const controller = new AbortController();
			const remove = vi.spyOn(controller.signal, "removeEventListener");
			const sleeping = defaultSleep(25, controller.signal);
			await vi.advanceTimersByTimeAsync(25);
			await sleeping;
			expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
		} finally {
			vi.useRealTimers();
		}
	});

	it("bounds a hung control-plane request with the per-attempt timeout", async () => {
		vi.useFakeTimers();
		try {
			const fetchImplementation = vi.fn(
				async (_request: Parameters<typeof fetch>[0], init?: RequestInit) =>
					await new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener(
							"abort",
							() => reject(init.signal?.reason),
							{ once: true },
						);
					}),
			) as typeof fetch;
			const controlPlane = new HttpCloudTeammateControlPlane({
				baseUrl: "https://core.example.test/",
				fetch: fetchImplementation,
				requestTimeoutMs: 100,
				maxRequestAttempts: 1,
			});
			const reattach = controlPlane.reattachTeammate({
				teamId: "t_local",
				teamName: "Local team",
				nodeId: "cnd-cloud-node",
				agentId: "reviewer",
			});
			await vi.advanceTimersByTimeAsync(100);
			await expect(reattach).rejects.toThrow(
				"create cloud team request failed",
			);
		} finally {
			vi.useRealTimers();
		}
	});

	it("aborts polling without cancelling the durable server run", async () => {
		const controller = new AbortController();
		let deleteCalls = 0;
		const fetchImplementation = vi.fn(async (request, init) => {
			const path = new URL(String(request)).pathname;
			if (path.endsWith("/teams")) return response(team(), 201);
			if (path.endsWith("/cnd-cloud-node/runs")) return response(run(), 202);
			if (path.endsWith("/runs/crn-server-run")) {
				queueMicrotask(() =>
					controller.abort(new DOMException("caller left", "AbortError")),
				);
				return response({ run: run("running") });
			}
			if (init?.method === "DELETE") deleteCalls++;
			throw new Error("unexpected request");
		}) as typeof fetch;
		const controlPlane = new HttpCloudTeammateControlPlane({
			baseUrl: "https://core.example.test",
			fetch: fetchImplementation,
			pollIntervalMs: 1000,
			maxRequestAttempts: 1,
		});

		await expect(
			controlPlane.runTeammateTask({
				teamId: "t_local",
				teamName: "Local team",
				nodeId: "cnd-cloud-node",
				agentId: "reviewer",
				message: "Review now",
				runId: "run_00001",
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(deleteCalls).toBe(0);
	});

	it("redacts transport errors and rejects malformed successful responses", async () => {
		const leakingFetch = vi.fn(async () => {
			throw new Error("https://signed.example/object?secret=do-not-leak");
		}) as typeof fetch;
		const leaking = new HttpCloudTeammateControlPlane({
			baseUrl: "https://core.example.test",
			fetch: leakingFetch,
			maxRequestAttempts: 1,
		});
		await expect(
			leaking.runTeammateTask({
				teamId: "t_local",
				teamName: "Local team",
				nodeId: "cnd-cloud-node",
				agentId: "reviewer",
				message: "Review",
			}),
		).rejects.toThrow("create cloud team request failed");
		await expect(
			leaking.runTeammateTask({
				teamId: "t_local",
				teamName: "Local team",
				nodeId: "cnd-cloud-node",
				agentId: "reviewer",
				message: "Review",
			}),
		).rejects.not.toThrow("do-not-leak");

		const malformed = new HttpCloudTeammateControlPlane({
			baseUrl: "https://core.example.test",
			fetch: vi.fn(async () => response({ id: "wrong" }, 201)) as typeof fetch,
			maxRequestAttempts: 1,
		});
		await expect(
			malformed.runTeammateTask({
				teamId: "t_local",
				teamName: "Local team",
				nodeId: "cnd-cloud-node",
				agentId: "reviewer",
				message: "Review",
			}),
		).rejects.toThrow("create cloud team returned an invalid response");
	});
});
