import type { HubReplyEnvelope, MessageWithMetadata } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	CloudHandoffCreationRejectedError,
	CloudSessionApi,
	CloudSessionError,
	type CloudSessionRecord,
	type CreateCloudSessionInput,
} from "./api";
import {
	CloudSessionController,
	type CloudSessionControllerOptions,
} from "./controller";
import type { CloudHandoffSeed } from "./types";

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
const seed: CloudHandoffSeed = {
	sourceSessionId: "local-source",
	messages,
	mode: "plan",
	workspaceRelativePath: "packages/app",
	config: { autoApproveTools: false, thinking: true, reasoningEffort: "high" },
};
function fixture() {
	let rows: Record<string, unknown>[] = [];
	let transcript: MessageWithMetadata[] = [];
	let failure: "none" | "timeout" | "malformed" | "send-timeout" = "none";
	const calls: Array<{ name: string; payload?: Record<string, unknown> }> = [];
	const command = vi.fn(
		async (
			name: string,
			payload?: Record<string, unknown>,
			_sessionId?: string,
			options?: { beforeDispatch?: () => void },
		) => {
			options?.beforeDispatch?.();
			calls.push({ name, payload });
			let result: Record<string, unknown> = {};
			if (name === "session.list") result = { sessions: rows };
			if (name === "session.get" || name === "session.attach")
				result = { session: rows[0] };
			if (name === "session.messages") result = { messages: transcript };
			if (name === "session.pending_prompts") result = { prompts: [] };
			if (name === "session.send_input" && failure === "send-timeout")
				throw Object.assign(new Error("lost send reply"), {
					name: "HubTransportError",
					code: "hub_connection_closed",
				});
			if (name === "session.create") {
				if (failure === "timeout")
					throw Object.assign(new Error("lost create reply"), {
						name: "HubCommandError",
						code: "hub_command_timeout",
						command: "session.create",
					});
				if (failure !== "malformed") {
					const config = payload?.sessionConfig as Record<string, unknown>;
					rows = [
						{
							sessionId: "inner-seeded",
							status: "idle",
							metadata: payload?.metadata,
							cwd: config.cwd,
							mode: config.mode,
						},
					];
					transcript = structuredClone(
						(payload?.initialMessages as MessageWithMetadata[]) ?? [],
					);
					result = { session: rows[0] };
				}
			}
			return { version: "v1", ok: true, payload: result } as HubReplyEnvelope;
		},
	);
	const api = {
		create: vi.fn(async (input: CreateCloudSessionInput) => {
			await input.handoff?.onOuterSessionCreated(record.id, { created: true });
			return {
				sessionId: record.id,
				status: "ready",
				sandboxUrl: "",
				cleanupAuthToken: "token",
			};
		}),
		list: vi.fn(async () => [structuredClone(record)]),
		status: vi.fn(async () => ({ status: "ready" })),
		waitUntilReady: vi.fn(async () => {}),
		delete: vi.fn(async () => {}),
		history: vi.fn(async () => null),
		updateTitle: vi.fn(async () => record),
		listRepositories: vi.fn(async () => ({
			connected: true,
			connectUrl: "https://app/integrations",
			repositories: [
				{
					id: 1,
					name: "repo",
					fullName: "cline/repo",
					url: record.repoContext.repoUrl!,
					defaultBranch: "main",
				},
			],
		})),
		listBranches: vi.fn(async () => ({ available: true, branches: ["main"] })),
	};
	const controller = new CloudSessionController({
		api,
		apiBaseUrl: "https://api.example",
		getAuthToken: async () => "token",
		getActiveOrganizationId: async () => "active-org",
		createHubClient: () => ({
			command: command as never,
			connect: async () => {},
			dispose: async () => {},
			getClientId: () => "viewer",
			subscribe: () => () => {},
		}),
	} satisfies CloudSessionControllerOptions);
	return {
		controller,
		api,
		calls,
		setRows: (value: typeof rows) => {
			rows = value;
		},
		setTranscript: (value: typeof transcript) => {
			transcript = value;
		},
		setFailure: (value: typeof failure) => {
			failure = value;
		},
	};
}

describe("seeded cloud handoff controller", () => {
	it("does not use old identical seeded text to confirm a new ambiguous send", async () => {
		const f = fixture();
		await f.controller.seedHandoff(record.id, seed);
		await f.controller.verifyHandoffTranscript(record.id, messages);
		f.setFailure("send-timeout");
		await expect(f.controller.send(record.id, "Prior request")).rejects.toThrow(
			"could not confirm whether this message was accepted",
		);
		await f.controller.dispose();
	});
	it("persists the outer id before reading/seeding and preserves mode, subdirectory and approval policy", async () => {
		const f = fixture();
		const order: string[] = [];
		const result = await f.controller.create({
			requestId: "handoff:stable",
			modelId: "model",
			repoUrl: record.repoContext.repoUrl!,
			organizationId: null,
			...seed.config,
			mode: seed.mode,
			workspaceRelativePath: seed.workspaceRelativePath,
			handoff: {
				sourceSessionId: seed.sourceSessionId,
				onOuterSessionCreated: async () => {
					order.push("persist");
				},
				resolveMessages: async () => {
					order.push("read");
					return messages;
				},
				onSeeding: async () => {
					order.push("dispatch marker");
				},
			},
		});
		expect(order).toEqual(["persist", "read", "dispatch marker"]);
		expect(f.api.create.mock.calls[0][0].organizationId).toBeUndefined();
		expect(result.cwd).toBe("/workspace/packages/app");
		expect(
			f.calls.find((call) => call.name === "session.create")?.payload,
		).toMatchObject({
			initialMessages: messages,
			cwd: "/workspace/packages/app",
			sessionConfig: {
				mode: "plan",
				cwd: "/workspace/packages/app",
				thinking: true,
				reasoningEffort: "high",
			},
			runtimeOptions: { mode: "plan" },
			toolPolicies: { "*": { autoApprove: false } },
			metadata: {
				interactive: true,
				handoff: { sourceSessionId: "local-source", outerSessionId: record.id },
			},
		});
		expect(f.controller.getSnapshot(record.id)?.transcriptKnown).toBe(false);
		await f.controller.verifyHandoffTranscript(record.id, messages);
		expect(f.controller.getSnapshot(record.id)).toMatchObject({
			transcriptKnown: true,
			messages,
			config: { mode: "plan", cwd: "/workspace/packages/app" },
		});
		expect(f.calls.some((call) => call.name === "session.send_input")).toBe(
			false,
		);
		await f.controller.dispose();
	});
	it("adopts a sole matching previously seeded conversation without reseeding", async () => {
		const f = fixture();
		f.setRows([
			{
				sessionId: "existing",
				status: "idle",
				cwd: "/workspace/packages/app",
				mode: "plan",
				metadata: {
					model: "model",
					handoff: { sourceSessionId: seed.sourceSessionId },
				},
			},
		]);
		f.setTranscript(messages);
		await f.controller.seedHandoff(record.id, { ...seed, recoverOnly: true });
		await f.controller.verifyHandoffTranscript(record.id, messages);
		expect(f.calls.filter((call) => call.name === "session.create")).toEqual(
			[],
		);
		await f.controller.dispose();
	});
	it.each([
		"different source",
		"multiple conversations",
	])("refuses %s without mutating the sandbox", async (kind) => {
		const f = fixture();
		const row = {
			sessionId: "existing",
			metadata: {
				handoff: {
					sourceSessionId:
						kind === "different source" ? "other" : seed.sourceSessionId,
				},
			},
		};
		f.setRows(
			kind === "different source"
				? [row]
				: [row, { ...row, sessionId: "second" }],
		);
		await expect(f.controller.seedHandoff(record.id, seed)).rejects.toThrow(
			"another conversation",
		);
		expect(f.calls.filter((call) => call.name === "session.create")).toEqual(
			[],
		);
		expect(f.api.delete).not.toHaveBeenCalled();
		await f.controller.dispose();
	});
	it.each([
		"timeout",
		"malformed",
	] as const)("never repeats an ambiguous seeded create after %s", async (failure) => {
		const f = fixture();
		f.setFailure(failure);
		await expect(f.controller.seedHandoff(record.id, seed)).rejects.toThrow();
		f.setFailure("none");
		await expect(f.controller.seedHandoff(record.id, seed)).rejects.toThrow(
			"unconfirmed",
		);
		expect(
			f.calls.filter((call) => call.name === "session.create"),
		).toHaveLength(1);
		await f.controller.dispose();
	});
	it("respects a durable recovery-only seed fence in a new controller", async () => {
		const f = fixture();
		await expect(
			f.controller.seedHandoff(record.id, { ...seed, recoverOnly: true }),
		).rejects.toThrow("unconfirmed");
		expect(
			f.calls.filter((call) => call.name === "session.create"),
		).toHaveLength(0);
		await f.controller.dispose();
	});
	it("awaits the durable seed marker and cancels safely while it is pending", async () => {
		const f = fixture();
		let release!: () => void;
		const marker = new Promise<void>((resolve) => {
			release = resolve;
		});
		const started = vi.fn(() => marker);
		const pending = f.controller.seedHandoff(record.id, {
			...seed,
			onSeeding: started,
		});
		const rejection = expect(pending).rejects.toThrow();
		await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
		expect(
			f.calls.filter((call) => call.name === "session.create"),
		).toHaveLength(0);
		await f.controller.detach(record.id);
		release();
		await rejection;
		expect(
			f.calls.filter((call) => call.name === "session.create"),
		).toHaveLength(0);
		await f.controller.dispose();
	});
	it("requires a durable read-back and permits appended messages only when requested", async () => {
		const f = fixture();
		await f.controller.seedHandoff(record.id, seed);
		f.setTranscript([]);
		await expect(
			f.controller.verifyHandoffTranscript(record.id, messages),
		).rejects.toMatchObject({ name: "CloudHandoffSeedUnsupportedError" });
		f.setTranscript([...messages, { role: "user", content: "Later" }]);
		await expect(
			f.controller.verifyHandoffTranscript(record.id, messages),
		).rejects.toMatchObject({ name: "CloudHandoffTranscriptMismatchError" });
		await f.controller.verifyHandoffTranscript(record.id, messages, {
			allowAppendedMessages: true,
		});
		expect(f.controller.getSnapshot(record.id)?.messages).toHaveLength(3);
		await f.controller.dispose();
	});
	it.each([
		"../outside",
		"/outside",
		"folder/../outside",
		"folder\\outside",
	])("rejects unsafe cwd %s before provisioning", async (workspaceRelativePath) => {
		const f = fixture();
		await expect(
			f.controller.create({
				requestId: "r",
				modelId: "model",
				repoUrl: "repo",
				workspaceRelativePath,
			}),
		).rejects.toThrow("inside the repository");
		expect(f.api.create).not.toHaveBeenCalled();
		await f.controller.dispose();
	});
	it("distinguishes an absent handoff target from a failed lookup", async () => {
		const f = fixture();
		f.api.status.mockRejectedValueOnce(
			new CloudSessionError("session_not_found", "gone"),
		);
		expect(await f.controller.handoffTargetExists(record.id)).toBe(false);
		f.api.status.mockRejectedValueOnce(new Error("network"));
		await expect(f.controller.handoffTargetExists(record.id)).rejects.toThrow(
			"network",
		);
		await f.controller.prepareHandoffRepository(
			"https://github.com/cline/repo.git",
		);
		await f.controller.dispose();
	});
});

function response(data: unknown, status = 200) {
	return new Response(JSON.stringify({ data }), {
		status,
		headers: { "content-type": "application/json" },
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
describe("seeded cloud provisioning recovery", () => {
	it("awaits durable create intent after lookup and before any POST", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const methods: string[] = [];
		const onCreating = vi.fn(() => gate);
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api",
			appBaseUrl: "https://app",
			getAuthToken: async () => "token",
			fetch: async (_url, init) => {
				methods.push(init?.method ?? "GET");
				return response(
					init?.method === "POST"
						? { sessionId: record.id, status: "ready" }
						: [],
				);
			},
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
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api",
			appBaseUrl: "https://app",
			getAuthToken: async () => "token",
			fetch: async (_url, init) => {
				methods.push(init?.method ?? "GET");
				return response([]);
			},
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
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api",
			appBaseUrl: "https://app",
			getAuthToken: async () => "token",
			fetch: async (_url, init) => {
				if (init?.method === "POST") {
					posts++;
					return response(undefined, status);
				}
				return response([]);
			},
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
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api",
			appBaseUrl: "https://app",
			getAuthToken: async () => "token",
			fetch: async (_url, init) => {
				if (init?.method === "POST") {
					posts++;
					return response(undefined, status);
				}
				return response([]);
			},
		});
		await expect(api.create(input())).rejects.not.toBeInstanceOf(
			CloudHandoffCreationRejectedError,
		);
		await expect(api.create(input())).rejects.toThrow("unconfirmed");
		expect(posts).toBe(1);
	});
	it("does not mark a failed pre-list as definitely rejected or write dispatch intent", async () => {
		const onCreating = vi.fn();
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api",
			appBaseUrl: "https://app",
			getAuthToken: async () => "token",
			fetch: async () => {
				throw new Error("lookup unavailable");
			},
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
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api",
			appBaseUrl: "https://app",
			getAuthToken: async () => "token",
			fetch: async (_url, init) => {
				if (init?.method === "POST") {
					posts++;
					return response({ sessionId: record.id, status: "ready" });
				}
				return response([]);
			},
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
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api",
			appBaseUrl: "https://app",
			getAuthToken: async () => "token",
			fetch,
		});
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
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api",
			appBaseUrl: "https://app",
			getAuthToken: async () => "token",
			fetch: async (_url, init) => {
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
			},
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
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api",
			appBaseUrl: "https://app",
			getAuthToken: async () => "token",
			fetch: async (_url, init) => {
				if (init?.method === "POST") {
					posts++;
					throw new Error("lost response");
				}
				return response([]);
			},
		});
		await expect(api.create(input())).rejects.toThrow("lost response");
		await expect(api.create(input())).rejects.toThrow("unconfirmed");
		expect(posts).toBe(1);
	});
	it("cleans up a newly created outer session when its durable id cannot be saved", async () => {
		const methods: string[] = [];
		const removed = vi.fn(async () => {});
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api",
			appBaseUrl: "https://app",
			getAuthToken: async () => "token",
			fetch: async (_url, init) => {
				methods.push(init?.method ?? "GET");
				return response(
					init?.method === "POST"
						? { sessionId: record.id, status: "ready" }
						: [],
				);
			},
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
		const api = new CloudSessionApi({
			apiBaseUrl: "https://api",
			appBaseUrl: "https://app",
			getAuthToken: async () => "token",
			fetch: async (_url, init) => {
				methods.push(init?.method ?? "GET");
				return response([
					{ ...record, title: "__cline_create_request__:handoff:source:sha" },
				]);
			},
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
