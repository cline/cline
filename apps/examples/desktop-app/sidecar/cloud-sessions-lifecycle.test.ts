import { describe, expect, it, vi } from "vitest";
import {
	type CloudSessionApi,
	CloudSessionError,
	CloudSessionManager,
	type CloudSessionRecord,
	cloudSessionToDiscoveryRecord,
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

function createContext(): { ctx: SidecarContext } {
	const ctx = {
		liveSessions: new Map(),
		restoringWorkspacePaths: new Set(),
		streamIndices: new Map(),
		coreStreamActivity: new Map(),
		bootId: "cloud-test-boot",
		wsClients: new Set([
			{
				data: { canApproveTools: true },
				send() {},
			},
		]),
		pendingApprovals: new Map(),
		pendingQuestions: new Map(),
		sessionManager: null,
		cloudSessionManager: null,
		hubClient: null,
		workspaceRoot: "/local/workspace",
		unsubscribeSessionEvents: null,
		hubBuildMismatch: null,
	} as SidecarContext;
	return { ctx };
}

describe("CloudSessionManager lifecycle", () => {
	it.each([
		"upstream request failed",
		"couldn't authenticate with GitHub; try reconnecting the integration",
	])("surfaces create failure without retrying: %s", async (message) => {
		const { ctx } = createContext();
		const create = vi.fn(async () => {
			throw new CloudSessionError("request_failed", message, undefined, 502);
		});
		const manager = new CloudSessionManager(ctx, {
			api: { create } as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
		});

		await expect(
			manager.create({
				modelId: "model",
				repoUrl: "https://github.com/cline/test",
			}),
		).rejects.toThrow(message);
		expect(create).toHaveBeenCalledOnce();
	});

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

	it("expires a live session without a Hub connection when its TTL elapses", async () => {
		const { ctx } = createContext();
		const remote = { ...REMOTE_SESSION };
		const manager = new CloudSessionManager(ctx, {
			api: {
				create: async () => ({
					sessionId: remote.id,
					status: "provisioning",
					sandboxUrl: "",
				}),
				list: async () => [remote],
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
		});
		await manager.create({
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
		});
		expect((await manager.listForDiscovery())[0].status).toBe("ready");

		remote.expiredAt = new Date(Date.now() - 1_000).toISOString();
		expect((await manager.listForDiscovery())[0]).toMatchObject({
			status: "expired",
			endedAt: remote.expiredAt,
		});
		expect(ctx.liveSessions.get(remote.id)).toMatchObject({
			status: "expired",
			busy: false,
			endedAt: Date.parse(remote.expiredAt),
		});
	});

	it("single-flights repeated starts for the same client request", async () => {
		const { ctx } = createContext();
		let createCalls = 0;
		let finishCreate:
			| ((value: {
					sessionId: string;
					status: string;
					sandboxUrl: string;
			  }) => void)
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
		expect(await manager.listForDiscovery()).toEqual([]);

		finishCreate?.({
			sessionId: "ses-created",
			status: "provisioning",
			sandboxUrl: "",
		});
		await expect(Promise.all([first, second])).resolves.toEqual([
			expect.objectContaining({ sessionId: "ses-created" }),
			expect.objectContaining({ sessionId: "ses-created" }),
		]);
	});

	it("keeps identical starts from separate chats independent", async () => {
		const { ctx } = createContext();
		let createCalls = 0;
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [],
				create: async () => {
					createCalls += 1;
					return {
						sessionId: `ses-created-${createCalls}`,
						sandboxUrl: "pod",
					};
				},
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
		});
		const input = {
			modelId: "anthropic/claude-sonnet-5",
			repoUrl: "https://github.com/cline/test",
		};

		const [first, second] = await Promise.all([
			manager.create({ ...input, requestId: "chat-a" }),
			manager.create({ ...input, requestId: "chat-b" }),
		]);

		expect(createCalls).toBe(2);
		expect(first.sessionId).not.toBe(second.sessionId);
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

	it("uses only the active organization for billing and session listing", async () => {
		const { ctx } = createContext();
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
					return {
						sessionId: "ses-created",
						status: "provisioning",
						sandboxUrl: "",
					};
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
		});
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

	it("refreshes the active organization before creating a session", async () => {
		const { ctx } = createContext();
		let serverScope = "org-a";
		let cachedScope = serverScope;
		const lookupOptions: Array<{ fresh?: boolean } | undefined> = [];
		let createInput: Record<string, unknown> | undefined;
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [],
				create: async (input: Record<string, unknown>) => {
					createInput = input;
					return {
						sessionId: "ses-created",
						status: "provisioning",
						sandboxUrl: "",
					};
				},
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			getActiveOrganizationId: async (options) => {
				lookupOptions.push(options);
				if (options?.fresh) cachedScope = serverScope;
				return cachedScope;
			},
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

	it("does not silently bill personal credits when account scope lookup fails", async () => {
		const { ctx } = createContext();
		let createInput: Record<string, unknown> | undefined;
		const manager = new CloudSessionManager(ctx, {
			api: {
				list: async () => [],
				create: async (input: Record<string, unknown>) => {
					createInput = input;
					return {
						sessionId: "ses-created",
						status: "provisioning",
						sandboxUrl: "",
					};
				},
			} as unknown as CloudSessionApi,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "workos:fresh",
			getActiveOrganizationId: async () => {
				throw new Error("account endpoint down");
			},
		});
		await expect(
			manager.create({
				modelId: "anthropic/claude-sonnet-5",
				repoUrl: "https://github.com/cline/test",
			}),
		).rejects.toThrow("account endpoint down");
		expect(createInput?.organizationId).toBeUndefined();
	});
});
