import { describe, expect, it, vi } from "vitest";
import {
	buildSessionConnectionUpdate,
	consumeWorkspaceMetadata,
	handleChatSessionCommand,
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
		const send = vi.fn(async () => ({
			text: "done",
			finishReason: "completed",
			messages: [],
		}));
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
			sessionManager: { send, updateSessionConnection },
		} as unknown as SidecarContext;
		return { ctx, send, sessionId, updateSessionConnection };
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
