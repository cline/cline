import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	buildSessionConnectionUpdate,
	consumeWorkspaceMetadata,
	handleChatSessionCommand,
	hasProviderChanged,
	mergeSessionConfig,
	prewarmWorkspaceMetadata,
	shouldUpdateSessionConnection,
	WORKSPACE_METADATA_PREWARM_TTL_MS,
} from "./chat-session";
import type { SidecarContext } from "./types";

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
