import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentResult } from "@clinebot/agents";
import { describe, expect, it, vi } from "vitest";
import { TelemetryService } from "../telemetry/TelemetryService";
import { SessionSource } from "../types/common";
import type { CoreSessionConfig } from "../types/config";
import { DefaultSessionManager } from "./default-session-manager";
import type { SessionManifest } from "./session-manifest";

const distinctId = "test-machine-id";

function createResult(overrides: Partial<AgentResult> = {}): AgentResult {
	return {
		text: "ok",
		iterations: 1,
		finishReason: "completed",
		usage: {
			inputTokens: 1,
			outputTokens: 2,
			totalCost: 0,
		},
		messages: [],
		toolCalls: [],
		durationMs: 1,
		model: {
			id: "mock-model",
			provider: "mock-provider",
		},
		startedAt: new Date("2026-01-01T00:00:00.000Z"),
		endedAt: new Date("2026-01-01T00:00:01.000Z"),
		...overrides,
	};
}

function createManifest(sessionId: string): SessionManifest {
	return {
		version: 1,
		session_id: sessionId,
		source: SessionSource.CLI,
		pid: process.pid,
		started_at: "2026-01-01T00:00:00.000Z",
		status: "running",
		interactive: false,
		provider: "mock-provider",
		model: "mock-model",
		cwd: "/tmp/project",
		workspace_root: "/tmp/project",
		enable_tools: true,
		enable_spawn: true,
		enable_teams: true,
		prompt: "hello",
		messages_path: "/tmp/messages.json",
	};
}

function createConfig(
	overrides: Partial<CoreSessionConfig> = {},
): CoreSessionConfig {
	return {
		providerId: "mock-provider",
		modelId: "mock-model",
		cwd: "/tmp/project",
		systemPrompt: "You are a test agent",
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
		...overrides,
	};
}

describe("DefaultSessionManager", () => {
	it("emits session lifecycle telemetry when configured", async () => {
		const sessionId = "sess-telemetry";
		const manifest = createManifest(sessionId);
		const adapter = {
			name: "test",
			emit: vi.fn(),
			emitRequired: vi.fn(),
			recordCounter: vi.fn(),
			recordHistogram: vi.fn(),
			recordGauge: vi.fn(),
			isEnabled: vi.fn(() => true),
			flush: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
		};
		const telemetry = new TelemetryService({
			adapters: [adapter],
			distinctId: distinctId,
		});
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
				transcriptPath: "/tmp/transcript.log",
				hookPath: "/tmp/hook.log",
				messagesPath: "/tmp/messages.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({
				updated: true,
				endedAt: "2026-01-01T00:00:05.000Z",
			}),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			abort: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const manager = new DefaultSessionManager({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
			telemetry,
		});

		await manager.start({
			config: createConfig({ telemetry, sessionId }),
			prompt: "hello",
		});

		expect(adapter.emit).toHaveBeenCalledWith(
			"session.started",
			expect.objectContaining({
				sessionId,
				distinct_id: distinctId,
			}),
		);
	});

	it("runs a non-interactive prompt and persists messages/status", async () => {
		const sessionId = "sess-1";
		const manifest = createManifest(sessionId);
		const createRootSessionWithArtifacts = vi.fn().mockResolvedValue({
			manifestPath: "/tmp/manifest.json",
			transcriptPath: "/tmp/transcript.log",
			hookPath: "/tmp/hook.log",
			messagesPath: "/tmp/messages.json",
			manifest,
		});
		const persistSessionMessages = vi.fn();
		const updateSessionStatus = vi.fn().mockResolvedValue({
			updated: true,
			endedAt: "2026-01-01T00:00:05.000Z",
		});
		const writeSessionManifest = vi.fn();
		const listSessions = vi.fn().mockResolvedValue([]);
		const deleteSession = vi.fn().mockResolvedValue({ deleted: true });
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts,
			persistSessionMessages,
			updateSessionStatus,
			writeSessionManifest,
			listSessions,
			deleteSession,
		};

		const shutdown = vi.fn();
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown,
			}),
		};
		const run = vi.fn().mockResolvedValue(
			createResult({
				messages: [
					{ role: "user", content: [{ type: "text", text: "hello" }] },
				],
			}),
		);
		const continueFn = vi.fn();
		const agent = {
			run,
			continue: continueFn,
			abort: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue([]),
			messages: [],
		};

		const manager = new DefaultSessionManager({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () => agent as never,
		});

		const started = await manager.start({
			config: createConfig({ sessionId }),
			prompt: "hello",
			interactive: false,
		});

		expect(started.sessionId).toBe(sessionId);
		expect(started.result?.finishReason).toBe("completed");
		expect(run).toHaveBeenCalledTimes(1);
		expect(continueFn).not.toHaveBeenCalled();
		expect(persistSessionMessages).toHaveBeenCalledTimes(1);
		expect(updateSessionStatus).toHaveBeenCalledWith(sessionId, "completed", 0);
		expect(writeSessionManifest).toHaveBeenCalledTimes(1);
		expect(shutdown).toHaveBeenCalledTimes(1);
	});

	it("persists assistant message metadata for usage and model identity", async () => {
		const sessionId = "sess-meta";
		const manifest = createManifest(sessionId);
		const persistSessionMessages = vi.fn();
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-meta.json",
				transcriptPath: "/tmp/transcript-meta.log",
				hookPath: "/tmp/hook-meta.log",
				messagesPath: "/tmp/messages-meta.json",
				manifest,
			}),
			persistSessionMessages,
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		const run = vi.fn().mockResolvedValue(
			createResult({
				usage: {
					inputTokens: 33,
					outputTokens: 12,
					cacheReadTokens: 4,
					cacheWriteTokens: 1,
					totalCost: 0.42,
				},
				model: {
					id: "claude-sonnet-4-6",
					provider: "anthropic",
				},
				endedAt: new Date("2026-01-01T00:00:02.000Z"),
				messages: [
					{ role: "user", content: [{ type: "text", text: "hello" }] },
					{ role: "assistant", content: [{ type: "text", text: "world" }] },
				],
			}),
		);
		const manager = new DefaultSessionManager({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: vi.fn(),
					abort: vi.fn(),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.start({
			config: createConfig({
				sessionId,
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
			}),
			prompt: "hello",
			interactive: false,
		});

		expect(persistSessionMessages).toHaveBeenCalledTimes(1);
		const persisted = persistSessionMessages.mock.calls[0]?.[1];
		expect(Array.isArray(persisted)).toBe(true);
		expect(persisted?.[1]).toMatchObject({
			role: "assistant",
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			modelInfo: {
				id: "claude-sonnet-4-6",
				provider: "anthropic",
			},
			metrics: {
				inputTokens: 33,
				outputTokens: 12,
				cacheReadTokens: 4,
				cacheWriteTokens: 1,
				cost: 0.42,
			},
			ts: new Date("2026-01-01T00:00:02.000Z").getTime(),
		});
	});

	it("preserves per-turn metadata on prior assistant messages across turns", async () => {
		const sessionId = "sess-meta-multi";
		const manifest = createManifest(sessionId);
		const persistSessionMessages = vi.fn();
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		const firstTurnMessages = [
			{
				role: "user" as const,
				content: [{ type: "text" as const, text: "hello" }],
			},
			{
				role: "assistant" as const,
				content: [{ type: "text" as const, text: "world" }],
			},
		];
		const secondTurnMessages = [
			...firstTurnMessages,
			{
				role: "user" as const,
				content: [{ type: "text" as const, text: "again" }],
			},
			{
				role: "assistant" as const,
				content: [{ type: "text" as const, text: "still here" }],
			},
		];
		const run = vi.fn().mockResolvedValue(
			createResult({
				usage: {
					inputTokens: 33,
					outputTokens: 12,
					cacheReadTokens: 4,
					cacheWriteTokens: 1,
					totalCost: 0.42,
				},
				model: {
					id: "claude-sonnet-4-6",
					provider: "anthropic",
				},
				endedAt: new Date("2026-01-01T00:00:02.000Z"),
				messages: firstTurnMessages,
			}),
		);
		const continueFn = vi.fn().mockResolvedValue(
			createResult({
				usage: {
					inputTokens: 10,
					outputTokens: 5,
					cacheReadTokens: 2,
					cacheWriteTokens: 0,
					totalCost: 0.12,
				},
				model: {
					id: "claude-sonnet-4-6",
					provider: "anthropic",
				},
				endedAt: new Date("2026-01-01T00:00:03.000Z"),
				messages: secondTurnMessages,
			}),
		);
		const agent = {
			run,
			continue: continueFn,
			abort: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
			restore: vi.fn(),
			getMessages: vi.fn().mockReturnValue([]),
			messages: [],
		};
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-meta-multi.json",
				transcriptPath: "/tmp/transcript-meta-multi.log",
				hookPath: "/tmp/hook-meta-multi.log",
				messagesPath: "/tmp/messages-meta-multi.json",
				manifest,
			}),
			persistSessionMessages,
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const manager = new DefaultSessionManager({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () => agent as never,
		});

		await manager.start({
			config: createConfig({
				sessionId,
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
			}),
			interactive: true,
		});

		await manager.send({ sessionId, prompt: "hello" });
		await manager.send({ sessionId, prompt: "again" });

		const persisted = persistSessionMessages.mock.calls[1]?.[1];
		expect(persisted?.[1]).toMatchObject({
			role: "assistant",
			metrics: {
				inputTokens: 33,
				outputTokens: 12,
				cacheReadTokens: 4,
				cacheWriteTokens: 1,
				cost: 0.42,
			},
		});
		expect(persisted?.[3]).toMatchObject({
			role: "assistant",
			metrics: {
				inputTokens: 10,
				outputTokens: 5,
				cacheReadTokens: 2,
				cacheWriteTokens: 0,
				cost: 0.12,
			},
		});
	});

	it("persists rendered messages when a turn fails", async () => {
		const sessionId = "sess-failed-turn";
		const manifest = createManifest(sessionId);
		const persistSessionMessages = vi.fn();
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-failed-turn.json",
				transcriptPath: "/tmp/transcript-failed-turn.log",
				hookPath: "/tmp/hook-failed-turn.log",
				messagesPath: "/tmp/messages-failed-turn.json",
				manifest,
			}),
			persistSessionMessages,
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		const renderedMessages = [
			{ role: "user", content: [{ type: "text", text: "hello" }] },
			{ role: "assistant", content: [{ type: "text", text: "partial" }] },
		];
		const manager = new DefaultSessionManager({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run: vi.fn().mockRejectedValue(new Error("boom")),
					continue: vi.fn(),
					abort: vi.fn(),
					restore: vi.fn(),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi
						.fn()
						.mockReturnValueOnce([])
						.mockReturnValue(renderedMessages),
					messages: [],
				}) as never,
		});

		await expect(
			manager.start({
				config: createConfig({ sessionId }),
				prompt: "hello",
				interactive: false,
			}),
		).rejects.toThrow("boom");

		expect(persistSessionMessages).toHaveBeenCalledTimes(1);
		expect(persistSessionMessages).toHaveBeenCalledWith(
			sessionId,
			renderedMessages,
			"You are a test agent",
		);
		expect(sessionService.updateSessionStatus).toHaveBeenCalledWith(
			sessionId,
			"failed",
			1,
		);
	});

	it("uses run for first send then continue for subsequent sends", async () => {
		const sessionId = "sess-2";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-2.json",
				transcriptPath: "/tmp/transcript-2.log",
				hookPath: "/tmp/hook-2.log",
				messagesPath: "/tmp/messages-2.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		const run = vi.fn().mockResolvedValue(createResult({ text: "first" }));
		const continueFn = vi
			.fn()
			.mockResolvedValue(createResult({ text: "second" }));
		const manager = new DefaultSessionManager({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: continueFn,
					abort: vi.fn(),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.start({
			config: createConfig({ sessionId }),
			interactive: true,
		});
		const first = await manager.send({ sessionId, prompt: "first" });
		const second = await manager.send({ sessionId, prompt: "second" });

		expect(first?.text).toBe("first");
		expect(second?.text).toBe("second");
		expect(run).toHaveBeenCalledTimes(1);
		expect(continueFn).toHaveBeenCalledTimes(1);
		expect(sessionService.persistSessionMessages).toHaveBeenCalledTimes(2);
	});

	it("tracks accumulated usage per session across turns", async () => {
		const sessionId = "sess-usage";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-usage.json",
				transcriptPath: "/tmp/transcript-usage.log",
				hookPath: "/tmp/hook-usage.log",
				messagesPath: "/tmp/messages-usage.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		const run = vi.fn().mockResolvedValue(
			createResult({
				text: "first",
				usage: {
					inputTokens: 10,
					outputTokens: 3,
					cacheReadTokens: 1,
					cacheWriteTokens: 2,
					totalCost: 0.11,
				},
			}),
		);
		const continueFn = vi.fn().mockResolvedValue(
			createResult({
				text: "second",
				usage: {
					inputTokens: 8,
					outputTokens: 4,
					cacheReadTokens: 2,
					cacheWriteTokens: 0,
					totalCost: 0.09,
				},
			}),
		);
		const manager = new DefaultSessionManager({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: continueFn,
					abort: vi.fn(),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.start({
			config: createConfig({ sessionId }),
			interactive: true,
		});

		await manager.send({ sessionId, prompt: "first" });
		expect(await manager.getAccumulatedUsage(sessionId)).toEqual({
			inputTokens: 10,
			outputTokens: 3,
			cacheReadTokens: 1,
			cacheWriteTokens: 2,
			totalCost: 0.11,
		});

		await manager.send({ sessionId, prompt: "second" });
		expect(await manager.getAccumulatedUsage(sessionId)).toEqual({
			inputTokens: 18,
			outputTokens: 7,
			cacheReadTokens: 3,
			cacheWriteTokens: 2,
			totalCost: 0.2,
		});
	});

	it("returns undefined accumulated usage for unknown sessions", async () => {
		const manager = new DefaultSessionManager({
			distinctId,
			sessionService: {
				ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
				listSessions: vi.fn().mockResolvedValue([]),
				deleteSession: vi.fn().mockResolvedValue({ deleted: false }),
			} as never,
			runtimeBuilder: {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			},
			createAgent: () =>
				({
					run: vi.fn(),
					continue: vi.fn(),
					abort: vi.fn(),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		expect(
			await manager.getAccumulatedUsage("missing-session"),
		).toBeUndefined();
	});

	it("marks a failed single-run session as failed when run throws", async () => {
		const sessionId = "sess-fail";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-fail.json",
				transcriptPath: "/tmp/transcript-fail.log",
				hookPath: "/tmp/hook-fail.log",
				messagesPath: "/tmp/messages-fail.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeShutdown = vi.fn();
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: runtimeShutdown,
			}),
		};
		const run = vi.fn().mockRejectedValue(new Error("run failed"));
		const agentShutdown = vi.fn().mockResolvedValue(undefined);
		const manager = new DefaultSessionManager({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: vi.fn(),
					abort: vi.fn(),
					shutdown: agentShutdown,
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await expect(
			manager.start({
				config: createConfig({ sessionId }),
				prompt: "hello",
				interactive: false,
			}),
		).rejects.toThrow("run failed");
		expect(sessionService.updateSessionStatus).toHaveBeenCalledWith(
			sessionId,
			"failed",
			1,
		);
		expect(agentShutdown).toHaveBeenCalledTimes(1);
		expect(runtimeShutdown).toHaveBeenCalledTimes(1);
	});

	it("does not persist or emit shutdown hooks when no prompt was submitted", async () => {
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn(),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn(),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeShutdown = vi.fn();
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: runtimeShutdown,
			}),
		};
		const agentShutdown = vi.fn().mockResolvedValue(undefined);
		const manager = new DefaultSessionManager({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run: vi.fn(),
					continue: vi.fn(),
					abort: vi.fn(),
					shutdown: agentShutdown,
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		const started = await manager.start({
			config: createConfig({ sessionId: "sess-no-prompt" }),
			interactive: true,
		});
		await manager.stop(started.sessionId);

		expect(
			sessionService.createRootSessionWithArtifacts,
		).not.toHaveBeenCalled();
		expect(sessionService.updateSessionStatus).not.toHaveBeenCalled();
		expect(agentShutdown).not.toHaveBeenCalled();
		expect(runtimeShutdown).toHaveBeenCalledTimes(1);
	});

	it("updates agent connection with refreshed OAuth key before turn", async () => {
		const sessionId = "sess-oauth";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-oauth.json",
				transcriptPath: "/tmp/transcript-oauth.log",
				hookPath: "/tmp/hook-oauth.log",
				messagesPath: "/tmp/messages-oauth.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		const run = vi.fn().mockResolvedValue(createResult({ text: "ok" }));
		const updateConnection = vi.fn();
		const manager = new DefaultSessionManager({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			oauthTokenManager: {
				resolveProviderApiKey: vi.fn().mockResolvedValue({
					providerId: "openai-codex",
					apiKey: "oauth-access-new",
					refreshed: true,
				}),
			} as never,
			createAgent: () =>
				({
					run,
					continue: vi.fn(),
					abort: vi.fn(),
					restore: vi.fn(),
					updateConnection,
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.start({
			config: createConfig({
				sessionId,
				providerId: "openai-codex",
				apiKey: "oauth-access-old",
			}),
			interactive: true,
		});
		await manager.send({ sessionId, prompt: "hello" });

		expect(updateConnection).toHaveBeenCalledWith({
			apiKey: "oauth-access-new",
		});
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("hydrates provider-specific config from provider settings", async () => {
		const sessionId = "sess-provider-config";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-provider-config.json",
				transcriptPath: "/tmp/transcript-provider-config.log",
				hookPath: "/tmp/hook-provider-config.log",
				messagesPath: "/tmp/messages-provider-config.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const run = vi.fn().mockResolvedValue(
			createResult({
				model: {
					id: "claude-sonnet-4@20250514",
					provider: "vertex",
				},
			}),
		);
		const createAgent = vi.fn().mockReturnValue({
			run,
			continue: vi.fn(),
			abort: vi.fn(),
			restore: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue([]),
			messages: [],
		});
		const manager = new DefaultSessionManager({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			},
			createAgent: createAgent as never,
			providerSettingsManager: {
				getProviderSettings: vi.fn().mockReturnValue({
					provider: "vertex",
					gcp: {
						projectId: "test-project",
						region: "us-central1",
					},
				}),
			} as never,
		});

		await manager.start({
			config: createConfig({
				sessionId,
				providerId: "vertex",
				modelId: "claude-sonnet-4@20250514",
			}),
			interactive: true,
		});
		await manager.send({ sessionId, prompt: "hello" });

		expect(createAgent).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "vertex",
				modelId: "claude-sonnet-4@20250514",
				providerConfig: expect.objectContaining({
					providerId: "vertex",
					modelId: "claude-sonnet-4@20250514",
					gcp: {
						projectId: "test-project",
						region: "us-central1",
					},
				}),
			}),
		);
	});

	it("formats prompt in core and merges explicit + mention user files", async () => {
		const tempCwd = mkdtempSync(join(tmpdir(), "core-session-format-"));
		try {
			const srcDir = join(tempCwd, "src");
			const docsDir = join(tempCwd, "docs");
			mkdirSync(srcDir, { recursive: true });
			mkdirSync(docsDir, { recursive: true });
			const mentionPath = join(srcDir, "app.ts");
			const explicitPath = join(docsDir, "note.md");
			writeFileSync(mentionPath, "export const v = 1;\n", "utf8");
			writeFileSync(explicitPath, "note\n", "utf8");

			const sessionId = "sess-format";
			const manifest = createManifest(sessionId);
			const sessionService = {
				ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
				createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
					manifestPath: "/tmp/manifest-format.json",
					transcriptPath: "/tmp/transcript-format.log",
					hookPath: "/tmp/hook-format.log",
					messagesPath: "/tmp/messages-format.json",
					manifest,
				}),
				persistSessionMessages: vi.fn(),
				updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
				writeSessionManifest: vi.fn(),
				listSessions: vi.fn().mockResolvedValue([]),
				deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
			};
			const run = vi.fn().mockResolvedValue(createResult({ text: "ok" }));
			const manager = new DefaultSessionManager({
				distinctId,
				sessionService: sessionService as never,
				runtimeBuilder: {
					build: vi.fn().mockReturnValue({
						tools: [],
						shutdown: vi.fn(),
					}),
				},
				createAgent: () =>
					({
						run,
						continue: vi.fn(),
						abort: vi.fn(),
						shutdown: vi.fn().mockResolvedValue(undefined),
						getMessages: vi.fn().mockReturnValue([]),
						messages: [],
					}) as never,
			});

			await manager.start({
				config: createConfig({
					sessionId,
					cwd: join(tempCwd, "docs"),
					workspaceRoot: tempCwd,
				}),
				interactive: true,
			});
			await manager.send({
				sessionId,
				prompt: '<user_input mode="act">explain @src/app.ts</user_input>',
				userFiles: ["note.md"],
			});

			expect(run).toHaveBeenCalledWith(
				'<user_input mode="act">explain @src/app.ts</user_input>',
				undefined,
				expect.arrayContaining([mentionPath, explicitPath]),
			);
		} finally {
			rmSync(tempCwd, { recursive: true, force: true });
		}
	});

	it("force refreshes and retries once when turn fails with auth error", async () => {
		const sessionId = "sess-oauth-retry";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-oauth-retry.json",
				transcriptPath: "/tmp/transcript-oauth-retry.log",
				hookPath: "/tmp/hook-oauth-retry.log",
				messagesPath: "/tmp/messages-oauth-retry.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		const run = vi
			.fn()
			.mockRejectedValueOnce(new Error("401 Unauthorized"))
			.mockResolvedValueOnce(createResult({ text: "retried" }));
		const restore = vi.fn();
		const updateConnection = vi.fn();
		const resolveProviderApiKey = vi
			.fn()
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({
				providerId: "openai-codex",
				apiKey: "oauth-access-new",
				refreshed: true,
			});
		const manager = new DefaultSessionManager({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			oauthTokenManager: {
				resolveProviderApiKey,
			} as never,
			createAgent: () =>
				({
					run,
					continue: vi.fn(),
					abort: vi.fn(),
					restore,
					updateConnection,
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.start({
			config: createConfig({
				sessionId,
				providerId: "openai-codex",
				apiKey: "oauth-access-old",
			}),
			interactive: true,
		});
		const result = await manager.send({ sessionId, prompt: "hello" });

		expect(result?.text).toBe("retried");
		expect(run).toHaveBeenCalledTimes(2);
		expect(restore).toHaveBeenCalledTimes(1);
		expect(resolveProviderApiKey).toHaveBeenNthCalledWith(1, {
			providerId: "openai-codex",
			forceRefresh: undefined,
		});
		expect(resolveProviderApiKey).toHaveBeenNthCalledWith(2, {
			providerId: "openai-codex",
			forceRefresh: true,
		});
		expect(updateConnection).toHaveBeenCalledWith({
			apiKey: "oauth-access-new",
		});
	});

	it("auto-continues when async teammate runs complete after lead turn", async () => {
		const sessionId = "sess-team-auto-continue";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-team-auto-continue.json",
				transcriptPath: "/tmp/transcript-team-auto-continue.log",
				hookPath: "/tmp/hook-team-auto-continue.log",
				messagesPath: "/tmp/messages-team-auto-continue.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};

		let onTeamEvent: ((event: unknown) => void) | undefined;
		const runtimeBuilder = {
			build: vi
				.fn()
				.mockImplementation(
					(input: { onTeamEvent?: (event: unknown) => void }) => {
						onTeamEvent = input.onTeamEvent;
						return {
							tools: [],
							shutdown: vi.fn(),
						};
					},
				),
		};

		const run = vi.fn().mockImplementation(async () => {
			onTeamEvent?.({
				type: "run_started",
				run: {
					id: "run_0001",
					agentId: "investigator",
					status: "running",
					message: "Investigate",
					priority: 0,
					retryCount: 0,
					maxRetries: 0,
					startedAt: new Date("2026-01-01T00:00:00.000Z"),
				},
			});
			setTimeout(() => {
				onTeamEvent?.({
					type: "run_completed",
					run: {
						id: "run_0001",
						agentId: "investigator",
						status: "completed",
						message: "Investigate",
						priority: 0,
						retryCount: 0,
						maxRetries: 0,
						startedAt: new Date("2026-01-01T00:00:00.000Z"),
						endedAt: new Date("2026-01-01T00:00:02.000Z"),
						result: createResult({ iterations: 3 }),
					},
				});
			}, 0);
			return createResult({ text: "lead scheduled teammate" });
		});
		const continueFn = vi
			.fn()
			.mockResolvedValue(
				createResult({ text: "lead processed teammate result" }),
			);
		const manager = new DefaultSessionManager({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: continueFn,
					abort: vi.fn(),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.start({
			config: createConfig({ sessionId }),
			interactive: false,
		});
		const result = await manager.send({
			sessionId,
			prompt: "run teammate work",
		});

		expect(result?.text).toBe("lead processed teammate result");
		expect(run).toHaveBeenCalledTimes(1);
		expect(continueFn).toHaveBeenCalledTimes(1);
		expect(continueFn.mock.calls[0]?.[0]).toContain(
			"System-delivered teammate async run updates:",
		);
		expect(sessionService.updateSessionStatus).toHaveBeenCalledWith(
			sessionId,
			"completed",
			0,
		);
	});

	it("persists failed teammate task messages for team-task sub-sessions", async () => {
		const sessionId = "sess-team-task-failure-messages";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-team-task-failure-messages.json",
				transcriptPath: "/tmp/transcript-team-task-failure-messages.log",
				hookPath: "/tmp/hook-team-task-failure-messages.log",
				messagesPath: "/tmp/messages-team-task-failure-messages.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
			onTeamTaskStart: vi.fn().mockResolvedValue(undefined),
			onTeamTaskEnd: vi.fn().mockResolvedValue(undefined),
		};

		let onTeamEvent: ((event: unknown) => void) | undefined;
		const runtimeBuilder = {
			build: vi
				.fn()
				.mockImplementation(
					(input: { onTeamEvent?: (event: unknown) => void }) => {
						onTeamEvent = input.onTeamEvent;
						return {
							tools: [],
							shutdown: vi.fn(),
						};
					},
				),
		};

		const failedMessages = [
			{ role: "user", content: [{ type: "text", text: "delegated prompt" }] },
			{ role: "assistant", content: [{ type: "text", text: "partial work" }] },
		];
		const manager = new DefaultSessionManager({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run: vi.fn().mockImplementation(async () => {
						onTeamEvent?.({
							type: "task_start",
							agentId: "providers-investigator",
							message: "Investigate provider boundaries",
						});
						onTeamEvent?.({
							type: "task_end",
							agentId: "providers-investigator",
							error: new Error("401 Unauthorized"),
							messages: failedMessages,
						});
						return createResult({ text: "lead handled failure" });
					}),
					continue: vi.fn(),
					abort: vi.fn(),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.start({
			config: createConfig({ sessionId }),
			prompt: "run teammate work",
			interactive: false,
		});

		expect(sessionService.onTeamTaskStart).toHaveBeenCalledTimes(1);
		expect(sessionService.onTeamTaskEnd).toHaveBeenCalledWith(
			sessionId,
			"providers-investigator",
			"failed",
			"[error] 401 Unauthorized",
			failedMessages,
		);
	});
});
