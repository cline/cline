import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { materializeUserFiles } from "./attachments";
import {
	buildSessionConnectionUpdate,
	consumeWorkspaceMetadata,
	handleChatSessionCommand,
	hasProviderChanged,
	mergeSessionConfig,
	prewarmWorkspaceMetadata,
	resolveDesktopSessionMode,
	rewriteDesktopTeamPrompt,
	shouldUpdateSessionConnection,
	WORKSPACE_METADATA_PREWARM_TTL_MS,
} from "./chat-session";
import { handleCoreSessionEvent } from "./context";
import type { SidecarContext } from "./types";

describe("resolveDesktopSessionMode", () => {
	it("does not turn auto-approved Act sessions into Yolo sessions", () => {
		expect(
			resolveDesktopSessionMode({ mode: "act", autoApproveTools: true }),
		).toBe("act");
		expect(resolveDesktopSessionMode({ autoApproveTools: true })).toBe("act");
	});

	it("preserves explicit Plan and Yolo modes", () => {
		expect(resolveDesktopSessionMode({ mode: "plan" })).toBe("plan");
		expect(resolveDesktopSessionMode({ mode: "yolo" })).toBe("yolo");
	});
});

describe("rewriteDesktopTeamPrompt", () => {
	it("rewrites /team for the core runtime", () => {
		expect(
			rewriteDesktopTeamPrompt("/team inspect the app", {
				disabledTools: new Set(),
			}),
		).toBe(
			'<user_command slash="team">spawn a team of agents for the following task: inspect the app</user_command>',
		);
	});

	it("rejects /team when the Teams tool is disabled", () => {
		expect(() =>
			rewriteDesktopTeamPrompt("/team inspect the app", {
				disabledTools: new Set(["teams"]),
			}),
		).toThrow("Agent teams are disabled");
	});

	it("rejects /team when the mode's tool preset has no team tools", () => {
		expect(() =>
			rewriteDesktopTeamPrompt("/team inspect the app", {
				mode: "yolo",
				disabledTools: new Set(),
			}),
		).toThrow("Agent teams are not available in yolo mode");
	});

	it("accepts /team in act and plan modes", () => {
		for (const mode of ["act", "plan", undefined]) {
			expect(
				rewriteDesktopTeamPrompt("/team inspect the app", {
					mode,
					disabledTools: new Set(),
				}),
			).toContain('<user_command slash="team">');
		}
	});
});

describe("buildSessionConnectionUpdate", () => {
	it("does not clear reasoning settings when config omits reasoning fields", () => {
		const update = buildSessionConnectionUpdate({
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
		});

		expect(update).toEqual({
			providerId: "cline",
			modelId: "anthropic/claude-sonnet-4.6",
		});
		expect(Object.hasOwn(update, "thinking")).toBe(false);
		expect(Object.hasOwn(update, "reasoningEffort")).toBe(false);
		expect(Object.hasOwn(update, "thinkingBudgetTokens")).toBe(false);
	});

	it("clears reasoning settings when thinking is explicitly disabled", () => {
		expect(
			buildSessionConnectionUpdate({
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
				thinking: false,
			}),
		).toEqual({
			providerId: "cline",
			modelId: "anthropic/claude-sonnet-4.6",
			thinking: false,
			reasoningEffort: null,
			thinkingBudgetTokens: null,
		});
	});

	it("updates explicit reasoning settings without clearing omitted settings", () => {
		const update = buildSessionConnectionUpdate({
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
			reasoningEffort: "high",
		});

		expect(update).toEqual({
			providerId: "cline",
			modelId: "anthropic/claude-sonnet-4.6",
			thinking: true,
			reasoningEffort: "high",
		});
		expect(Object.hasOwn(update, "thinkingBudgetTokens")).toBe(false);
	});
});

describe("shouldUpdateSessionConnection", () => {
	it("skips the redundant connection update on the first send", () => {
		const config = {
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
			thinking: true,
			reasoningEffort: "high",
		};

		expect(shouldUpdateSessionConnection(config, { ...config })).toBe(false);
	});

	it("updates the connection when the selected reasoning level changes", () => {
		const current = {
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
			thinking: true,
			reasoningEffort: "low",
		};

		expect(
			shouldUpdateSessionConnection(current, {
				...current,
				reasoningEffort: "high",
			}),
		).toBe(true);
	});
});

describe("hasProviderChanged", () => {
	it("distinguishes provider switches from model switches", () => {
		expect(
			hasProviderChanged(
				{ provider: "cline", model: "anthropic/claude-sonnet-4.6" },
				{ provider: "openai-codex", model: "gpt-5.3-codex" },
			),
		).toBe(true);
		expect(
			hasProviderChanged(
				{ provider: "cline", model: "anthropic/claude-sonnet-4.6" },
				{ provider: "cline", model: "openai/gpt-5.3-codex" },
			),
		).toBe(false);
	});

	it("honors a providerId-only update when the stored config uses provider", () => {
		const current = {
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
		};
		const update = {
			providerId: "openai-codex",
			modelId: "gpt-5.3-codex",
		};

		expect(hasProviderChanged(current, update)).toBe(true);
		expect(mergeSessionConfig(current, update)).toMatchObject({
			provider: "openai-codex",
			providerId: "openai-codex",
			model: "gpt-5.3-codex",
			modelId: "gpt-5.3-codex",
		});
	});
});

describe("pathless session starts", () => {
	it("omits workspace paths and returns the SDK-resolved chat workspace", async () => {
		const start = vi.fn(async (input: { config: Record<string, unknown> }) => {
			expect(input.config).not.toHaveProperty("cwd");
			expect(input.config).not.toHaveProperty("workspaceRoot");
			expect(input.config).not.toHaveProperty("enableSpawnAgent");
			expect(input.config).not.toHaveProperty("enableAgentTeams");
			return {
				sessionId: "session-pathless",
				manifest: {
					cwd: "/home/host/.cline/data/workspaces/chat",
					workspace_root: "/home/host/.cline/data/workspaces/chat",
				},
				manifestPath: "/tmp/session-pathless.json",
				messagesPath: "/tmp/session-pathless.messages.json",
			};
		});
		const ctx = {
			liveSessions: new Map(),
			restoringWorkspacePaths: new Set(),
			sessionManager: { start },
		} as unknown as SidecarContext;

		const result = (await handleChatSessionCommand(ctx, {
			action: "start",
			config: {
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
				enableTools: true,
				// Legacy desktop capability flags must not override the SDK's
				// current tool preset or global tool customizations.
				enableSpawn: false,
				enableTeams: false,
			},
		})) as {
			sessionId: string;
			cwd: string;
			workspaceRoot: string;
		};

		expect(result).toEqual({
			sessionId: "session-pathless",
			cwd: "/home/host/.cline/data/workspaces/chat",
			workspaceRoot: "/home/host/.cline/data/workspaces/chat",
		});
		expect(ctx.liveSessions.get("session-pathless")?.config).toMatchObject({
			cwd: "/home/host/.cline/data/workspaces/chat",
			workspaceRoot: "/home/host/.cline/data/workspaces/chat",
		});
	});
});

describe("session forks", () => {
	it("restores the selected workspace checkpoint before forking for message editing", async () => {
		const sourceSessionId = `source-fork-${Date.now()}`;
		const sourceMessages = [
			{ role: "user" as const, content: "first prompt" },
			{ role: "assistant" as const, content: "first response" },
			{ role: "user" as const, content: "prompt to edit" },
			{ role: "assistant" as const, content: "response to replace" },
		];
		const expectedMessages = sourceMessages.slice(0, 2);
		const start = vi.fn(async () => ({ sessionId: "edited-fork" }));
		const restore = vi.fn(async () => ({
			sessionId: "edited-fork",
			messages: sourceMessages.slice(0, 3),
			checkpoint: {
				ref: "second",
				createdAt: 2,
				runCount: 2,
			},
		}));
		const readMessages = vi.fn(async () => expectedMessages);
		const ctx = {
			liveSessions: new Map([
				[
					sourceSessionId,
					{
						config: {
							provider: "cline",
							model: "anthropic/claude-sonnet-4.6",
						},
						messages: sourceMessages,
						promptsInQueue: [],
						busy: false,
						startedAt: Date.now(),
						status: "completed",
					},
				],
			]),
			restoringWorkspacePaths: new Set(),
			sessionManager: {
				get: vi.fn(async () => ({
					sessionId: sourceSessionId,
					source: "desktop",
					status: "completed",
					provider: "cline",
					model: "anthropic/claude-sonnet-4.6",
					cwd: "/workspace/project",
					workspaceRoot: "/workspace/project",
					metadata: {
						checkpoint: {
							latest: { ref: "second", createdAt: 2, runCount: 2 },
							history: [
								{ ref: "first", createdAt: 1, runCount: 1 },
								{ ref: "second", createdAt: 2, runCount: 2 },
							],
						},
					},
				})),
				readMessages,
				restore,
				start,
			},
			streamIndices: new Map(),
			wsClients: new Set(),
		} as unknown as SidecarContext;

		const result = (await handleChatSessionCommand(ctx, {
			action: "fork",
			sessionId: sourceSessionId,
			forkBeforeRunCount: 2,
			config: {
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
			},
		})) as { sessionId: string; messages: unknown[] };

		expect(restore).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: sourceSessionId,
				checkpointRunCount: 2,
				cwd: "/workspace/project",
				restore: {
					messages: true,
					workspace: true,
					omitCheckpointMessageFromSession: true,
				},
				start: expect.objectContaining({
					sessionMetadata: expect.objectContaining({
						fork: expect.objectContaining({
							forkedFromSessionId: sourceSessionId,
							beforeRunCount: 2,
						}),
					}),
				}),
			}),
		);
		expect(start).not.toHaveBeenCalled();
		expect(readMessages).toHaveBeenCalledWith("edited-fork");
		expect(result).toEqual({
			sessionId: "edited-fork",
			forkedFromSessionId: sourceSessionId,
		});
		expect(ctx.liveSessions.get("edited-fork")?.messages).toEqual(
			expectedMessages,
		);
		expect(ctx.restoringWorkspacePaths.size).toBe(0);
	});

	it("holds the workspace lock for the full edit restore", async () => {
		const sourceSessionId = `locking-source-${Date.now()}`;
		const siblingSessionId = `locking-sibling-${Date.now()}`;
		const sourceMessages = [
			{ role: "user" as const, content: "first prompt" },
			{ role: "assistant" as const, content: "first response" },
		];
		let releaseRestore = () => {};
		const restoreGate = new Promise<void>((resolve) => {
			releaseRestore = resolve;
		});
		let markRestoreStarted = () => {};
		const restoreStarted = new Promise<void>((resolve) => {
			markRestoreStarted = resolve;
		});
		const send = vi.fn();
		const restore = vi.fn(async () => {
			markRestoreStarted();
			await restoreGate;
			return {
				sessionId: "locked-edited-fork",
				messages: sourceMessages,
				checkpoint: { ref: "first", createdAt: 1, runCount: 1 },
			};
		});
		const ctx = {
			liveSessions: new Map([
				[
					sourceSessionId,
					{
						config: {
							provider: "cline",
							model: "anthropic/claude-sonnet-4.6",
							cwd: "/workspace/project",
						},
						messages: sourceMessages,
						promptsInQueue: [],
						busy: false,
						startedAt: Date.now(),
						status: "idle",
					},
				],
				[
					siblingSessionId,
					{
						config: { workspaceRoot: "/workspace/project/." },
						messages: [],
						promptsInQueue: [],
						busy: false,
						startedAt: Date.now(),
						status: "idle",
					},
				],
			]),
			restoringWorkspacePaths: new Set(),
			sessionManager: {
				get: vi.fn(async () => ({
					sessionId: sourceSessionId,
					source: "desktop",
					status: "completed",
					provider: "cline",
					model: "anthropic/claude-sonnet-4.6",
					cwd: "/workspace/project",
					workspaceRoot: "/workspace/project",
					metadata: {
						checkpoint: {
							latest: { ref: "first", createdAt: 1, runCount: 1 },
							history: [{ ref: "first", createdAt: 1, runCount: 1 }],
						},
					},
				})),
				readMessages: vi.fn(async () => sourceMessages),
				restore,
				send,
			},
			streamIndices: new Map(),
			wsClients: new Set(),
		} as unknown as SidecarContext;

		const fork = handleChatSessionCommand(ctx, {
			action: "fork",
			sessionId: sourceSessionId,
			forkBeforeRunCount: 1,
		});
		await restoreStarted;
		try {
			expect(ctx.restoringWorkspacePaths).toEqual(
				new Set(["/workspace/project"]),
			);
			await expect(
				handleChatSessionCommand(ctx, {
					action: "send",
					sessionId: siblingSessionId,
					prompt: "race",
				}),
			).rejects.toThrow(
				"Cannot send a prompt while the session workspace is being restored",
			);
			expect(send).not.toHaveBeenCalled();
		} finally {
			releaseRestore();
		}

		await expect(fork).resolves.toMatchObject({
			sessionId: "locked-edited-fork",
		});
		expect(ctx.restoringWorkspacePaths.size).toBe(0);
	});

	it("keeps a full-history fork on the current workspace without restoring", async () => {
		const sourceSessionId = `source-full-fork-${Date.now()}`;
		const sourceMessages = [
			{ role: "user" as const, content: "first prompt" },
			{ role: "assistant" as const, content: "first response" },
		];
		const start = vi.fn(async () => ({ sessionId: "full-fork" }));
		const restore = vi.fn();
		const readMessages = vi.fn(async () => sourceMessages);
		const ctx = {
			liveSessions: new Map([
				[
					sourceSessionId,
					{
						config: {
							provider: "cline",
							model: "anthropic/claude-sonnet-4.6",
						},
						messages: sourceMessages,
						promptsInQueue: [],
						busy: false,
						startedAt: Date.now(),
						status: "completed",
					},
				],
			]),
			restoringWorkspacePaths: new Set(),
			sessionManager: {
				get: vi.fn(async () => ({
					sessionId: sourceSessionId,
					source: "desktop",
					status: "completed",
					provider: "cline",
					model: "anthropic/claude-sonnet-4.6",
					cwd: "/workspace/project",
					workspaceRoot: "/workspace/project",
				})),
				readMessages,
				restore,
				start,
			},
			streamIndices: new Map(),
			wsClients: new Set(),
		} as unknown as SidecarContext;

		await handleChatSessionCommand(ctx, {
			action: "fork",
			sessionId: sourceSessionId,
			config: {
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
			},
		});

		expect(restore).not.toHaveBeenCalled();
		expect(start).toHaveBeenCalledWith(
			expect.objectContaining({ initialMessages: sourceMessages }),
		);
	});

	it("rejects an edit fork while the source session is running", async () => {
		const restore = vi.fn();
		const sourceSessionId = "busy-source-session";
		const ctx = {
			liveSessions: new Map([
				[
					sourceSessionId,
					{
						config: {},
						messages: [{ role: "user", content: "prompt" }],
						promptsInQueue: [],
						busy: true,
						startedAt: Date.now(),
						status: "running",
					},
				],
			]),
			restoringWorkspacePaths: new Set(),
			sessionManager: { restore },
		} as unknown as SidecarContext;

		await expect(
			handleChatSessionCommand(ctx, {
				action: "fork",
				sessionId: sourceSessionId,
				forkBeforeRunCount: 1,
			}),
		).rejects.toThrow("Wait for all turns in this workspace to finish");
		expect(restore).not.toHaveBeenCalled();
	});

	it("rejects an edit fork when the persisted session is still active", async () => {
		const restore = vi.fn();
		const sourceSessionId = "persisted-running-session";
		const ctx = {
			liveSessions: new Map([
				[
					sourceSessionId,
					{
						config: {},
						messages: [{ role: "user", content: "prompt" }],
						promptsInQueue: [],
						busy: false,
						startedAt: Date.now(),
						status: "idle",
					},
				],
			]),
			restoringWorkspacePaths: new Set(),
			sessionManager: {
				get: vi.fn(async () => ({
					sessionId: sourceSessionId,
					status: "running",
				})),
				restore,
			},
		} as unknown as SidecarContext;

		await expect(
			handleChatSessionCommand(ctx, {
				action: "fork",
				sessionId: sourceSessionId,
				forkBeforeRunCount: 1,
			}),
		).rejects.toThrow("Wait for all turns in this workspace to finish");
		expect(restore).not.toHaveBeenCalled();
		expect(ctx.restoringWorkspacePaths.size).toBe(0);
	});

	it("rejects an edit fork while a sibling session in the workspace is running", async () => {
		const sourceSessionId = "idle-source-session";
		const siblingSessionId = "busy-sibling-session";
		const restore = vi.fn();
		const ctx = {
			liveSessions: new Map([
				[
					sourceSessionId,
					{
						config: { cwd: "/workspace/project" },
						messages: [{ role: "user", content: "prompt" }],
						promptsInQueue: [],
						busy: false,
						startedAt: Date.now(),
						status: "idle",
					},
				],
				[
					siblingSessionId,
					{
						config: { workspaceRoot: "/workspace/project/." },
						messages: [],
						promptsInQueue: [],
						busy: true,
						startedAt: Date.now(),
						status: "running",
					},
				],
			]),
			restoringWorkspacePaths: new Set(),
			sessionManager: {
				get: vi.fn(async () => ({
					sessionId: sourceSessionId,
					status: "completed",
					cwd: "/workspace/project",
					workspaceRoot: "/workspace/project",
				})),
				restore,
			},
		} as unknown as SidecarContext;

		await expect(
			handleChatSessionCommand(ctx, {
				action: "fork",
				sessionId: sourceSessionId,
				forkBeforeRunCount: 1,
			}),
		).rejects.toThrow("Wait for all turns in this workspace to finish");
		expect(restore).not.toHaveBeenCalled();
		expect(ctx.restoringWorkspacePaths.size).toBe(0);
	});

	it("allows a workspace restore after a queued turn completes through the event stream", async () => {
		const sessionId = `queued-turn-session-${Date.now()}`;
		const dataDir = mkdtempSync(join(tmpdir(), "cline-queued-restore-"));
		const originalDataDir = process.env.CLINE_SESSION_DATA_DIR;
		process.env.CLINE_SESSION_DATA_DIR = dataDir;
		try {
			const restore = vi.fn(async () => ({
				sessionId,
				messages: [{ role: "user", content: "first prompt" }],
				checkpoint: { ref: "first", createdAt: 1, runCount: 1 },
			}));
			const ctx = {
				liveSessions: new Map([
					[
						sessionId,
						{
							config: { cwd: "/workspace/project" },
							messages: [{ role: "user", content: "first prompt" }],
							promptsInQueue: [],
							// A drained queued turn is running: no send() RPC owns
							// this turn's busy flag, only the event stream does.
							busy: true,
							startedAt: Date.now(),
							status: "running",
						},
					],
				]),
				restoringWorkspacePaths: new Set(),
				streamIndices: new Map(),
				wsClients: new Set(),
				sessionManager: { restore },
			} as unknown as SidecarContext;
			const restoreRequest = {
				action: "restore_checkpoint" as const,
				sessionId,
				checkpointRunCount: 1,
				config: {
					cwd: "/workspace/project",
					provider: "cline",
					model: "test-model",
				},
			};

			// While the queued turn is still running the workspace stays locked.
			await expect(
				handleChatSessionCommand(ctx, restoreRequest),
			).rejects.toThrow("Wait for all turns in this workspace to finish");
			expect(restore).not.toHaveBeenCalled();

			// The queued turn settles through the event stream: the runtime
			// host reports the session back at idle (there is no send() RPC
			// response to clear the busy flag for event-settled turns).
			handleCoreSessionEvent(ctx, {
				type: "status",
				payload: { sessionId, status: "idle" },
			});
			expect(ctx.liveSessions.get(sessionId)).toMatchObject({
				busy: false,
				status: "idle",
			});

			await expect(
				handleChatSessionCommand(ctx, restoreRequest),
			).resolves.toMatchObject({ sessionId });
			expect(restore).toHaveBeenCalledTimes(1);
		} finally {
			if (originalDataDir === undefined) {
				delete process.env.CLINE_SESSION_DATA_DIR;
			} else {
				process.env.CLINE_SESSION_DATA_DIR = originalDataDir;
			}
			rmSync(dataDir, { force: true, recursive: true });
		}
	});

	it("blocks sends from sibling sessions while their workspace is restored", async () => {
		const send = vi.fn();
		const sessionId = "workspace-sibling-session";
		const ctx = {
			liveSessions: new Map([
				[
					sessionId,
					{
						config: { workspaceRoot: "/workspace/project/." },
						messages: [{ role: "user", content: "prompt" }],
						promptsInQueue: [],
						busy: false,
						startedAt: Date.now(),
						status: "idle",
					},
				],
			]),
			restoringWorkspacePaths: new Set(["/workspace/project"]),
			sessionManager: { send },
		} as unknown as SidecarContext;

		await expect(
			handleChatSessionCommand(ctx, {
				action: "send",
				sessionId,
				prompt: "race",
			}),
		).rejects.toThrow(
			"Cannot send a prompt while the session workspace is being restored",
		);
		expect(send).not.toHaveBeenCalled();
	});
});

describe("first-send connection updates", () => {
	const baseConfig = {
		provider: "cline",
		model: "anthropic/claude-sonnet-4.6",
		thinking: true,
		reasoningEffort: "high",
	};

	function createContext(options?: {
		attachedViaHub?: boolean;
		config?: Record<string, unknown>;
	}) {
		const updateSessionConnection = vi.fn(async () => undefined);
		const send = vi.fn(async (_input?: unknown) => ({
			text: "done",
			finishReason: "completed",
			messages: [],
		}));
		const readMessages = vi.fn(async () => [
			{ role: "user", content: "first prompt" },
			{ role: "assistant", content: "first response" },
		]);
		const readSessionCompactionState = vi.fn(async () => undefined);
		const stop = vi.fn(async () => undefined);
		const sessionId = "session-connection-test";
		const start = vi.fn(async (_input?: unknown) => ({ sessionId }));
		const ctx = {
			liveSessions: new Map([
				[
					sessionId,
					{
						config: options?.config ?? baseConfig,
						messages: [],
						promptsInQueue: [],
						busy: false,
						startedAt: Date.now(),
						status: "idle",
						attachedViaHub: options?.attachedViaHub ?? false,
					},
				],
			]),
			restoringWorkspacePaths: new Set(),
			streamIndices: new Map(),
			wsClients: new Set(),
			sessionManager: {
				readMessages,
				readSessionCompactionState,
				send,
				start,
				stop,
				updateSessionConnection,
				pendingPrompts: {
					list: vi.fn(async () => []),
				},
			},
		} as unknown as SidecarContext;
		return {
			ctx,
			readMessages,
			send,
			sessionId,
			start,
			stop,
			updateSessionConnection,
		};
	}

	it("skips an identical update for a locally-created session", async () => {
		const { ctx, send, sessionId, updateSessionConnection } = createContext();

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "hello",
			config: { ...baseConfig },
		});

		expect(updateSessionConnection).not.toHaveBeenCalled();
		expect(send).toHaveBeenCalledTimes(1);
	});

	it("allows an image-only user turn", async () => {
		const { ctx, send, sessionId } = createContext();

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "",
			attachments: {
				userImages: ["data:image/png;base64,aGVsbG8="],
				userFiles: [],
			},
		});

		expect(send).toHaveBeenCalledWith({
			sessionId,
			prompt: "",
			delivery: undefined,
			userImages: ["data:image/png;base64,aGVsbG8="],
		});
	});

	it.each([
		undefined,
		"queue",
	] as const)("forwards file attachments for %s delivery", async (delivery) => {
		const { ctx, send, sessionId } = createContext();
		const previousSessionDataDir = process.env.CLINE_SESSION_DATA_DIR;
		const testSessionDataDir = join(
			tmpdir(),
			`cline-desktop-attachments-${Date.now()}-${delivery ?? "immediate"}`,
		);
		let sentFileContent: string | undefined;
		send.mockImplementation(async (input?: unknown) => {
			const files = (input as { userFiles?: string[] } | undefined)?.userFiles;
			if (files?.[0]) {
				sentFileContent = readFileSync(files[0], "utf8");
			}
			return { text: "done", finishReason: "completed", messages: [] };
		});

		try {
			process.env.CLINE_SESSION_DATA_DIR = testSessionDataDir;
			await handleChatSessionCommand(ctx, {
				action: "send",
				sessionId,
				prompt: "",
				delivery,
				attachments: {
					userFiles: [{ name: "notes.txt", content: "hello" }],
				},
			});

			const input = send.mock.calls[0]?.[0] as
				| { userFiles?: string[] }
				| undefined;
			expect(send).toHaveBeenCalledWith({
				sessionId,
				prompt: "",
				delivery,
				userImages: undefined,
				userFiles: [expect.stringMatching(/notes\.txt$/)],
			});
			expect(sentFileContent).toBe("hello");
			if (delivery === "queue") {
				// Queued attachments stay on disk until the prompt is consumed.
				expect(existsSync(input?.userFiles?.[0] ?? "")).toBe(true);
			} else {
				// Immediate turns delete the materialized file once the send resolves.
				expect(existsSync(input?.userFiles?.[0] ?? "")).toBe(false);
			}
		} finally {
			if (previousSessionDataDir === undefined) {
				delete process.env.CLINE_SESSION_DATA_DIR;
			} else {
				process.env.CLINE_SESSION_DATA_DIR = previousSessionDataDir;
			}
			rmSync(testSessionDataDir, { recursive: true, force: true });
		}
	});

	it("deletes materialized attachments when a queued prompt is removed", async () => {
		const { ctx, send, sessionId } = createContext();
		const previousSessionDataDir = process.env.CLINE_SESSION_DATA_DIR;
		const testSessionDataDir = join(
			tmpdir(),
			`cline-desktop-attachments-remove-${Date.now()}`,
		);

		try {
			process.env.CLINE_SESSION_DATA_DIR = testSessionDataDir;
			const queue: Array<{
				id: string;
				prompt: string;
				delivery: "queue";
				attachmentCount: number;
				userFiles?: string[];
			}> = [];
			const manager = ctx.sessionManager as unknown as {
				send: typeof send;
				pendingPrompts: {
					list: (input: unknown) => Promise<unknown[]>;
					delete: (input: {
						sessionId: string;
						promptId: string;
					}) => Promise<unknown>;
				};
			};
			manager.send = vi.fn(async (input?: unknown) => {
				const { prompt, userFiles } = input as {
					prompt: string;
					userFiles?: string[];
				};
				queue.push({
					id: "pending_1",
					prompt,
					delivery: "queue",
					attachmentCount: userFiles?.length ?? 0,
					userFiles,
				});
				return undefined;
			}) as unknown as typeof send;
			manager.pendingPrompts = {
				list: vi.fn(async () => [...queue]),
				delete: vi.fn(async ({ promptId }) => {
					const index = queue.findIndex((entry) => entry.id === promptId);
					const [removed] = index >= 0 ? queue.splice(index, 1) : [];
					return {
						sessionId,
						prompts: [...queue],
						prompt: removed,
						removed: index >= 0,
					};
				}),
			};

			await handleChatSessionCommand(ctx, {
				action: "send",
				sessionId,
				prompt: "queued with file",
				delivery: "queue",
				attachments: {
					userFiles: [{ name: "notes.txt", content: "hello" }],
				},
			});
			const filePath = queue[0]?.userFiles?.[0] ?? "";
			expect(existsSync(filePath)).toBe(true);
			expect(
				ctx.liveSessions
					.get(sessionId)
					?.queuedAttachmentFiles?.get("pending_1"),
			).toEqual([filePath]);

			await handleChatSessionCommand(ctx, {
				action: "remove_pending_prompt",
				sessionId,
				promptId: "pending_1",
			});
			expect(existsSync(filePath)).toBe(false);
			expect(
				ctx.liveSessions.get(sessionId)?.queuedAttachmentFiles?.size ?? 0,
			).toBe(0);
		} finally {
			if (previousSessionDataDir === undefined) {
				delete process.env.CLINE_SESSION_DATA_DIR;
			} else {
				process.env.CLINE_SESSION_DATA_DIR = previousSessionDataDir;
			}
			rmSync(testSessionDataDir, { recursive: true, force: true });
		}
	});

	it("deletes tracked attachments when a session is reset", async () => {
		const { ctx, sessionId } = createContext();
		const previousSessionDataDir = process.env.CLINE_SESSION_DATA_DIR;
		const testSessionDataDir = join(
			tmpdir(),
			`cline-desktop-attachments-reset-${Date.now()}`,
		);

		try {
			process.env.CLINE_SESSION_DATA_DIR = testSessionDataDir;
			const [queuedFile] = materializeUserFiles(sessionId, [
				{ name: "queued.txt", content: "q" },
			]) as string[];
			const [consumedFile] = materializeUserFiles(sessionId, [
				{ name: "consumed.txt", content: "c" },
			]) as string[];
			const session = ctx.liveSessions.get(sessionId);
			if (!session) throw new Error("missing session");
			session.queuedAttachmentFiles = new Map([["pending_1", [queuedFile]]]);
			session.consumedAttachmentFiles = new Map([
				["pending_2", [consumedFile]],
			]);

			await handleChatSessionCommand(ctx, {
				action: "reset",
				sessionId,
			});

			expect(existsSync(queuedFile)).toBe(false);
			expect(existsSync(consumedFile)).toBe(false);
			expect(ctx.liveSessions.has(sessionId)).toBe(false);
		} finally {
			if (previousSessionDataDir === undefined) {
				delete process.env.CLINE_SESSION_DATA_DIR;
			} else {
				process.env.CLINE_SESSION_DATA_DIR = previousSessionDataDir;
			}
			rmSync(testSessionDataDir, { recursive: true, force: true });
		}
	});

	it("preserves tracked attachments across re-attach", async () => {
		const { ctx, sessionId } = createContext();
		const previousSessionDataDir = process.env.CLINE_SESSION_DATA_DIR;
		const testSessionDataDir = join(
			tmpdir(),
			`cline-desktop-attachments-attach-${Date.now()}`,
		);

		try {
			process.env.CLINE_SESSION_DATA_DIR = testSessionDataDir;
			const [queuedFile] = materializeUserFiles(sessionId, [
				{ name: "queued.txt", content: "q" },
			]) as string[];
			const session = ctx.liveSessions.get(sessionId);
			if (!session) throw new Error("missing session");
			const queuedMap = new Map([["pending_1", [queuedFile]]]);
			session.queuedAttachmentFiles = queuedMap;
			(ctx.sessionManager as unknown as { get: unknown }).get = vi.fn(
				async () => ({
					status: "idle",
					provider: "cline",
					model: "anthropic/claude-sonnet-4.6",
					cwd: "/workspace",
					workspaceRoot: "/workspace",
				}),
			);

			await handleChatSessionCommand(ctx, {
				action: "attach",
				sessionId,
			});

			expect(existsSync(queuedFile)).toBe(true);
			expect(
				ctx.liveSessions
					.get(sessionId)
					?.queuedAttachmentFiles?.get("pending_1"),
			).toEqual([queuedFile]);
		} finally {
			if (previousSessionDataDir === undefined) {
				delete process.env.CLINE_SESSION_DATA_DIR;
			} else {
				process.env.CLINE_SESSION_DATA_DIR = previousSessionDataDir;
			}
			rmSync(testSessionDataDir, { recursive: true, force: true });
		}
	});

	it("updates a changed connection before sending", async () => {
		const { ctx, send, sessionId, updateSessionConnection } = createContext({
			config: { ...baseConfig, reasoningEffort: "low" },
		});

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "hello",
			config: { ...baseConfig },
		});

		expect(updateSessionConnection).toHaveBeenCalledTimes(1);
		expect(updateSessionConnection.mock.invocationCallOrder[0]).toBeLessThan(
			send.mock.invocationCallOrder[0] ?? 0,
		);
	});

	it("rebuilds the same session with its transcript before a provider switch", async () => {
		const {
			ctx,
			readMessages,
			send,
			sessionId,
			start,
			stop,
			updateSessionConnection,
		} = createContext();

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "continue with Codex",
			config: {
				...baseConfig,
				provider: "openai-codex",
				model: "gpt-5.3-codex",
			},
		});

		expect(readMessages).toHaveBeenCalledWith(sessionId);
		expect(stop).toHaveBeenCalledWith(sessionId);
		expect(start).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					providerId: "openai-codex",
					modelId: "gpt-5.3-codex",
					sessionId,
				}),
				initialMessages: [
					{ role: "user", content: "first prompt" },
					{ role: "assistant", content: "first response" },
				],
			}),
		);
		expect(updateSessionConnection).toHaveBeenCalledWith(sessionId, {
			providerId: "openai-codex",
			modelId: "gpt-5.3-codex",
			thinking: true,
			reasoningEffort: "high",
			thinkingBudgetTokens: null,
		});
		expect(start.mock.invocationCallOrder[0]).toBeLessThan(
			send.mock.invocationCallOrder[0] ?? 0,
		);
	});

	it("blocks a concurrent send throughout provider-switch preparation", async () => {
		let resolveMessages:
			| ((messages: Array<{ role: string; content: string }>) => void)
			| undefined;
		const messages = new Promise<Array<{ role: string; content: string }>>(
			(resolve) => {
				resolveMessages = resolve;
			},
		);
		const { ctx, readMessages, sessionId } = createContext();
		readMessages.mockImplementationOnce(async () => await messages);

		const switching = handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "continue with Codex",
			config: {
				...baseConfig,
				provider: "openai-codex",
				model: "gpt-5.3-codex",
			},
		});
		await vi.waitFor(() => expect(readMessages).toHaveBeenCalledOnce());

		await expect(
			handleChatSessionCommand(ctx, {
				action: "send",
				sessionId,
				prompt: "racing prompt",
				config: { ...baseConfig },
			}),
		).rejects.toThrow("A provider switch is already in progress");

		resolveMessages?.([
			{ role: "user", content: "first prompt" },
			{ role: "assistant", content: "first response" },
		]);
		await switching;
	});

	it.each([
		"queue",
		"steer",
	] as const)("locks provider-switch preparation for explicit %s delivery", async (delivery) => {
		let resolveMessages:
			| ((messages: Array<{ role: string; content: string }>) => void)
			| undefined;
		const messages = new Promise<Array<{ role: string; content: string }>>(
			(resolve) => {
				resolveMessages = resolve;
			},
		);
		const { ctx, readMessages, sessionId } = createContext();
		readMessages.mockImplementationOnce(async () => await messages);

		const switching = handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "queue this for Codex",
			delivery,
			config: {
				...baseConfig,
				provider: "openai-codex",
				model: "gpt-5.3-codex",
			},
		});
		await vi.waitFor(() => expect(readMessages).toHaveBeenCalledOnce());

		await expect(
			handleChatSessionCommand(ctx, {
				action: "send",
				sessionId,
				prompt: "racing prompt",
				config: { ...baseConfig },
			}),
		).rejects.toThrow("A provider switch is already in progress");

		resolveMessages?.([
			{ role: "user", content: "first prompt" },
			{ role: "assistant", content: "first response" },
		]);
		await switching;
	});

	it("restores the previous provider runtime when replacement startup fails", async () => {
		const { ctx, send, sessionId, start, stop } = createContext();
		const previousKanbanDataDir = process.env.CLINE_KANBAN_DATA_DIR;
		const testKanbanDataDir = join(
			tmpdir(),
			`cline-provider-rollback-${process.pid}`,
		);
		process.env.CLINE_KANBAN_DATA_DIR = testKanbanDataDir;
		start
			.mockRejectedValueOnce(new Error("Codex bootstrap failed"))
			.mockResolvedValueOnce({ sessionId });

		try {
			const result = (await handleChatSessionCommand(ctx, {
				action: "send",
				sessionId,
				prompt: "continue with Codex",
				config: {
					...baseConfig,
					provider: "openai-codex",
					model: "gpt-5.3-codex",
				},
			})) as { result?: { finishReason?: string; text?: string } };

			expect(stop).toHaveBeenCalledOnce();
			expect(start).toHaveBeenCalledTimes(2);
			expect(start.mock.calls[1]?.[0]).toEqual(
				expect.objectContaining({
					config: expect.objectContaining({
						providerId: "cline",
						modelId: "anthropic/claude-sonnet-4.6",
						sessionId,
					}),
				}),
			);
			expect(send).not.toHaveBeenCalled();
			expect(result.result).toEqual({
				finishReason: "error",
				text: "Codex bootstrap failed",
			});

			await handleChatSessionCommand(ctx, {
				action: "send",
				sessionId,
				prompt: "continue with Cline",
				config: { ...baseConfig },
			});
			expect(send).toHaveBeenCalledOnce();
		} finally {
			if (previousKanbanDataDir === undefined) {
				delete process.env.CLINE_KANBAN_DATA_DIR;
			} else {
				process.env.CLINE_KANBAN_DATA_DIR = previousKanbanDataDir;
			}
			rmSync(testKanbanDataDir, { recursive: true, force: true });
		}
	});

	it("restores the previous provider when replacement label sync fails", async () => {
		const { ctx, send, sessionId, start, stop, updateSessionConnection } =
			createContext();
		const previousKanbanDataDir = process.env.CLINE_KANBAN_DATA_DIR;
		const testKanbanDataDir = join(
			tmpdir(),
			`cline-provider-label-rollback-${process.pid}`,
		);
		process.env.CLINE_KANBAN_DATA_DIR = testKanbanDataDir;
		try {
			updateSessionConnection
				.mockRejectedValueOnce(new Error("manifest write failed"))
				.mockResolvedValueOnce(undefined);

			const result = (await handleChatSessionCommand(ctx, {
				action: "send",
				sessionId,
				prompt: "continue with Codex",
				config: {
					...baseConfig,
					provider: "openai-codex",
					model: "gpt-5.3-codex",
				},
			})) as { result?: { finishReason?: string; text?: string } };

			expect(stop).toHaveBeenCalledTimes(2);
			expect(start).toHaveBeenCalledTimes(2);
			expect(start.mock.calls[1]?.[0]).toEqual(
				expect.objectContaining({
					config: expect.objectContaining({
						providerId: "cline",
						modelId: "anthropic/claude-sonnet-4.6",
						sessionId,
					}),
				}),
			);
			expect(updateSessionConnection).toHaveBeenNthCalledWith(2, sessionId, {
				providerId: "cline",
				modelId: "anthropic/claude-sonnet-4.6",
				thinking: true,
				reasoningEffort: "high",
				thinkingBudgetTokens: null,
			});
			expect(send).not.toHaveBeenCalled();
			expect(result.result).toEqual({
				finishReason: "error",
				text: "manifest write failed",
			});
			expect(ctx.liveSessions.get(sessionId)?.config).toEqual(baseConfig);

			await handleChatSessionCommand(ctx, {
				action: "send",
				sessionId,
				prompt: "continue with Cline",
				config: { ...baseConfig },
			});
			expect(send).toHaveBeenCalledOnce();
			expect(start).toHaveBeenCalledTimes(2);
		} finally {
			if (previousKanbanDataDir === undefined) {
				delete process.env.CLINE_KANBAN_DATA_DIR;
			} else {
				process.env.CLINE_KANBAN_DATA_DIR = previousKanbanDataDir;
			}
			rmSync(testKanbanDataDir, { recursive: true, force: true });
		}
	});

	it("refreshes hub-attached sessions even when the cached config matches", async () => {
		const { ctx, sessionId, updateSessionConnection } = createContext({
			attachedViaHub: true,
		});

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "hello",
			config: { ...baseConfig },
		});

		expect(updateSessionConnection).toHaveBeenCalledTimes(1);
		expect(ctx.liveSessions.get(sessionId)?.attachedViaHub).toBe(false);
	});
});

describe("workspace metadata prewarming", () => {
	it("reuses one in-flight scan and consumes it only once", async () => {
		let resolveFirst: ((value: string) => void) | undefined;
		const firstResult = new Promise<string>((resolve) => {
			resolveFirst = resolve;
		});
		const load = vi
			.fn<(cwd: string) => Promise<string>>()
			.mockImplementationOnce(async () => await firstResult)
			.mockResolvedValueOnce("fresh metadata");
		const cwd = "/tmp/cline-desktop-prewarm-reuse";

		prewarmWorkspaceMetadata(cwd, load);
		const consumed = consumeWorkspaceMetadata(cwd, load);
		expect(load).toHaveBeenCalledTimes(1);
		resolveFirst?.("prewarmed metadata");

		await expect(consumed).resolves.toBe("prewarmed metadata");
		await expect(consumeWorkspaceMetadata(cwd, load)).resolves.toBe(
			"fresh metadata",
		);
		expect(load).toHaveBeenCalledTimes(2);
	});

	it("evicts failed scans so the next session can retry", async () => {
		const load = vi
			.fn<(cwd: string) => Promise<string>>()
			.mockRejectedValueOnce(new Error("git unavailable"))
			.mockResolvedValueOnce("recovered metadata");
		const cwd = "/tmp/cline-desktop-prewarm-retry";

		prewarmWorkspaceMetadata(cwd, load);
		await expect(consumeWorkspaceMetadata(cwd, load)).rejects.toThrow(
			"git unavailable",
		);
		await expect(consumeWorkspaceMetadata(cwd, load)).resolves.toBe(
			"recovered metadata",
		);
		expect(load).toHaveBeenCalledTimes(2);
	});

	it("keeps different workspaces in separate single-flight entries", () => {
		const load = vi.fn(async (cwd: string) => `metadata for ${cwd}`);

		prewarmWorkspaceMetadata("/tmp/cline-desktop-prewarm-a", load);
		prewarmWorkspaceMetadata("/tmp/cline-desktop-prewarm-b", load);

		expect(load).toHaveBeenCalledTimes(2);
	});

	it("refreshes a prewarm that is older than the startup window", async () => {
		const load = vi
			.fn<(cwd: string) => Promise<string>>()
			.mockResolvedValueOnce("startup metadata")
			.mockResolvedValueOnce("current metadata");
		const cwd = "/tmp/cline-desktop-prewarm-expired";

		prewarmWorkspaceMetadata(cwd, load, () => 0);
		await expect(
			consumeWorkspaceMetadata(
				cwd,
				load,
				() => WORKSPACE_METADATA_PREWARM_TTL_MS + 1,
			),
		).resolves.toBe("current metadata");
		expect(load).toHaveBeenCalledTimes(2);
	});
});

describe("runtime slash command expansion on send", () => {
	const tempRoots: string[] = [];

	afterEach(() => {
		for (const dir of tempRoots) {
			rmSync(dir, { recursive: true, force: true });
		}
		tempRoots.length = 0;
	});

	function createWorkspaceWithSkill(): string {
		const workspace = mkdtempSync(join(tmpdir(), "desktop-slash-send-"));
		tempRoots.push(workspace);
		const skillDir = join(workspace, ".cline", "skills", "desktop-send-skill");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			`---
name: desktop-send-skill
---
Follow the desktop send skill instructions.`,
		);
		const workflowsDir = join(workspace, ".cline", "workflows");
		mkdirSync(workflowsDir, { recursive: true });
		writeFileSync(
			join(workflowsDir, "desktop-send-workflow.md"),
			`---
name: desktop-send-workflow
---
Follow the desktop send workflow instructions.`,
		);
		return workspace;
	}

	function createContext(workspace: string) {
		const sessionId = "slash-expansion-session";
		const send = vi.fn(async (_input?: unknown) => ({
			text: "done",
			finishReason: "completed",
			messages: [],
		}));
		const session = {
			config: { provider: "cline", model: "test-model", cwd: workspace },
			messages: [],
			promptsInQueue: [],
			busy: false,
			startedAt: Date.now(),
			status: "idle",
			prompt: undefined as string | undefined,
		};
		const updatePendingPrompt = vi.fn(
			async (input: { promptId: string; prompt?: string }) => ({
				updated: true,
				prompt: { id: input.promptId, prompt: input.prompt },
				prompts: [],
			}),
		);
		const ctx = {
			workspaceRoot: workspace,
			liveSessions: new Map([[sessionId, session]]),
			restoringWorkspacePaths: new Set(),
			streamIndices: new Map(),
			wsClients: new Set(),
			sessionManager: {
				send,
				pendingPrompts: {
					list: vi.fn(async () => []),
					update: updatePendingPrompt,
				},
			},
		} as unknown as SidecarContext;
		return { ctx, send, session, sessionId, updatePendingPrompt };
	}

	it("sends a skill command through as typed for the skills tool", async () => {
		const workspace = createWorkspaceWithSkill();
		const { ctx, send, session, sessionId } = createContext(workspace);

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "/desktop-send-skill write the docs",
		});

		// Skills are not expanded into the user message: the runtime's skills
		// tool loads the instructions, and the persisted transcript keeps the
		// typed command.
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: "/desktop-send-skill write the docs",
			}),
		);
		expect(session.prompt).toBe("/desktop-send-skill write the docs");
	});

	it("expands a skill command in yolo mode, where the skills tool is unavailable", async () => {
		const workspace = createWorkspaceWithSkill();
		const { ctx, send, session, sessionId } = createContext(workspace);
		(session.config as Record<string, unknown>).mode = "yolo";

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "/desktop-send-skill write the docs",
		});

		// The yolo preset has no skills tool, so textual expansion is the only
		// way the instructions reach the model.
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: "Follow the desktop send skill instructions. write the docs",
			}),
		);
	});

	it("expands a leading workflow command into its instructions", async () => {
		const workspace = createWorkspaceWithSkill();
		const { ctx, send, session, sessionId } = createContext(workspace);

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "/desktop-send-workflow ship it",
		});

		// Workflows are not served by the skills tool, so they keep textual
		// expansion.
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: "Follow the desktop send workflow instructions. ship it",
			}),
		);
		// The session's display prompt keeps the raw token.
		expect(session.prompt).toBe("/desktop-send-workflow ship it");
	});

	it("keeps a skill command as typed when a queued prompt is edited", async () => {
		const workspace = createWorkspaceWithSkill();
		const { ctx, sessionId, updatePendingPrompt } = createContext(workspace);

		await handleChatSessionCommand(ctx, {
			action: "update_pending_prompt",
			sessionId,
			promptId: "queued-1",
			prompt: "/desktop-send-skill later please",
		});

		expect(updatePendingPrompt).toHaveBeenCalledWith({
			sessionId,
			promptId: "queued-1",
			prompt: "/desktop-send-skill later please",
		});
	});

	it("expands a workflow command when a queued prompt is edited", async () => {
		const workspace = createWorkspaceWithSkill();
		const { ctx, sessionId, updatePendingPrompt } = createContext(workspace);

		await handleChatSessionCommand(ctx, {
			action: "update_pending_prompt",
			sessionId,
			promptId: "queued-2",
			prompt: "/desktop-send-workflow later please",
		});

		expect(updatePendingPrompt).toHaveBeenCalledWith({
			sessionId,
			promptId: "queued-2",
			prompt: "Follow the desktop send workflow instructions. later please",
		});
	});

	it("rewrites a team command when a queued prompt is edited", async () => {
		const workspace = createWorkspaceWithSkill();
		const { ctx, sessionId, updatePendingPrompt } = createContext(workspace);

		await handleChatSessionCommand(ctx, {
			action: "update_pending_prompt",
			sessionId,
			promptId: "queued-team",
			prompt: "/team inspect the app",
		});

		expect(updatePendingPrompt).toHaveBeenCalledWith({
			sessionId,
			promptId: "queued-team",
			prompt:
				'<user_command slash="team">spawn a team of agents for the following task: inspect the app</user_command>',
		});
	});

	it("leaves built-in and unknown slash commands untouched", async () => {
		const workspace = createWorkspaceWithSkill();
		const { ctx, send, sessionId } = createContext(workspace);

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "/fork",
		});
		expect(send).toHaveBeenLastCalledWith(
			expect.objectContaining({ prompt: "/fork" }),
		);

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "/not-a-real-command hello",
		});
		expect(send).toHaveBeenLastCalledWith(
			expect.objectContaining({ prompt: "/not-a-real-command hello" }),
		);
	});
});
