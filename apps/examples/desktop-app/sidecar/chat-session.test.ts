import { describe, expect, it, vi } from "vitest";
import {
	buildSessionConnectionUpdate,
	consumeWorkspaceMetadata,
	handleChatSessionCommand,
	prewarmWorkspaceMetadata,
	shouldRestartSessionForProviderChange,
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
			modelId: "anthropic/claude-sonnet-4.6",
			thinking: true,
			reasoningEffort: "high",
		});
		expect(Object.hasOwn(update, "thinkingBudgetTokens")).toBe(false);
	});
});

describe("shouldRestartSessionForProviderChange", () => {
	it("recognizes a provider switch across canonical and legacy aliases", () => {
		expect(
			shouldRestartSessionForProviderChange(
				{ provider: "cline" },
				{ providerId: "openai-codex" },
			),
		).toBe(true);
	});

	it("does not restart for a model change within the same provider", () => {
		expect(
			shouldRestartSessionForProviderChange(
				{ providerId: "openai-codex", modelId: "gpt-5.2-codex" },
				{ provider: "openai-codex", model: "gpt-5.3-codex" },
			),
		).toBe(false);
	});

	it("does not let a blank canonical value hide a valid provider alias", () => {
		expect(
			shouldRestartSessionForProviderChange(
				{ provider: "cline" },
				{ provider: " ", providerId: "openai-codex" },
			),
		).toBe(true);
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

describe("send connection updates", () => {
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
		const restart = vi.fn(async (input: { sessionId: string }) => ({
			sessionId: input.sessionId,
		}));
		const updateSessionConnection = vi.fn(async () => undefined);
		const send = vi.fn(
			async (_input?: {
				delivery?: "queue" | "steer";
			}): Promise<
				{ text: string; finishReason: string; messages: never[] } | undefined
			> => ({
				text: "done",
				finishReason: "completed",
				messages: [],
			}),
		);
		const sessionId = "session-connection-test";
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
			sessionConfigUpdateTails: new Map(),
			wsClients: new Set(),
			sessionManager: {
				pendingPrompts: { list: vi.fn(async () => []) },
				restart,
				send,
				updateSessionConnection,
			},
		} as unknown as SidecarContext;
		return { ctx, restart, send, sessionId, updateSessionConnection };
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

	it("updates a model change within the same provider without restarting", async () => {
		const { ctx, restart, send, sessionId, updateSessionConnection } =
			createContext({
				config: {
					...baseConfig,
					model: "anthropic/claude-sonnet-4.5",
				},
			});

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "hello",
			config: { ...baseConfig },
		});

		expect(restart).not.toHaveBeenCalled();
		expect(updateSessionConnection).toHaveBeenCalledWith(sessionId, {
			modelId: "anthropic/claude-sonnet-4.6",
			thinking: true,
			reasoningEffort: "high",
			thinkingBudgetTokens: null,
		});
		expect(updateSessionConnection.mock.invocationCallOrder[0]).toBeLessThan(
			send.mock.invocationCallOrder[0] ?? 0,
		);
	});

	it("restarts Cline as OpenAI Codex before sending the next turn", async () => {
		const { ctx, restart, send, sessionId, updateSessionConnection } =
			createContext({
				config: {
					...baseConfig,
					systemPrompt: "Desktop system prompt",
					autoApproveTools: true,
				},
			});

		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "continue with Codex",
			config: {
				providerId: "openai-codex",
				modelId: "gpt-5.3-codex",
			},
		});

		expect(restart).toHaveBeenCalledWith({
			sessionId,
			config: expect.objectContaining({
				sessionId,
				providerId: "openai-codex",
				modelId: "gpt-5.3-codex",
				mode: "act",
				apiKey: "",
				workspaceRoot: "",
				cwd: "",
				systemPrompt: "Desktop system prompt",
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
				thinking: true,
				reasoningEffort: "high",
			}),
			source: "desktop",
			interactive: true,
			toolPolicies: { "*": { autoApprove: true } },
		});
		expect(updateSessionConnection).not.toHaveBeenCalled();
		expect(restart.mock.invocationCallOrder[0]).toBeLessThan(
			send.mock.invocationCallOrder[0] ?? 0,
		);
		expect(ctx.liveSessions.get(sessionId)?.config).toMatchObject({
			provider: "openai-codex",
			model: "gpt-5.3-codex",
		});
	});

	it("serializes matching sends across one provider restart", async () => {
		const { ctx, restart, send, sessionId } = createContext();
		let releaseRestart: (() => void) | undefined;
		const restartGate = new Promise<void>((resolve) => {
			releaseRestart = resolve;
		});
		restart.mockImplementationOnce(async () => {
			await restartGate;
			return { sessionId };
		});
		let releaseFirstSend:
			| ((value: {
					text: string;
					finishReason: string;
					messages: never[];
			  }) => void)
			| undefined;
		const firstSendResult = new Promise<{
			text: string;
			finishReason: string;
			messages: never[];
		}>((resolve) => {
			releaseFirstSend = resolve;
		});
		send.mockImplementation(async (input?: { delivery?: "queue" | "steer" }) =>
			input?.delivery === "queue" ? undefined : await firstSendResult,
		);
		const nextConfig = {
			provider: "openai-codex",
			model: "gpt-5.3-codex",
		};

		const first = handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "first after switch",
			config: nextConfig,
		});
		await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce());
		const second = handleChatSessionCommand(ctx, {
			action: "send",
			sessionId,
			prompt: "second after switch",
			config: nextConfig,
		});

		releaseRestart?.();
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
		await second;
		expect(restart).toHaveBeenCalledOnce();
		expect(send).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				sessionId,
				prompt: "second after switch",
				delivery: "queue",
			}),
		);

		releaseFirstSend?.({
			text: "first response",
			finishReason: "completed",
			messages: [],
		});
		await first;
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
