import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleChatSessionCommand } from "./chat-session";
import { createSidecarContext, getEnvironmentContext } from "./context";
import type { SessionRuntimeBinding } from "./types";

const mocks = vi.hoisted(() => ({
	settings: new Map<string, Record<string, unknown>>(),
	refresh: vi.fn(),
}));
vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		ProviderSettingsManager: class {
			getProviderSettings(id: string) {
				return mocks.settings.get(id);
			}
		},
		RuntimeOAuthTokenManager: class {
			resolveProviderApiKey(input: unknown) {
				return mocks.refresh(input);
			}
		},
	};
});

beforeEach(() => {
	mocks.settings.clear();
	mocks.settings.set("cline", {
		provider: "cline",
		model: "model-a",
		auth: { accessToken: "expired", refreshToken: "private-refresh" },
	});
	mocks.settings.set("openai", {
		provider: "openai",
		model: "model-b",
		apiKey: "openai-key",
		baseUrl: "https://openai.example/v1",
	});
	mocks.refresh
		.mockReset()
		.mockImplementation(async ({ providerId }: { providerId: string }) => {
			if (providerId !== "cline") return null;
			return { apiKey: "fresh-token" };
		});
});
afterEach(() => {
	vi.unstubAllEnvs();
});

function runtime() {
	const ctx = createSidecarContext("/local/workspace");
	const manager = {
		start: vi.fn(async (input: { config?: { sessionId?: string } }) => ({
			sessionId: input.config?.sessionId ?? "remote-session",
			manifest: {
				cwd: "/remote/workspace",
				workspace_root: "/remote/workspace",
			},
		})),
		get: vi.fn(async () => ({
			sessionId: "shared-id",
			provider: "cline",
			model: "model-a",
			cwd: "/remote/workspace",
			metadata: { title: "Remote conversation" },
		})),
		updateSessionConnection: vi.fn(async () => undefined),
		send: vi.fn(async () => ({ text: "done", messages: [] })),
		readMessages: vi.fn(async () => [
			{ role: "user", content: "remote message" },
		]),
		readSessionCompactionState: vi.fn(async () => undefined),
		stop: vi.fn(async () => undefined),
	};
	ctx.runtimeBindings.set("remote", {
		environmentId: "remote",
		kind: "ssh",
		workspaceRoot: "/remote/workspace",
		sessionManager: manager,
		hubClient: { command: vi.fn(async () => undefined) },
	} as unknown as SessionRuntimeBinding);
	const config = {
		environmentId: "remote",
		provider: "cline",
		model: "model-a",
		cwd: "/remote/workspace",
	};
	return { ctx, manager, config };
}

describe("SSH session credentials and history", () => {
	it("seeds reopened SSH sessions before sending a follow-up", async () => {
		const { ctx, manager, config } = runtime();
		const history = [
			{ role: "user", content: "Remember my project" },
			{ role: "assistant", content: "I remember" },
		];
		manager.readMessages.mockResolvedValueOnce(history);
		await handleChatSessionCommand(ctx, {
			action: "start",
			config: { ...config, sessionId: "shared-id" },
		});
		expect(manager.start).toHaveBeenCalledWith(
			expect.objectContaining({
				initialMessages: history,
				config: expect.objectContaining({ sessionId: "shared-id" }),
			}),
		);
		expect(
			getEnvironmentContext(ctx, "remote").liveSessions.get("shared-id")
				?.messages,
		).toEqual(history);
		manager.send.mockResolvedValueOnce({
			text: "done",
			messages: [...history, { role: "user", content: "Continue" }],
		} as never);
		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId: "shared-id",
			prompt: "Continue",
			config,
		});
		await vi.waitFor(() =>
			expect(
				getEnvironmentContext(ctx, "remote").liveSessions.get("shared-id")
					?.messages,
			).toEqual([...history, { role: "user", content: "Continue" }]),
		);
		expect(manager.start).toHaveBeenCalledTimes(1);
	});

	it("does not start an empty replacement when remote history cannot be read", async () => {
		const { ctx, manager, config } = runtime();
		manager.readMessages.mockRejectedValueOnce(
			new Error("History unavailable"),
		);
		await expect(
			handleChatSessionCommand(ctx, {
				action: "start",
				config: { ...config, sessionId: "shared-id" },
			}),
		).rejects.toThrow("History unavailable");
		expect(manager.start).not.toHaveBeenCalled();
	});

	it("uses refreshed tokens in both configs and refreshes again for the next send", async () => {
		const { ctx, manager, config } = runtime();
		await handleChatSessionCommand(ctx, { action: "start", config });
		expect(manager.start).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					apiKey: "fresh-token",
					providerConfig: expect.objectContaining({
						apiKey: "fresh-token",
						accessToken: "fresh-token",
					}),
				}),
			}),
		);
		expect(JSON.stringify(manager.start.mock.calls)).not.toContain(
			"private-refresh",
		);
		expect(
			getEnvironmentContext(ctx, "remote").liveSessions.get("remote-session")
				?.config.apiKey,
		).toBeUndefined();
		mocks.refresh.mockResolvedValueOnce({ apiKey: "newer-token" });
		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId: "remote-session",
			prompt: "hello",
			config,
		});
		expect(manager.updateSessionConnection).toHaveBeenLastCalledWith(
			"remote-session",
			expect.objectContaining({
				apiKey: "newer-token",
				providerConfig: expect.objectContaining({
					apiKey: "newer-token",
					accessToken: "newer-token",
				}),
			}),
		);
	});

	it("drops the previous provider's credentials, headers, and endpoint on switch", async () => {
		const { ctx, manager, config } = runtime();
		await handleChatSessionCommand(ctx, {
			action: "start",
			config: {
				...config,
				apiKey: "old-provider-key",
				baseUrl: "https://old-provider.example",
				headers: { Authorization: "old-secret" },
				providerConfig: { providerId: "cline", apiKey: "old-provider-key" },
			},
		});
		await handleChatSessionCommand(ctx, {
			action: "send",
			sessionId: "remote-session",
			prompt: "hello",
			config: { environmentId: "remote", provider: "openai", model: "model-b" },
		});
		expect(manager.start).toHaveBeenLastCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					providerId: "openai",
					apiKey: "openai-key",
					baseUrl: "https://openai.example/v1",
				}),
			}),
		);
		expect(JSON.stringify(manager.start.mock.calls.at(-1))).not.toContain(
			"old-provider",
		);
		expect(JSON.stringify(manager.start.mock.calls.at(-1))).not.toContain(
			"old-secret",
		);
	});

	it("never reads a same-ID local transcript when starting or forking remotely", async () => {
		const directory = mkdtempSync(join(tmpdir(), "cline-remote-fork-"));
		vi.stubEnv("CLINE_SESSION_DATA_DIR", directory);
		try {
			mkdirSync(join(directory, "shared-id"));
			writeFileSync(
				join(directory, "shared-id", "shared-id.messages.json"),
				JSON.stringify([{ role: "user", content: "private local message" }]),
			);
			const { ctx, manager, config } = runtime();
			await handleChatSessionCommand(ctx, {
				action: "start",
				config: { ...config, sessionId: "shared-id" },
			});
			expect(manager.readMessages).toHaveBeenCalledWith("shared-id");
			expect(manager.start).toHaveBeenCalledWith(
				expect.objectContaining({
					initialMessages: [{ role: "user", content: "remote message" }],
				}),
			);
			expect(JSON.stringify(manager.start.mock.calls)).not.toContain(
				"private local message",
			);
			await handleChatSessionCommand(ctx, {
				action: "fork",
				sessionId: "shared-id",
				config,
			});
			expect(manager.start).toHaveBeenLastCalledWith(
				expect.objectContaining({
					initialMessages: [{ role: "user", content: "remote message" }],
				}),
			);
			expect(JSON.stringify(manager.start.mock.calls)).not.toContain(
				"private local message",
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
