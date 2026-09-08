import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { MessageWithMetadata } from "@cline/llms";
import {
	type AgentConfig,
	type AgentEvent,
	type AgentExtensionAutomationContext,
	type AgentResult,
	type AgentRuntimeEvent,
	type BasicLogger,
	isChatWorkspacePath,
	TeamMessageType,
	type TeamRunRecord,
} from "@cline/shared";
import {
	resolveChatWorkspacePath,
	setClineDir,
	setHomeDir,
} from "@cline/shared/storage";
import simpleGit from "simple-git";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunCommandExecutionController } from "../../extensions/tools";
import type { TeamEvent } from "../../extensions/tools/team";
import { TelemetryService } from "../../services/telemetry/TelemetryService";
import { createSessionCompactionState } from "../../session/models/session-compaction";
import type { SessionManifest } from "../../session/models/session-manifest";
import { FileSessionService } from "../../session/services/file-session-service";
import { SessionSource } from "../../types/common";
import type { CoreSessionConfig } from "../../types/config";
import { LocalRuntimeHost as RuntimeHostUnderTest } from "./local-runtime-host";
import { type StartSessionInput, splitCoreSessionConfig } from "./runtime-host";

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

type PluginEventTestHarness = {
	handlePluginEvent: (
		rootSessionId: string,
		event: { name: string; payload?: unknown },
		fallbackAutomation?: AgentExtensionAutomationContext,
	) => Promise<void>;
	getPendingPrompts: (
		sessionId: string,
	) => Array<{ prompt: string; delivery: "queue" | "steer" }>;
};

function createPluginEventHarness(
	manager: RuntimeHostUnderTest,
): PluginEventTestHarness {
	const target = manager as object;
	return {
		handlePluginEvent: async (rootSessionId, event, fallbackAutomation) => {
			const handler = Reflect.get(target, "handlePluginEvent");
			if (typeof handler !== "function") {
				throw new Error("handlePluginEvent test hook unavailable");
			}
			await Reflect.apply(
				handler as (
					rootSessionId: string,
					event: { name: string; payload?: unknown },
					fallbackAutomation?: AgentExtensionAutomationContext,
				) => Promise<void>,
				target,
				[rootSessionId, event, fallbackAutomation],
			);
		},
		getPendingPrompts: (sessionId) => {
			const getter = Reflect.get(target, "getSessionOrThrow");
			if (typeof getter !== "function") {
				throw new Error("getSessionOrThrow test hook unavailable");
			}
			const session = Reflect.apply(
				getter as (sessionId: string) => {
					pendingPrompts: Array<{
						id: string;
						prompt: string;
						delivery: "queue" | "steer";
						userFiles?: unknown;
						userImages?: unknown;
					}>;
				},
				target,
				[sessionId],
			);
			return session.pendingPrompts.map(({ prompt, delivery }) => ({
				prompt,
				delivery,
			}));
		},
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
		mode: "act",
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
		...overrides,
	};
}

function normalizeStartInput(
	input: Omit<StartSessionInput, "config" | "localRuntime"> & {
		config: CoreSessionConfig;
	},
): StartSessionInput {
	const split = splitCoreSessionConfig(input.config);
	return {
		...input,
		...split,
	};
}

describe("LocalRuntimeHost", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
	};
	let isolatedHomeDir = "";

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "core-session-home-"));
		process.env.HOME = isolatedHomeDir;
		process.env.CLINE_DIR = join(isolatedHomeDir, ".cline");
		delete process.env.CLINE_DATA_DIR;
		setHomeDir(isolatedHomeDir);
		setClineDir(process.env.CLINE_DIR);
	});

	afterEach(() => {
		process.env.HOME = envSnapshot.HOME;
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR;
		if (envSnapshot.CLINE_DATA_DIR === undefined) {
			delete process.env.CLINE_DATA_DIR;
		} else {
			process.env.CLINE_DATA_DIR = envSnapshot.CLINE_DATA_DIR;
		}
		setHomeDir(envSnapshot.HOME ?? "~");
		setClineDir(envSnapshot.CLINE_DIR ?? join("~", ".cline"));
		rmSync(isolatedHomeDir, { recursive: true, force: true });
	});

	it("recovers stale detached command logs for non-daemon hosts", async () => {
		const detachedLogDirectory = mkdtempSync(
			join(tmpdir(), "cline-command-local-host-recovery-"),
		);
		writeFileSync(join(detachedLogDirectory, "output.log"), "stale output");
		writeFileSync(join(detachedLogDirectory, "completed-at"), "0");
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: new FileSessionService(join(isolatedHomeDir, "sessions")),
		});

		try {
			await expect.poll(() => existsSync(detachedLogDirectory)).toBe(false);
		} finally {
			await manager.dispose();
			rmSync(detachedLogDirectory, { recursive: true, force: true });
		}
	});

	it("emits injected controller completions as host events until disposed", async () => {
		const controller = new RunCommandExecutionController();
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: new FileSessionService(join(isolatedHomeDir, "sessions")),
			runCommandExecutionController: controller,
		});
		const events: unknown[] = [];
		manager.subscribe((event) => events.push(event));
		const completion = {
			sessionId: "session-1",
			executionId: "execution-1",
			logPath: "/tmp/output.log",
			detachKind: "implicit" as const,
			outcome: { kind: "exited" as const, exitCode: 0 },
			ts: 123,
		};

		controller.reportDetachedCommandCompleted(completion);
		expect(events).toEqual([
			{ type: "detached_command_completed", payload: completion },
		]);

		await manager.dispose();
		controller.reportDetachedCommandCompleted({ ...completion, ts: 456 });
		expect(events).toHaveLength(1);
	});

	it.each([
		{ source: "generated", requestedSessionId: undefined },
		{ source: "requested", requestedSessionId: "session-explicit" },
	] as const)("resolves an omitted workspace with the $source session ID", async ({
		requestedSessionId,
	}) => {
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn().mockResolvedValue(undefined),
			}),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-temp-workspace"),
			getConversationId: vi.fn().mockReturnValue("conv-temp-workspace"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const sessionsDir = join(isolatedHomeDir, "sessions");
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: new FileSessionService(sessionsDir),
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		});
		let chatWorkspace = "";

		try {
			const result = await manager.startSession({
				config: {
					...(requestedSessionId ? { sessionId: requestedSessionId } : {}),
					providerId: "mock-provider",
					modelId: "mock-model",
					systemPrompt: "You are a test agent",
					enableTools: false,
					enableSpawnAgent: false,
					enableAgentTeams: false,
				},
			});

			chatWorkspace = result.manifest.cwd;
			if (requestedSessionId) {
				expect(result.sessionId).toBe(requestedSessionId);
			}
			expect(chatWorkspace).toBe(resolveChatWorkspacePath());
			expect(isChatWorkspacePath(chatWorkspace)).toBe(true);
			expect(result.manifest.workspace_root).toBe(chatWorkspace);
			expect(existsSync(join(sessionsDir, result.sessionId))).toBe(false);
			expect(runtimeBuilder.build).toHaveBeenCalledWith(
				expect.objectContaining({
					config: expect.objectContaining({
						cwd: chatWorkspace,
						workspaceRoot: chatWorkspace,
					}),
				}),
			);
		} finally {
			await manager.dispose();
			if (chatWorkspace) {
				rmSync(dirname(chatWorkspace), { recursive: true, force: true });
			}
		}
	});

	it("stores git under metadata and refreshes it after an active turn", async () => {
		const workspaceRoot = join(isolatedHomeDir, "workspace");
		mkdirSync(workspaceRoot, { recursive: true });
		const git = simpleGit({ baseDir: workspaceRoot });
		await git.init();
		await git.addConfig("user.email", "test@example.com");
		await git.addConfig("user.name", "Test");
		await git.commit("initial", ["--allow-empty"]);
		await git.addRemote("origin", "https://example.com/original.git");

		const sessionsDir = join(isolatedHomeDir, "sessions");
		const sessionId = "session-git-metadata";
		const sessionService = new FileSessionService(sessionsDir);
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn().mockResolvedValue(undefined),
			}),
		};
		let initialManifest: SessionManifest | undefined;
		const agent = {
			run: vi.fn(async () => {
				initialManifest = JSON.parse(
					readFileSync(
						join(sessionsDir, sessionId, `${sessionId}.json`),
						"utf8",
					),
				) as SessionManifest;
				await git.checkoutLocalBranch("feature/session-git");
				await git.removeRemote("origin");
				await git.addRemote("origin", "https://example.com/updated.git");
				return createResult();
			}),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-root-git"),
			getConversationId: vi.fn().mockReturnValue("conv-root-git"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		});

		const result = await manager.startSession(
			normalizeStartInput({
				config: createConfig({
					sessionId,
					cwd: workspaceRoot,
					workspaceRoot,
					enableAgentTeams: false,
				}),
				prompt: "change repository state",
				interactive: true,
				sessionMetadata: {
					title: "Keep this title",
					checkpoint: { latest: { ref: "checkpoint-ref" } },
				},
			}),
		);

		expect(initialManifest?.metadata).toMatchObject({
			checkpoint: { latest: { ref: "checkpoint-ref" } },
			git: {
				url: "https://example.com/original.git",
				branch: expect.any(String),
			},
		});
		const manifest = JSON.parse(
			readFileSync(result.manifestPath, "utf8"),
		) as SessionManifest;
		expect(manifest).not.toHaveProperty("git_url");
		expect(manifest).not.toHaveProperty("git_branch");
		expect(manifest.metadata).toMatchObject({
			title: "change repository state",
			checkpoint: { latest: { ref: "checkpoint-ref" } },
			git: {
				url: "https://example.com/updated.git",
				branch: "feature/session-git",
			},
		});
	});

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
				teamRuntime: {
					getTeamId: vi.fn().mockReturnValue("team_test-team"),
					getTeamName: vi.fn().mockReturnValue("test-team"),
				},
				teamRestoredFromPersistence: false,
				shutdown: vi.fn(),
			}),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
			telemetry,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ telemetry, sessionId }),
				prompt: "hello",
			}),
		);

		// `session.started` is emitted from `ClineCore.start` (see
		// `ClineCore.test.ts`), not from `LocalRuntimeHost`, so that the
		// signal fires for every backend. We assert that it is NOT emitted
		// here and only transport-scoped events remain.
		expect(adapter.emit).not.toHaveBeenCalledWith(
			"session.started",
			expect.anything(),
		);
		expect(adapter.emit).toHaveBeenCalledWith(
			"task.agent_created",
			expect.objectContaining({
				ulid: sessionId,
				agentId: "agent-root-1",
				agentKind: "team_lead",
				conversationId: "conv-root-1",
				teamRole: "lead",
				distinct_id: distinctId,
			}),
		);
		expect(adapter.emit).toHaveBeenCalledWith(
			"task.agent_team_created",
			expect.objectContaining({
				ulid: sessionId,
				leadAgentId: "agent-root-1",
				restoredFromPersistence: false,
				distinct_id: distinctId,
			}),
		);
	});

	it("resolves OAuth credentials before creating the agent", async () => {
		const sessionId = "sess-oauth-bootstrap";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
				messagesPath: "/tmp/messages.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({ tools: [], shutdown: vi.fn() }),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const createAgent = vi.fn(() => agent as never);
		const oauthTokenManager = {
			resolveProviderApiKey: vi.fn().mockResolvedValue({
				apiKey: "workos:resolved-token",
				refreshed: false,
			}),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent,
			oauthTokenManager: oauthTokenManager as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({
					sessionId,
					providerId: "cline-pass",
					modelId: "cline-pass/glm-5.2",
					apiKey: undefined,
				}),
				prompt: "hello",
			}),
		);

		expect(oauthTokenManager.resolveProviderApiKey).toHaveBeenCalledWith({
			providerId: "cline-pass",
		});
		expect(createAgent).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "cline-pass",
				apiKey: "workos:resolved-token",
			}),
		);
	});

	it("persists provider/model connection updates to the session manifest", async () => {
		const sessionId = "sess-connection-manifest-update";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
				messagesPath: "/tmp/messages.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({ tools: [], shutdown: vi.fn() }),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			updateConnection: vi.fn(),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const createAgent = vi.fn(() => agent as never);
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				prompt: "hello",
				interactive: true,
			}),
		);
		sessionService.writeSessionManifest.mockClear();

		// A disk-only writer (compaction path, rename) updated the manifest
		// behind the in-memory copy's back; the connection update must re-read
		// and preserve it instead of clobbering it with the stale copy.
		const diskManifest = {
			...manifest,
			compaction_path: "/tmp/compaction.json",
			title: "renamed session",
		};
		const readSessionManifest = vi.fn().mockResolvedValue(diskManifest);
		(sessionService as Record<string, unknown>).readSessionManifest =
			readSessionManifest;

		await manager.updateSessionConnection(sessionId, {
			providerId: "openai",
			modelId: "codex-test",
		});

		expect(sessionService.writeSessionManifest).toHaveBeenCalledWith(
			"/tmp/manifest.json",
			expect.objectContaining({
				session_id: sessionId,
				provider: "openai",
				model: "codex-test",
				compaction_path: "/tmp/compaction.json",
				title: "renamed session",
			}),
		);

		sessionService.writeSessionManifest.mockClear();
		await manager.updateSessionConnection(sessionId, { thinking: true });
		expect(sessionService.writeSessionManifest).not.toHaveBeenCalled();
	});

	it("persists thinking budget token connection updates", async () => {
		const sessionId = "sess-thinking-budget-update";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
				messagesPath: "/tmp/messages.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({ tools: [], shutdown: vi.fn() }),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			updateConnection: vi.fn(),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const createAgent = vi.fn(() => agent as never);
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({
					sessionId,
					thinking: true,
					reasoningEffort: "high",
					thinkingBudgetTokens: 1024,
					temperature: 0.3,
				}),
				prompt: "hello",
				interactive: true,
			}),
		);

		expect(createAgent).toHaveBeenCalledWith(
			expect.objectContaining({
				thinking: true,
				reasoningEffort: "high",
				thinkingBudgetTokens: 1024,
				temperature: 0.3,
			}),
		);

		await manager.updateSessionConnection(sessionId, {
			thinkingBudgetTokens: 2048,
		});

		const getSessionOrThrow = Reflect.get(
			manager as object,
			"getSessionOrThrow",
		) as (sessionId: string) => { config: CoreSessionConfig };
		const session = Reflect.apply(getSessionOrThrow, manager, [sessionId]) as {
			config: CoreSessionConfig;
		};
		expect(session.config.thinking).toBe(true);
		expect(session.config.thinkingBudgetTokens).toBe(2048);
		expect(agent.updateConnection).toHaveBeenLastCalledWith({
			thinking: true,
			thinkingBudgetTokens: 2048,
		});

		await manager.updateSessionConnection(sessionId, {
			thinking: false,
			reasoningEffort: "high",
			thinkingBudgetTokens: 4096,
		});

		expect(session.config.thinking).toBe(false);
		expect(session.config.reasoningEffort).toBeUndefined();
		expect(session.config.thinkingBudgetTokens).toBeUndefined();
		expect(agent.updateConnection).toHaveBeenLastCalledWith({
			thinking: false,
			reasoningEffort: undefined,
			thinkingBudgetTokens: undefined,
		});

		await manager.updateSessionConnection(sessionId, {
			thinking: null,
			reasoningEffort: null,
			thinkingBudgetTokens: null,
		});

		expect(session.config.thinking).toBeUndefined();
		expect(session.config.reasoningEffort).toBeUndefined();
		expect(session.config.thinkingBudgetTokens).toBeUndefined();
	});

	it("captures active session lookup misses as handled telemetry", async () => {
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
		const telemetry = new TelemetryService({ adapters: [adapter] });
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: {} as never,
			telemetry,
		});

		await expect(
			manager.runTurn({ sessionId: "missing-session", prompt: "hi" }),
		).rejects.toThrow("session not found: missing-session");

		expect(adapter.emit).toHaveBeenCalledWith(
			"sdk.error",
			expect.objectContaining({
				component: "core",
				operation: "session.active_lookup",
				severity: "warn",
				handled: true,
				sessionId: "missing-session",
				activeSessionCount: 0,
				error_message: "session not found: missing-session",
			}),
		);
	});

	it("passes app runtime capabilities into the local execution path", async () => {
		const sessionId = "sess-local-capabilities";
		const manifest = createManifest(sessionId);
		const askQuestion = vi.fn(async () => "Use shared handler");
		const requestToolApproval = vi.fn(async () => ({ approved: true }));
		const appCapabilities = {
			toolExecutors: { askQuestion },
			requestToolApproval,
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
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: {
				ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
				createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
					manifestPath: "/tmp/manifest.json",
					messagesPath: "/tmp/messages.json",
					manifest,
				}),
				persistSessionMessages: vi.fn(),
				updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
				writeSessionManifest: vi.fn(),
				listSessions: vi.fn().mockResolvedValue([]),
				deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
			} as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: (config) => {
				expect(typeof config.requestToolApproval).toBe("function");
				return agent as never;
			},
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				prompt: "hello",
				capabilities: appCapabilities,
			}),
		);

		expect(runtimeBuilder.build).toHaveBeenCalledWith(
			expect.objectContaining({
				toolExecutors: expect.objectContaining({ askQuestion }),
			}),
		);
		expect(
			vi.mocked(runtimeBuilder.build).mock.calls[0]?.[0].toolExecutors
				?.askQuestion,
		).toBe(askQuestion);
		expect(agent.run).toHaveBeenCalledWith(
			expect.stringContaining("hello"),
			undefined,
			undefined,
		);
	});

	it("marks interactive sessions pending while awaiting tool approval", async () => {
		const sessionId = "sess-pending-approval-status";
		const manifest = createManifest(sessionId);
		let resolveApproval:
			| ((result: { approved: boolean; reason?: string }) => void)
			| undefined;
		const requestToolApproval = vi.fn(
			() =>
				new Promise<{ approved: boolean; reason?: string }>((resolve) => {
					resolveApproval = resolve;
				}),
		);
		let capturedConfig: AgentConfig | undefined;
		const updateSessionStatus = vi.fn().mockResolvedValue({ updated: true });
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		const agent = {
			run: vi.fn(async () => {
				const approval = await capturedConfig?.requestToolApproval?.({
					sessionId,
					agentId: "agent-root-1",
					conversationId: "conv-root-1",
					iteration: 1,
					toolCallId: "call-approval-1",
					toolName: "edit_file",
					input: { path: "README.md" },
					policy: { autoApprove: false },
				});
				expect(approval?.approved).toBe(true);
				return createResult();
			}),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: {
				ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
				createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
					manifestPath: "/tmp/manifest.json",
					messagesPath: "/tmp/messages.json",
					manifest,
				}),
				persistSessionMessages: vi.fn(),
				updateSessionStatus,
				writeSessionManifest: vi.fn(),
				listSessions: vi.fn().mockResolvedValue([]),
				deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
			} as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: (config) => {
				capturedConfig = config;
				return agent as never;
			},
		});
		const pendingStatus = new Promise<void>((resolve) => {
			manager.subscribe((event) => {
				if (
					event.type === "status" &&
					event.payload.sessionId === sessionId &&
					event.payload.status === "pending"
				) {
					resolve();
				}
			});
		});

		const started = manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				prompt: "hello",
				interactive: true,
				capabilities: { requestToolApproval },
			}),
		);
		await pendingStatus;

		await expect(manager.getSession(sessionId)).resolves.toMatchObject({
			sessionId,
			status: "pending",
		});
		resolveApproval?.({ approved: true });
		await started;

		expect(updateSessionStatus).toHaveBeenNthCalledWith(
			1,
			sessionId,
			"pending",
			null,
		);
		expect(updateSessionStatus).toHaveBeenNthCalledWith(
			2,
			sessionId,
			"running",
			null,
		);
		expect(updateSessionStatus).toHaveBeenNthCalledWith(
			3,
			sessionId,
			"idle",
			null,
		);
		await expect(manager.getSession(sessionId)).resolves.toMatchObject({
			sessionId,
			status: "idle",
		});
	});

	it("ingests automation events emitted by sandbox plugins during setup", async () => {
		const sessionId = "sess-plugin-automation-setup";
		const ingestEvent = vi.fn().mockResolvedValue(undefined);
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: {
				ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
				listSessions: vi.fn().mockResolvedValue([]),
			} as never,
		});
		const harness = createPluginEventHarness(manager);

		await harness.handlePluginEvent(
			sessionId,
			{
				name: "automation_event",
				payload: {
					eventId: "evt_setup_1",
					eventType: "local.plugin_event",
					source: "local-plugin",
					occurredAt: "2026-04-24T10:00:00.000Z",
				},
			},
			{ ingestEvent },
		);

		expect(ingestEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				eventId: "evt_setup_1",
				eventType: "local.plugin_event",
			}),
		);
	});

	it("ingests automation events emitted by plugins after session registration", async () => {
		const sessionId = "sess-plugin-automation-registered";
		const manifest = createManifest(sessionId);
		const ingestEvent = vi.fn().mockResolvedValue(undefined);
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
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: {
				ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
				createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
					manifestPath: "/tmp/manifest.json",
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
			} as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({
					sessionId,
					extensionContext: { automation: { ingestEvent } },
				}),
				prompt: undefined,
				interactive: true,
			}),
		);

		const harness = createPluginEventHarness(manager);
		await harness.handlePluginEvent(sessionId, {
			name: "automation_event",
			payload: {
				eventId: "evt_registered_1",
				eventType: "local.plugin_event",
				source: "local-plugin",
				occurredAt: "2026-04-24T10:00:00.000Z",
			},
		});

		expect(ingestEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				eventId: "evt_registered_1",
				eventType: "local.plugin_event",
			}),
		);
	});

	it("persists custom session sources without coercing them to builtin values", async () => {
		const sessionId = "sess-kanban";
		const manifest = {
			...createManifest(sessionId),
			source: "kanban",
		};
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
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
				teamRuntime: undefined,
				teamRestoredFromPersistence: false,
				shutdown: vi.fn(),
			}),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		});

		const started = await manager.startSession(
			normalizeStartInput({
				source: "kanban",
				config: createConfig({ sessionId }),
				prompt: "hello",
			}),
		);

		expect(sessionService.createRootSessionWithArtifacts).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId,
				source: "kanban",
			}),
		);
		expect(started.manifest.source).toBe("kanban");
	});

	it("persists seeded history at session start so recovery can rebuild it", async () => {
		const sessionId = "sess-fork-copy";
		const manifest = createManifest(sessionId);
		const initialMessages: MessageWithMetadata[] = [
			{ role: "user" as const, content: "build a thing" },
			{ role: "assistant" as const, content: "done" },
		];
		const continuedMessages: MessageWithMetadata[] = [
			...initialMessages,
			{ role: "user" as const, content: "continue" },
			{ role: "assistant" as const, content: "continued" },
		];
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
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
				teamRuntime: undefined,
				teamRestoredFromPersistence: false,
				shutdown: vi.fn(),
			}),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(
				createResult({
					messages: continuedMessages,
				}),
			),
			getMessages: vi.fn().mockReturnValue(initialMessages),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
				initialMessages,
			}),
		);

		expect(agent.run).not.toHaveBeenCalled();
		// Seeded history is durable immediately: if the resident session is
		// lost before the first completed turn (hub restart/crash), the
		// missing-session recovery rebuilds from the persisted file instead of
		// silently wiping the conversation.
		expect(sessionService.createRootSessionWithArtifacts).toHaveBeenCalledWith(
			expect.objectContaining({ sessionId }),
		);
		expect(sessionService.persistSessionMessages).toHaveBeenCalledWith(
			sessionId,
			initialMessages,
			"You are a test agent",
		);
		expect(sessionService.updateSessionStatus).not.toHaveBeenCalled();
		await expect(manager.readLiveSessionMessages(sessionId)).resolves.toEqual(
			initialMessages,
		);

		await manager.runTurn({ sessionId, prompt: "continue" });

		expect(agent.continue).toHaveBeenCalledTimes(1);
		expect(sessionService.persistSessionMessages).toHaveBeenLastCalledWith(
			sessionId,
			expect.arrayContaining(
				continuedMessages.map((message) => expect.objectContaining(message)),
			),
			"You are a test agent",
		);
		await expect(manager.getSession(sessionId)).resolves.toMatchObject({
			sessionId,
			status: "idle",
		});
	});

	it("keeps brand-new empty sessions lazy until the first user turn", async () => {
		const sessionId = "sess-lazy-empty";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
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
				teamRuntime: undefined,
				teamRestoredFromPersistence: false,
				shutdown: vi.fn(),
			}),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);

		// No seeded history to protect: closing the runtime before any user
		// turn must still leave no empty history entry behind.
		expect(
			sessionService.createRootSessionWithArtifacts,
		).not.toHaveBeenCalled();
		expect(sessionService.persistSessionMessages).not.toHaveBeenCalled();
	});

	it("readLiveSessionMessages serves in-memory messages for resident sessions before persistence", async () => {
		const sessionId = "sess-live-messages";
		const manifest = createManifest(sessionId);
		// The in-flight conversation exists only on the agent; nothing has been
		// flushed to the messages file yet (mid-turn, or an aborted turn).
		const liveMessages: MessageWithMetadata[] = [
			{ role: "user" as const, content: "list the files in this folder" },
			{ role: "assistant" as const, content: "I will list them now." },
		];
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
				messagesPath: join(isolatedHomeDir, "never-written.json"),
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
				teamRuntime: undefined,
				teamRestoredFromPersistence: false,
				shutdown: vi.fn(),
			}),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue(liveMessages),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);

		// The live read sees the conversation; the persisted read still lags.
		await expect(manager.readLiveSessionMessages(sessionId)).resolves.toEqual(
			liveMessages,
		);
		await expect(manager.readSessionMessages(sessionId)).resolves.toEqual([]);
	});

	it("reads manifest-only session records and messages", async () => {
		const sessionId = "manifest-only-session";
		const messagesPath = join(isolatedHomeDir, "messages.json");
		const messages = [
			{ role: "user" as const, content: "from manifest" },
			{ role: "assistant" as const, content: "loaded" },
		];
		writeFileSync(
			messagesPath,
			`${JSON.stringify({ version: 1, messages })}\n`,
			"utf8",
		);
		const manifest: SessionManifest = {
			...createManifest(sessionId),
			messages_path: messagesPath,
		};
		const sessionService = {
			listSessions: vi.fn().mockResolvedValue([]),
			readSessionManifest: vi.fn().mockReturnValue(manifest),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
		});

		await expect(manager.getSession(sessionId)).resolves.toMatchObject({
			sessionId,
			source: manifest.source,
			messagesPath,
		});
		await expect(manager.readSessionMessages(sessionId)).resolves.toEqual(
			messages,
		);
		expect(sessionService.readSessionManifest).toHaveBeenCalledWith(sessionId);
	});

	it("marks interactive sessions idle after a completed turn", async () => {
		const sessionId = "sess-interactive-turn-status";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
				messagesPath: "/tmp/messages.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi
				.fn()
				.mockImplementation(async (_sessionId: string, status: string) => ({
					updated: true,
					...(status === "running" || status === "idle" || status === "pending"
						? {}
						: { endedAt: "2026-01-01T00:00:05.000Z" }),
				})),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtime = { tools: [], shutdown: vi.fn() };
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue(runtime),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				prompt: "hello",
				interactive: true,
			}),
		);

		expect(sessionService.updateSessionStatus).toHaveBeenCalledWith(
			sessionId,
			"idle",
			null,
		);
		await expect(manager.getSession(sessionId)).resolves.toMatchObject({
			sessionId,
			status: "idle",
		});
		expect(agent.shutdown).not.toHaveBeenCalled();
		expect(runtime.shutdown).not.toHaveBeenCalled();
	});

	it("disposes idle interactive sessions without changing status", async () => {
		const sessionId = "sess-interactive-dispose";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
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
		const runtime = { tools: [], shutdown: vi.fn() };
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue(runtime),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		});

		// No seeded history: the session never materializes artifacts, so
		// disposing it must not write a status row.
		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);
		sessionService.updateSessionStatus.mockClear();

		await manager.dispose("test_dispose");

		expect(sessionService.updateSessionStatus).not.toHaveBeenCalled();
		expect(agent.shutdown).toHaveBeenCalledWith("test_dispose");
		expect(runtime.shutdown).toHaveBeenCalledWith("test_dispose");
	});

	it("reuses the persisted team name when resuming a session", async () => {
		const sessionId = "sess-team-resume";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
				messagesPath: "/tmp/messages.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({
				updated: true,
				endedAt: "2026-01-01T00:00:05.000Z",
			}),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([
				{
					sessionId,
					source: SessionSource.CLI,
					pid: process.pid,
					startedAt: "2026-01-01T00:00:00.000Z",
					endedAt: null,
					exitCode: null,
					status: "running",
					statusLock: 0,
					interactive: true,
					provider: "mock-provider",
					model: "mock-model",
					cwd: "/tmp/project",
					workspaceRoot: "/tmp/project",
					teamName: "persisted-team",
					enableTools: true,
					enableSpawn: true,
					enableTeams: true,
					parentSessionId: null,
					parentAgentId: null,
					agentId: null,
					conversationId: null,
					isSubagent: false,
					prompt: null,
					metadata: null,
					messagesPath: "/tmp/messages.json",
					updatedAt: "2026-01-01T00:00:00.000Z",
				},
			]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				teamRuntime: {
					getTeamId: vi.fn().mockReturnValue("team_persisted-team"),
					getTeamName: vi.fn().mockReturnValue("persisted-team"),
				},
				teamRestoredFromPersistence: true,
				shutdown: vi.fn(),
			}),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId, teamName: undefined }),
			}),
		);

		expect(runtimeBuilder.build).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					sessionId,
					teamName: "persisted-team",
				}),
			}),
		);
		expect(
			sessionService.createRootSessionWithArtifacts,
		).not.toHaveBeenCalled();
	});

	it("runs a non-interactive prompt and persists messages/status", async () => {
		const sessionId = "sess-1";
		const manifest = createManifest(sessionId);
		const createRootSessionWithArtifacts = vi.fn().mockResolvedValue({
			manifestPath: "/tmp/manifest.json",
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
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue([]),
			messages: [],
		};

		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () => agent as never,
		});

		const started = await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				prompt: "hello",
				interactive: false,
			}),
		);

		expect(started.sessionId).toBe(sessionId);
		expect(started.result?.finishReason).toBe("completed");
		expect(run).toHaveBeenCalledTimes(1);
		expect(continueFn).not.toHaveBeenCalled();
		expect(persistSessionMessages).toHaveBeenCalledTimes(1);
		expect(updateSessionStatus).toHaveBeenCalledWith(sessionId, "completed", 0);
		expect(writeSessionManifest).toHaveBeenCalledTimes(1);
		expect(shutdown).toHaveBeenCalledTimes(1);
	});

	it("does not fail the run when assistant-response disk flush fails", async () => {
		const sessionId = "sess-assistant-flush";
		const manifest = createManifest(sessionId);
		const createRootSessionWithArtifacts = vi.fn().mockResolvedValue({
			manifestPath: "/tmp/manifest-assistant-flush.json",
			messagesPath: "/tmp/messages-assistant-flush.json",
			manifest,
		});
		const order: string[] = [];
		const persistError = new Error("disk full");
		let persistCallCount = 0;
		const persistSessionMessages = vi.fn().mockImplementation(() => {
			order.push("persist");
			persistCallCount += 1;
			if (persistCallCount === 1) {
				return Promise.reject(persistError);
			}
			return Promise.resolve();
		});
		const logger: BasicLogger = {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		};
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts,
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
		const messages = [
			{
				role: "user" as const,
				content: [{ type: "text" as const, text: "hello" }],
			},
			{
				role: "assistant" as const,
				content: [{ type: "text" as const, text: "ready on disk" }],
			},
		];
		const run = vi.fn(
			async (
				_prompt: string,
				_userImages?: string[],
				_userFiles?: string[],
			) => {
				const assistantEvent: AgentRuntimeEvent = {
					type: "assistant-message",
					iteration: 1,
					finishReason: "stop",
					message: {
						id: "msg_assistant",
						role: "assistant",
						content: [{ type: "text", text: "ready on disk" }],
						createdAt: Date.now(),
					},
					snapshot: {
						agentId: "agent-root-1",
						runId: "run-1",
						status: "running",
						iteration: 1,
						messages: [],
						pendingToolCalls: [],
						usage: {
							inputTokens: 0,
							outputTokens: 0,
							cacheReadTokens: 0,
							cacheWriteTokens: 0,
							totalCost: 0,
						},
					},
				};
				await capturedConfig?.hooks?.onEvent?.(assistantEvent);
				order.push("run-return");
				return createResult({ messages });
			},
		);
		let capturedConfig:
			| {
					hooks?: {
						onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>;
					};
			  }
			| undefined;
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: (config) => {
				capturedConfig = config;
				return {
					run,
					continue: vi.fn(),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi
						.fn()
						.mockReturnValueOnce([])
						.mockReturnValue(messages),
					messages: [],
				} as never;
			},
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId, logger }),
				prompt: "hello",
				interactive: false,
			}),
		);

		expect(persistSessionMessages).toHaveBeenCalledTimes(2);
		expect(persistSessionMessages).toHaveBeenNthCalledWith(
			1,
			sessionId,
			messages,
			"You are a test agent",
		);
		expect(order).toEqual(["persist", "run-return", "persist"]);
		expect(logger.error).toHaveBeenCalledWith(
			"Failed to persist session messages after assistant response",
			{ sessionId, error: persistError },
		);
	});

	it("observes iteration-end persist failures instead of leaking an unhandled rejection", async () => {
		const sessionId = "sess-iteration-end-persist";
		const manifest = createManifest(sessionId);
		const persistError = new Error("row missing");
		const persistSessionMessages = vi
			.fn()
			.mockRejectedValueOnce(persistError)
			.mockResolvedValue(undefined);
		const logger: BasicLogger = {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		};
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-iteration-end.json",
				messagesPath: "/tmp/messages-iteration-end.json",
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
		let subscribedHandler: ((event: AgentRuntimeEvent) => void) | undefined;
		const run = vi.fn(async () => {
			subscribedHandler?.({ type: "iteration_end", iteration: 1 } as never);
			// Let the fire-and-forget persist settle before the run returns.
			await new Promise((resolve) => setImmediate(resolve));
			return createResult();
		});
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: vi.fn(),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockImplementation((handler) => {
						subscribedHandler = handler as (event: AgentRuntimeEvent) => void;
						return () => {};
					}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		const started = await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId, logger }),
				prompt: "hello",
				interactive: false,
			}),
		);

		expect(started.result?.finishReason).toBe("completed");
		expect(logger.error).toHaveBeenCalledWith(
			"Failed to persist session messages from agent event",
			{ sessionId, error: persistError },
		);
	});

	it("does not fail a completed run when shutdown cleanup throws", async () => {
		const sessionId = "sess-cleanup-errors";
		const manifest = createManifest(sessionId);
		const createRootSessionWithArtifacts = vi.fn().mockResolvedValue({
			manifestPath: "/tmp/manifest-cleanup-errors.json",
			messagesPath: "/tmp/messages-cleanup-errors.json",
			manifest,
		});
		const persistSessionMessages = vi.fn();
		const updateSessionStatus = vi
			.fn()
			.mockRejectedValue(new Error("status write failed"));
		const writeSessionManifest = vi.fn();
		const listSessions = vi.fn().mockResolvedValue([]);
		const deleteSession = vi.fn().mockResolvedValue({ deleted: true });
		const logger: BasicLogger = { debug: vi.fn(), log: vi.fn() };
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts,
			persistSessionMessages,
			updateSessionStatus,
			writeSessionManifest,
			listSessions,
			deleteSession,
		};

		const shutdown = vi
			.fn()
			.mockRejectedValue(new Error("runtime shutdown failed"));
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown,
				logger,
			}),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn(),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			shutdown: vi.fn().mockRejectedValue(new Error("agent shutdown failed")),
			getMessages: vi.fn().mockReturnValue([]),
			messages: [],
		};

		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () => agent as never,
		});

		const started = await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId, logger }),
				prompt: "hello",
				interactive: false,
			}),
		);

		expect(started.result?.finishReason).toBe("completed");
		expect(updateSessionStatus).toHaveBeenCalledWith(sessionId, "completed", 0);
		// `SessionRuntime.shutdown(reason?, timeoutMs?)` forwards the
		// reason string into the `session_shutdown` hook payload, so
		// host-level hook-file handlers can route on it (e.g.
		// `isAbortReason(ctx.reason)` in `hook-file-hooks.ts`).
		// The transport-level `session.runtime.shutdown(reason)` on
		// the next line also receives the same reason.
		expect(agent.shutdown).toHaveBeenCalledWith("session_complete");
		expect(shutdown).toHaveBeenCalledWith("session_complete");
		expect(logger.log).toHaveBeenCalledWith(
			"Session shutdown cleanup failed",
			expect.objectContaining({
				sessionId,
				stage: "update_status",
				severity: "warn",
			}),
		);
		expect(logger.log).toHaveBeenCalledWith(
			"Session shutdown cleanup failed",
			expect.objectContaining({
				sessionId,
				stage: "agent_shutdown",
				severity: "warn",
			}),
		);
		expect(logger.log).toHaveBeenCalledWith(
			"Session shutdown cleanup failed",
			expect.objectContaining({
				sessionId,
				stage: "runtime_shutdown",
				severity: "warn",
			}),
		);
	});

	it("preserves manifest metadata updates and persists total cost", async () => {
		const sessionId = "sess-history-meta";
		let storedManifest: SessionManifest = {
			...createManifest(sessionId),
			metadata: {
				checkpoint: {
					latest: {
						ref: "abc123",
						createdAt: 1,
						runCount: 1,
					},
					history: [
						{
							ref: "abc123",
							createdAt: 1,
							runCount: 1,
						},
					],
				},
			},
		};
		const createRootSessionWithArtifacts = vi.fn().mockResolvedValue({
			manifestPath: "/tmp/manifest-history-meta.json",
			messagesPath: "/tmp/messages-history-meta.json",
			manifest: { ...storedManifest },
		});
		const persistSessionMessages = vi.fn();
		const updateSession = vi.fn().mockImplementation(async (input) => {
			storedManifest = {
				...storedManifest,
				metadata: input.metadata,
			};
			return { updated: true };
		});
		const updateSessionStatus = vi.fn().mockResolvedValue({
			updated: true,
			endedAt: "2026-01-01T00:00:05.000Z",
		});
		const readSessionManifest = vi
			.fn()
			.mockImplementation(() => storedManifest);
		const writeSessionManifest = vi
			.fn()
			.mockImplementation((_path, manifest) => {
				storedManifest = manifest;
			});
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts,
			persistSessionMessages,
			updateSession,
			updateSessionStatus,
			readSessionManifest,
			writeSessionManifest,
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
			run: vi.fn().mockResolvedValue(
				createResult({
					usage: {
						inputTokens: 3,
						outputTokens: 4,
						totalCost: 0.42,
					},
					messages: [
						{ role: "user", content: [{ type: "text", text: "hello" }] },
					],
				}),
			),
			continue: vi.fn(),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue([]),
			messages: [],
		};

		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				prompt: "hello",
				interactive: false,
			}),
		);

		expect(updateSession).toHaveBeenCalledWith({
			sessionId,
			metadata: {
				checkpoint: {
					latest: {
						ref: "abc123",
						createdAt: 1,
						runCount: 1,
					},
					history: [
						{
							ref: "abc123",
							createdAt: 1,
							runCount: 1,
						},
					],
				},
				totalCost: 0.42,
				aggregatedAgentsCost: 0.42,
				usage: {
					inputTokens: 3,
					outputTokens: 4,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: 0.42,
				},
				aggregateUsage: {
					inputTokens: 3,
					outputTokens: 4,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: 0.42,
				},
			},
		});
		expect(writeSessionManifest).toHaveBeenCalledWith(
			"/tmp/manifest-history-meta.json",
			expect.objectContaining({
				metadata: {
					checkpoint: {
						latest: {
							ref: "abc123",
							createdAt: 1,
							runCount: 1,
						},
						history: [
							{
								ref: "abc123",
								createdAt: 1,
								runCount: 1,
							},
						],
					},
					totalCost: 0.42,
					aggregatedAgentsCost: 0.42,
					usage: {
						inputTokens: 3,
						outputTokens: 4,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						totalCost: 0.42,
					},
					aggregateUsage: {
						inputTokens: 3,
						outputTokens: 4,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						totalCost: 0.42,
					},
				},
				status: "completed",
			}),
		);
	});

	it("does not install checkpoint hooks when checkpoint.enabled is not set in config", async () => {
		const sessionId = "sess-checkpoint-default-off";
		const manifest = createManifest(sessionId);
		const updateSession = vi.fn().mockResolvedValue({ updated: true });
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-checkpoint-default-off.json",
				messagesPath: "/tmp/messages-checkpoint-default-off.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSession,
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([
				{
					sessionId,
					provider: "mock-provider",
					model: "mock-model",
					cwd: "/tmp/project",
					workspaceRoot: "/tmp/project",
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
					status: "running",
					metadata: undefined,
				},
			]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockImplementation(() => {
				return {
					tools: [],
					shutdown: vi.fn(),
				};
			}),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: (config) =>
				({
					run: vi.fn().mockImplementation(async () => {
						const snapshot = {
							agentId: "agent_1",
							runId: "conv_1",
							parentAgentId: null,
							status: "running" as const,
							iteration: 1,
							messages: [],
							pendingToolCalls: [],
							usage: {
								inputTokens: 0,
								outputTokens: 0,
								cacheReadTokens: 0,
								cacheWriteTokens: 0,
							},
						};
						await config.hooks?.beforeRun?.({
							snapshot: { ...snapshot, iteration: 0 },
						});
						await config.hooks?.beforeModel?.({
							snapshot,
							request: { messages: [], tools: [] },
						});
						return createResult();
					}),
					continue: vi.fn(),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				prompt: "hello",
				interactive: false,
			}),
		);
		expect(updateSession).toHaveBeenCalledTimes(1);
		expect(updateSession).toHaveBeenLastCalledWith({
			sessionId,
			metadata: {
				totalCost: 0,
				aggregatedAgentsCost: 0,
				usage: {
					inputTokens: 1,
					outputTokens: 2,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: 0,
				},
				aggregateUsage: {
					inputTokens: 1,
					outputTokens: 2,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: 0,
				},
			},
		});
	});

	it("installs checkpoint hooks when checkpoint.enabled=true in config", async () => {
		const sessionId = "sess-checkpoint-config-on";
		const checkpointRef = "a".repeat(40);
		const repoCwd = join(isolatedHomeDir, "checkpoint-repo");
		const createCheckpoint = vi.fn(({ runCount }) => ({
			ref: checkpointRef,
			createdAt: 123,
			runCount,
			kind: "commit" as const,
		}));
		const manifest = createManifest(sessionId);
		const updateSession = vi.fn().mockResolvedValue({ updated: true });
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-checkpoint-env-on.json",
				messagesPath: "/tmp/messages-checkpoint-env-on.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSession,
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([
				{
					sessionId,
					provider: "mock-provider",
					model: "mock-model",
					cwd: repoCwd,
					workspaceRoot: repoCwd,
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
					status: "running",
					metadata: undefined,
				},
			]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockImplementation(() => {
				return {
					tools: [],
					shutdown: vi.fn(),
				};
			}),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: (config) =>
				({
					run: vi.fn().mockImplementation(async () => {
						const snapshot = {
							agentId: "agent_1",
							runId: "conv_1",
							parentAgentId: null,
							status: "running" as const,
							iteration: 1,
							messages: [
								{
									id: "user-first",
									role: "user" as const,
									content: [{ type: "text" as const, text: "first" }],
									createdAt: 1,
								},
								{
									id: "user-second",
									role: "user" as const,
									content: [{ type: "text" as const, text: "second" }],
									createdAt: 2,
								},
								{
									id: "user-current",
									role: "user" as const,
									content: [{ type: "text" as const, text: "hello" }],
									createdAt: 3,
								},
							],
							pendingToolCalls: [],
							usage: {
								inputTokens: 0,
								outputTokens: 0,
								cacheReadTokens: 0,
								cacheWriteTokens: 0,
							},
						};
						await config.hooks?.beforeRun?.({
							snapshot: {
								...snapshot,
								iteration: 0,
								messages: snapshot.messages.slice(0, -1),
							},
						});
						await config.hooks?.beforeModel?.({
							snapshot,
							request: { messages: [], tools: [] },
						});
						return createResult();
					}),
					continue: vi.fn(),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: {
					...createConfig({ sessionId, cwd: repoCwd }),
					checkpoint: { enabled: true, createCheckpoint },
				},
				prompt: "hello",
				initialMessages: [
					{ role: "user", content: "first" },
					{ role: "assistant", content: "first response" },
					{ role: "user", content: "second" },
				],
				interactive: true,
			}),
		);
		await expect(manager.getSession(sessionId)).resolves.toEqual(
			expect.objectContaining({
				metadata: expect.objectContaining({
					checkpoint: expect.objectContaining({
						latest: expect.objectContaining({
							ref: checkpointRef,
							runCount: 3,
						}),
					}),
				}),
			}),
		);
		expect(createCheckpoint).toHaveBeenCalledWith({
			cwd: repoCwd,
			sessionId,
			runCount: 3,
		});
		expect(updateSession).toHaveBeenCalledTimes(2);
		expect(updateSession).toHaveBeenNthCalledWith(1, {
			sessionId,
			metadata: expect.objectContaining({
				checkpoint: expect.objectContaining({
					latest: expect.objectContaining({
						ref: checkpointRef,
						runCount: 3,
					}),
				}),
			}),
		});
		expect(updateSession).toHaveBeenNthCalledWith(2, {
			sessionId,
			metadata: expect.objectContaining({
				checkpoint: expect.objectContaining({
					latest: expect.objectContaining({
						ref: checkpointRef,
						runCount: 3,
					}),
				}),
				totalCost: 0,
			}),
		});
	});

	it("persists assistant message metadata for usage and model identity", async () => {
		const sessionId = "sess-meta";
		const manifest = createManifest(sessionId);
		const persistSessionMessages = vi.fn();
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-meta.json",
				messagesPath: "/tmp/messages-meta.json",
				manifest,
			}),
			persistSessionMessages,
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const updateConnectionDefaults = vi.fn();
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				delegatedAgentConfigProvider: {
					getRuntimeConfig: vi.fn(),
					getConnectionConfig: vi.fn(),
					updateConnectionDefaults,
				},
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
					info: {
						id: "claude-sonnet-4-6",
						family: "claude-sonnet-4",
					},
				},
				endedAt: new Date("2026-01-01T00:00:02.000Z"),
				messages: [
					{ role: "user", content: [{ type: "text", text: "hello" }] },
					{ role: "assistant", content: [{ type: "text", text: "world" }] },
				],
			}),
		);
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: vi.fn(),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({
					sessionId,
					providerId: "anthropic",
					modelId: "claude-sonnet-4-6",
				}),
				prompt: "hello",
				interactive: false,
			}),
		);

		expect(persistSessionMessages).toHaveBeenCalledTimes(1);
		const persisted = persistSessionMessages.mock.calls[0]?.[1];
		expect(Array.isArray(persisted)).toBe(true);
		expect(persisted?.[1]).toMatchObject({
			role: "assistant",
			modelInfo: {
				id: "claude-sonnet-4-6",
				provider: "anthropic",
				family: "claude-sonnet-4",
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

	it("queues sandbox steer messages back into the active session", async () => {
		const sessionId = "sess-steer";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
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
		const updateConnectionDefaults = vi.fn();
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				delegatedAgentConfigProvider: {
					getRuntimeConfig: vi.fn(),
					getConnectionConfig: vi.fn(),
					updateConnectionDefaults,
				},
				shutdown: vi.fn(),
			}),
		};
		const run = vi.fn().mockResolvedValue(
			createResult({
				messages: [
					{ role: "user", content: [{ type: "text", text: "hello" }] },
				],
			}),
		);
		const continueFn = vi.fn().mockResolvedValue(
			createResult({
				text: "steered",
				messages: [
					{ role: "user", content: [{ type: "text", text: "hello" }] },
					{
						role: "assistant",
						content: [{ type: "text", text: "steered" }],
					},
				],
			}),
		);
		const agent = {
			run,
			continue: continueFn,
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi
				.fn()
				.mockReturnValue([
					{ role: "user", content: [{ type: "text", text: "hello" }] },
				]),
			canStartRun: vi.fn().mockReturnValue(true),
		};

		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				prompt: "hello",
				interactive: true,
			}),
		);

		const harness = createPluginEventHarness(manager);
		await harness.handlePluginEvent(sessionId, {
			name: "steer_message",
			payload: { prompt: "async result" },
		});
		await vi.waitFor(() => {
			expect(continueFn).toHaveBeenCalledTimes(2);
		});
		expect(continueFn).toHaveBeenLastCalledWith(
			'<user_input mode="act">async result</user_input>',
			undefined,
			undefined,
		);
	});

	it("promotes queued prompts to the front when they become steer", async () => {
		const sessionId = "sess-steer-priority";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
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
		const updateConnectionDefaults = vi.fn();
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				delegatedAgentConfigProvider: {
					getRuntimeConfig: vi.fn(),
					getConnectionConfig: vi.fn(),
					updateConnectionDefaults,
				},
				shutdown: vi.fn(),
			}),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue([]),
			canStartRun: vi.fn().mockReturnValue(false),
		};

		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				prompt: "hello",
				interactive: true,
			}),
		);

		const harness = createPluginEventHarness(manager);

		await harness.handlePluginEvent(sessionId, {
			name: "queue_message",
			payload: { prompt: "queued first" },
		});
		await harness.handlePluginEvent(sessionId, {
			name: "queue_message",
			payload: { prompt: "queued second" },
		});
		await harness.handlePluginEvent(sessionId, {
			name: "steer_message",
			payload: { prompt: "queued first" },
		});

		expect(harness.getPendingPrompts(sessionId)).toEqual([
			{ prompt: "queued first", delivery: "steer" },
			{ prompt: "queued second", delivery: "queue" },
		]);
	});

	it("wraps consumed steer prompts as mode-scoped user input", async () => {
		const sessionId = "sess-steer-format";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
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
		const telemetry = new TelemetryService();
		let agentConfig: AgentConfig | undefined;
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(false),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			restore: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue([]),
			messages: [],
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			telemetry,
			createAgent: (config) => {
				agentConfig = config;
				return agent as never;
			},
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId, mode: "act" }),
				interactive: true,
			}),
		);
		await expect(
			manager.runTurn({
				sessionId,
				prompt: "steer this",
				mode: "plan",
				delivery: "steer",
			}),
		).resolves.toBeUndefined();

		const consumed = await Promise.resolve(
			agentConfig?.consumePendingUserMessage?.(),
		);
		expect(consumed).toBe('<user_input mode="plan">steer this</user_input>');
		expect(agentConfig?.telemetry).toBe(telemetry);
	});

	it("preserves pending prompts through an interactive abort and drains them in order", async () => {
		const sessionId = "sess-abort-preserves-prompts";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
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
		let activeRun = false;
		let rejectRun: ((error: Error) => void) | undefined;
		let markRunStarted: (() => void) | undefined;
		const runStarted = new Promise<void>((resolve) => {
			markRunStarted = resolve;
		});
		const drainedPrompts: string[] = [];
		const run = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise<AgentResult>((_resolve, reject) => {
						activeRun = true;
						rejectRun = (error) => {
							activeRun = false;
							reject(error);
						};
						markRunStarted?.();
					}),
			)
			.mockImplementation((prompt: string) => {
				drainedPrompts.push(prompt);
				return Promise.resolve(createResult({ text: "queued result" }));
			});
		const continueTurn = vi.fn().mockImplementation((prompt: string) => {
			drainedPrompts.push(prompt);
			return Promise.resolve(createResult());
		});
		const agent = {
			run,
			continue: continueTurn,
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue([]),
			canStartRun: vi.fn(() => !activeRun),
		};
		agent.abort.mockImplementation(() => {
			rejectRun?.(new Error("user cancelled"));
		});

		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);

		const events: unknown[] = [];
		manager.subscribe((event) => events.push(event));
		const firstTurn = manager.runTurn({ sessionId, prompt: "slow" });
		await runStarted;
		await manager.runTurn({
			sessionId,
			prompt: "queued prompt",
			delivery: "queue",
		});
		await manager.runTurn({
			sessionId,
			prompt: "steered prompt",
			delivery: "steer",
		});
		expect(
			(await manager.pendingPrompts.list({ sessionId })).map((prompt) => ({
				prompt: prompt.prompt,
				delivery: prompt.delivery,
			})),
		).toEqual([
			{ prompt: "steered prompt", delivery: "steer" },
			{ prompt: "queued prompt", delivery: "queue" },
		]);

		await manager.abort(sessionId, new Error("test abort"));
		expect(agent.abort).toHaveBeenCalledTimes(1);
		await expect(firstTurn).resolves.toMatchObject({
			finishReason: "aborted",
		});
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "agent_event",
				payload: expect.objectContaining({
					event: expect.objectContaining({
						type: "done",
						reason: "aborted",
					}),
				}),
			}),
		);
		// The abort must not eat the prompts the user queued: they drain once
		// the abort settles, steered prompt first.
		await vi.waitFor(async () => {
			expect(drainedPrompts).toEqual([
				'<user_input mode="act">steered prompt</user_input>',
				'<user_input mode="act">queued prompt</user_input>',
			]);
			expect(await manager.pendingPrompts.list({ sessionId })).toEqual([]);
		});
	});

	it("propagates a parent session abort to its team runtime", async () => {
		const sessionId = "sess-team-abort";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
				messagesPath: "/tmp/messages.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const makeTeamRun = (
			id: string,
			status: TeamRunRecord["status"],
		): TeamRunRecord => ({
			id,
			agentId: "teammate-1",
			status,
			message: `${id} task`,
			priority: 0,
			retryCount: 0,
			maxRetries: 0,
			startedAt: new Date(),
		});
		const queuedRun = makeTeamRun("run_queued", "queued");
		const runningRun = makeTeamRun("run_running", "running");
		let onTeamEvent: ((event: TeamEvent) => void) | undefined;
		const cancelOutstandingWork = vi.fn(() => {
			onTeamEvent?.({
				type: TeamMessageType.RunCancelled,
				run: { ...queuedRun, status: "cancelled" },
				reason: "user cancelled",
			});
			onTeamEvent?.({
				type: TeamMessageType.RunCancelled,
				run: { ...runningRun, status: "cancelled" },
				reason: "user cancelled",
			});
		});
		const runtimeBuilder = {
			build: vi
				.fn()
				.mockImplementation((input: { onTeamEvent?: typeof onTeamEvent }) => {
					onTeamEvent = input.onTeamEvent;
					return {
						tools: [],
						teamRuntime: {
							getTeamId: vi.fn().mockReturnValue("team_test-team"),
							getTeamName: vi.fn().mockReturnValue("test-team"),
							exportState: vi.fn().mockReturnValue({
								teamId: "team_test-team",
								teamName: "test-team",
								members: [],
								tasks: [],
								mailbox: [],
								missionLog: [],
								runs: [],
								outcomes: [],
								outcomeFragments: [],
							}),
							cancelOutstandingWork,
						},
						shutdown: vi.fn(),
					};
				}),
		};
		let rejectRun: ((error: Error) => void) | undefined;
		let markRunStarted: (() => void) | undefined;
		const runStarted = new Promise<void>((resolve) => {
			markRunStarted = resolve;
		});
		const agent = {
			run: vi.fn(
				() =>
					new Promise<AgentResult>((_resolve, reject) => {
						rejectRun = reject;
						markRunStarted?.();
					}),
			),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			abort: vi.fn(() => rejectRun?.(new Error("user cancelled"))),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		});

		try {
			await manager.startSession(
				normalizeStartInput({
					config: createConfig({ sessionId }),
					interactive: true,
				}),
			);
			onTeamEvent?.({ type: TeamMessageType.RunQueued, run: queuedRun });
			onTeamEvent?.({ type: TeamMessageType.RunStarted, run: runningRun });
			const rootTurn = manager.runTurn({ sessionId, prompt: "keep working" });
			await runStarted;

			const abortReason = new Error("user cancelled");
			await manager.abort(sessionId, abortReason);
			await expect(rootTurn).resolves.toMatchObject({
				finishReason: "aborted",
			});

			expect(cancelOutstandingWork).toHaveBeenCalledOnce();
			expect(cancelOutstandingWork).toHaveBeenCalledWith(abortReason);
			expect(agent.abort).toHaveBeenCalledOnce();

			const getSession = Reflect.get(
				manager as object,
				"getSessionOrThrow",
			) as (sessionId: string) => {
				aborting: boolean;
				status: string;
				activeTeamRunIds: Set<string>;
				pendingTeamRunUpdates: unknown[];
			};
			const activeSession = Reflect.apply(getSession, manager, [sessionId]);
			expect(activeSession.aborting).toBe(false);
			expect(activeSession.status).toBe("idle");
			expect(activeSession.activeTeamRunIds.size).toBe(0);
			expect(activeSession.pendingTeamRunUpdates).toEqual([]);
		} finally {
			await manager.dispose();
		}
	});

	it("drains queued prompts after a turn that self-aborts (loop detector / mistake limit)", async () => {
		const sessionId = "sess-self-abort-drains-prompts";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
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
		let activeRun = false;
		let finishRun: (() => void) | undefined;
		let markRunStarted: (() => void) | undefined;
		const runStarted = new Promise<void>((resolve) => {
			markRunStarted = resolve;
		});
		const sentPrompts: string[] = [];
		const run = vi.fn().mockImplementation((prompt: string) => {
			sentPrompts.push(prompt);
			activeRun = true;
			markRunStarted?.();
			return new Promise<AgentResult>((resolve) => {
				// The run resolves with finishReason "aborted" without
				// manager.abort() ever being called — this is how an internal
				// safety stop (loop detector / mistake limit) ends a run.
				finishRun = () => {
					activeRun = false;
					resolve(createResult({ finishReason: "aborted" }));
				};
			});
		});
		const continueTurn = vi.fn().mockImplementation((prompt: string) => {
			sentPrompts.push(prompt);
			return Promise.resolve(createResult({ text: "drained result" }));
		});
		const agent = {
			run,
			continue: continueTurn,
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue([]),
			canStartRun: vi.fn(() => !activeRun),
		};

		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);

		const firstTurn = manager.runTurn({ sessionId, prompt: "slow" });
		await runStarted;
		await manager.runTurn({
			sessionId,
			prompt: "queued prompt",
			delivery: "queue",
		});
		expect(
			(await manager.pendingPrompts.list({ sessionId })).map((prompt) => ({
				prompt: prompt.prompt,
				delivery: prompt.delivery,
			})),
		).toEqual([{ prompt: "queued prompt", delivery: "queue" }]);

		finishRun?.();
		await expect(firstTurn).resolves.toMatchObject({
			finishReason: "aborted",
		});

		await vi.waitFor(async () => {
			expect(sentPrompts.slice(1)).toEqual([
				'<user_input mode="act">queued prompt</user_input>',
			]);
			expect(await manager.pendingPrompts.list({ sessionId })).toEqual([]);
		});
	});

	it("keeps queued prompts through a user-initiated abort and drains them after it settles", async () => {
		const sessionId = "sess-user-abort-keeps-prompts";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
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
		let activeRun = false;
		let rejectRun: ((error: Error) => void) | undefined;
		let markRunStarted: (() => void) | undefined;
		const runStarted = new Promise<void>((resolve) => {
			markRunStarted = resolve;
		});
		const sentPrompts: string[] = [];
		const run = vi.fn().mockImplementation((prompt: string) => {
			sentPrompts.push(prompt);
			activeRun = true;
			markRunStarted?.();
			return new Promise<AgentResult>((_resolve, reject) => {
				rejectRun = (error: Error) => {
					activeRun = false;
					reject(error);
				};
			});
		});
		const continueTurn = vi.fn().mockImplementation((prompt: string) => {
			sentPrompts.push(prompt);
			return Promise.resolve(createResult({ text: "drained result" }));
		});
		const agent = {
			run,
			continue: continueTurn,
			// A user abort tears the in-flight stream down, which surfaces to
			// runTurn() as a rejection — the completeAbortedInteractiveTurn path.
			abort: vi.fn().mockImplementation(() => {
				rejectRun?.(new Error("aborted by user"));
			}),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue([]),
			canStartRun: vi.fn(() => !activeRun),
		};

		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);

		const firstTurn = manager.runTurn({ sessionId, prompt: "slow" });
		await runStarted;
		await manager.runTurn({
			sessionId,
			prompt: "queued survivor",
			delivery: "queue",
		});
		expect(
			(await manager.pendingPrompts.list({ sessionId })).map((prompt) => ({
				prompt: prompt.prompt,
				delivery: prompt.delivery,
			})),
		).toEqual([{ prompt: "queued survivor", delivery: "queue" }]);

		await manager.abort(sessionId);
		await expect(firstTurn).resolves.toMatchObject({
			finishReason: "aborted",
		});

		// The queued prompt must survive the abort and run once it settles —
		// aborting only stops the in-flight turn, it must never eat input the
		// user already typed and queued.
		await vi.waitFor(async () => {
			expect(sentPrompts.slice(1)).toEqual([
				'<user_input mode="act">queued survivor</user_input>',
			]);
			expect(await manager.pendingPrompts.list({ sessionId })).toEqual([]);
		});
	});

	it("clears the remaining queue when a queue-initiated turn is aborted", async () => {
		const sessionId = "sess-second-abort-clears-queue";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
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
		let activeRun = false;
		const sentPrompts: string[] = [];
		const rejectors: Array<(error: Error) => void> = [];
		// Every run hangs until aborted, so each abort targets the turn that
		// is actually in flight (first the user turn, then the drained turn).
		const run = vi.fn().mockImplementation(
			(prompt: string) =>
				new Promise<AgentResult>((_resolve, reject) => {
					sentPrompts.push(prompt);
					activeRun = true;
					rejectors.push((error) => {
						activeRun = false;
						reject(error);
					});
				}),
		);
		const agent = {
			run,
			continue: vi.fn().mockResolvedValue(createResult()),
			abort: vi.fn(() => {
				rejectors.shift()?.(new Error("user cancelled"));
			}),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue([]),
			canStartRun: vi.fn(() => !activeRun),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);

		const firstTurn = manager.runTurn({ sessionId, prompt: "slow" });
		await vi.waitFor(() => {
			expect(run).toHaveBeenCalledTimes(1);
		});
		await manager.runTurn({
			sessionId,
			prompt: "queued one",
			delivery: "queue",
		});
		await manager.runTurn({
			sessionId,
			prompt: "queued two",
			delivery: "queue",
		});

		// First abort: the user-initiated turn stops, the queue survives, and
		// the drain starts running "queued one".
		await manager.abort(sessionId, new Error("first abort"));
		await expect(firstTurn).resolves.toMatchObject({
			finishReason: "aborted",
		});
		await vi.waitFor(() => {
			expect(run).toHaveBeenCalledTimes(2);
		});
		expect(sentPrompts[1]).toContain("queued one");
		expect(
			(await manager.pendingPrompts.list({ sessionId })).map(
				(prompt) => prompt.prompt,
			),
		).toEqual(["queued two"]);

		// Second abort lands on a queue-initiated turn: that means "stop the
		// queued work too" — the remainder is dropped so repeated aborts
		// reliably bring the session to a full stop instead of consuming one
		// queued prompt (and one provider call) per abort.
		await manager.abort(sessionId, new Error("second abort"));
		await vi.waitFor(async () => {
			expect(await manager.pendingPrompts.list({ sessionId })).toEqual([]);
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(run).toHaveBeenCalledTimes(2);
		expect(sentPrompts).toHaveLength(2);
	});

	it("does not drain queued prompts after a turn that finishes with error", async () => {
		const sessionId = "sess-error-holds-prompts";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
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
		let activeRun = false;
		let finishRun: (() => void) | undefined;
		let markRunStarted: (() => void) | undefined;
		const runStarted = new Promise<void>((resolve) => {
			markRunStarted = resolve;
		});
		const sentPrompts: string[] = [];
		const run = vi.fn().mockImplementation((prompt: string) => {
			sentPrompts.push(prompt);
			activeRun = true;
			markRunStarted?.();
			return new Promise<AgentResult>((resolve) => {
				finishRun = () => {
					activeRun = false;
					resolve(createResult({ finishReason: "error" }));
				};
			});
		});
		const continueTurn = vi.fn().mockImplementation((prompt: string) => {
			sentPrompts.push(prompt);
			return Promise.resolve(createResult());
		});
		const agent = {
			run,
			continue: continueTurn,
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue([]),
			canStartRun: vi.fn(() => !activeRun),
		};

		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);

		const firstTurn = manager.runTurn({ sessionId, prompt: "slow" });
		await runStarted;
		await manager.runTurn({
			sessionId,
			prompt: "queued prompt",
			delivery: "queue",
		});

		finishRun?.();
		await expect(firstTurn).resolves.toMatchObject({
			finishReason: "error",
		});

		// Give any (incorrectly) scheduled drain a chance to fire, then
		// assert the queued prompt is still held and was never sent.
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(sentPrompts).toHaveLength(1);
		expect(
			(await manager.pendingPrompts.list({ sessionId })).map((prompt) => ({
				prompt: prompt.prompt,
				delivery: prompt.delivery,
			})),
		).toEqual([{ prompt: "queued prompt", delivery: "queue" }]);
	});

	it("stops draining when a drained prompt's turn finishes with error", async () => {
		const sessionId = "sess-drain-stops-on-error";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
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
		let activeRun = false;
		let finishRun: (() => void) | undefined;
		let markRunStarted: (() => void) | undefined;
		const runStarted = new Promise<void>((resolve) => {
			markRunStarted = resolve;
		});
		const sentPrompts: string[] = [];
		const run = vi.fn().mockImplementation((prompt: string) => {
			sentPrompts.push(prompt);
			activeRun = true;
			markRunStarted?.();
			return new Promise<AgentResult>((resolve) => {
				finishRun = () => {
					activeRun = false;
					resolve(createResult());
				};
			});
		});
		// The drained prompt's turn resolves with an error finish; the
		// remaining queued prompt must be held instead of drained next.
		const continueTurn = vi.fn().mockImplementation((prompt: string) => {
			sentPrompts.push(prompt);
			return Promise.resolve(createResult({ finishReason: "error" }));
		});
		const agent = {
			run,
			continue: continueTurn,
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue([]),
			canStartRun: vi.fn(() => !activeRun),
		};

		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);

		const firstTurn = manager.runTurn({ sessionId, prompt: "slow" });
		await runStarted;
		await manager.runTurn({
			sessionId,
			prompt: "first queued",
			delivery: "queue",
		});
		await manager.runTurn({
			sessionId,
			prompt: "second queued",
			delivery: "queue",
		});

		finishRun?.();
		await expect(firstTurn).resolves.toMatchObject({
			finishReason: "completed",
		});

		// The first queued prompt drains and errors; the second must be held.
		await vi.waitFor(() => {
			expect(sentPrompts).toHaveLength(2);
			expect(sentPrompts[1]).toContain("first queued");
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(sentPrompts).toHaveLength(2);
		expect(
			(await manager.pendingPrompts.list({ sessionId })).map((prompt) => ({
				prompt: prompt.prompt,
				delivery: prompt.delivery,
			})),
		).toEqual([{ prompt: "second queued", delivery: "queue" }]);
	});

	it("starts interactive sessions without a prompt as idle until their first turn", async () => {
		const sessionId = "sess-idle-until-first-turn";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
				messagesPath: "/tmp/messages.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({ tools: [], shutdown: vi.fn() }),
		};
		const agent = {
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn().mockResolvedValue(createResult()),
			getMessages: vi.fn().mockReturnValue([]),
			getAgentId: vi.fn().mockReturnValue("agent-idle-1"),
			getConversationId: vi.fn().mockReturnValue("conv-idle-1"),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			shutdown: vi.fn().mockResolvedValue(undefined),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		});
		const events: unknown[] = [];
		manager.subscribe((event) => events.push(event));

		// The desktop host starts interactive sessions without a prompt and
		// dispatches turns through separate send calls. Reporting such a
		// session as "running" wedged clients that gate workspace operations
		// (e.g. checkpoint restores) on active turns.
		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);

		await expect(manager.getSession(sessionId)).resolves.toMatchObject({
			sessionId,
			status: "idle",
		});
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "status",
				payload: { sessionId, status: "idle" },
			}),
		);
		expect(events).not.toContainEqual(
			expect.objectContaining({
				type: "status",
				payload: { sessionId, status: "running" },
			}),
		);

		// The first turn still transitions through running and back to idle.
		await manager.runTurn({ sessionId, prompt: "first turn" });
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "status",
				payload: { sessionId, status: "running" },
			}),
		);
		await expect(manager.getSession(sessionId)).resolves.toMatchObject({
			sessionId,
			status: "idle",
		});
	});

	it("keeps the same live interactive session usable after aborting before the first response", async () => {
		const sessionId = "sess-abort-then-next-turn";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest.json",
				messagesPath: "/tmp/messages.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtime = { tools: [], shutdown: vi.fn() };
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue(runtime),
		};
		let messages: AgentResult["messages"] = [];
		let activeRun = false;
		let rejectRun: ((error: Error) => void) | undefined;
		let markRunStarted: (() => void) | undefined;
		const runStarted = new Promise<void>((resolve) => {
			markRunStarted = resolve;
		});
		const run = vi.fn(
			() =>
				new Promise<AgentResult>((_resolve, reject) => {
					activeRun = true;
					messages = [{ role: "user", content: "slow" }];
					rejectRun = (error) => {
						activeRun = false;
						reject(error);
					};
					markRunStarted?.();
				}),
		);
		const continueTurn = vi.fn().mockResolvedValue(
			createResult({
				text: "continued after abort",
			}),
		);
		const agent = {
			run,
			continue: continueTurn,
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn(() => messages),
			canStartRun: vi.fn(() => !activeRun),
		};
		agent.abort.mockImplementation(() => {
			rejectRun?.(new Error("user cancelled before first response"));
		});
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);
		const events: unknown[] = [];
		manager.subscribe((event) => events.push(event));

		const firstTurn = manager.runTurn({ sessionId, prompt: "slow" });
		await runStarted;
		await manager.abort(sessionId, new Error("test abort"));
		await expect(firstTurn).resolves.toMatchObject({
			finishReason: "aborted",
		});
		// The aborted turn is flushed to disk immediately: persistence
		// otherwise lags to the next assistant message or turn end, so a hub
		// restart in between would rebuild the session without this exchange.
		expect(sessionService.persistSessionMessages).toHaveBeenCalledWith(
			sessionId,
			[{ role: "user", content: "slow" }],
			"You are a test agent",
		);

		await expect(
			manager.runTurn({ sessionId, prompt: "next turn after abort" }),
		).resolves.toMatchObject({
			finishReason: "completed",
			text: "continued after abort",
		});
		await expect(manager.getSession(sessionId)).resolves.toMatchObject({
			sessionId,
			status: "idle",
		});
		expect(run).toHaveBeenCalledTimes(1);
		expect(continueTurn).toHaveBeenCalledTimes(1);
		expect(agent.shutdown).not.toHaveBeenCalled();
		expect(runtime.shutdown).not.toHaveBeenCalled();
		// Interactive sessions now start idle (no turn runs inside start), so
		// each turn records its own running → idle transition.
		expect(sessionService.updateSessionStatus).toHaveBeenNthCalledWith(
			1,
			sessionId,
			"running",
			null,
		);
		expect(sessionService.updateSessionStatus).toHaveBeenNthCalledWith(
			2,
			sessionId,
			"idle",
			null,
		);
		expect(sessionService.updateSessionStatus).toHaveBeenNthCalledWith(
			3,
			sessionId,
			"running",
			null,
		);
		expect(sessionService.updateSessionStatus).toHaveBeenNthCalledWith(
			4,
			sessionId,
			"idle",
			null,
		);
		expect(events).not.toContainEqual(
			expect.objectContaining({
				type: "ended",
				payload: expect.objectContaining({ sessionId, reason: "aborted" }),
			}),
		);
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
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			shutdown: vi.fn().mockResolvedValue(undefined),
			restore: vi.fn(),
			getMessages: vi.fn().mockReturnValue([]),
			messages: [],
		};
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-meta-multi.json",
				messagesPath: "/tmp/messages-meta-multi.json",
				manifest,
			}),
			persistSessionMessages,
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({
					sessionId,
					providerId: "anthropic",
					modelId: "claude-sonnet-4-6",
				}),
				interactive: true,
			}),
		);

		await manager.runTurn({ sessionId, prompt: "hello" });
		await manager.runTurn({ sessionId, prompt: "again" });

		const persisted = persistSessionMessages.mock.calls[1]?.[1];
		expect(persisted?.[1]).toMatchObject({
			role: "assistant",
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
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run: vi.fn().mockRejectedValue(new Error("boom")),
					continue: vi.fn(),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
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
			manager.startSession(
				normalizeStartInput({
					config: createConfig({ sessionId }),
					prompt: "hello",
					interactive: false,
				}),
			),
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

	it("does not synthesize assistant usage metadata when a turn fails before assistant output", async () => {
		const sessionId = "sess-failed-before-assistant";
		const manifest = createManifest(sessionId);
		const persistSessionMessages = vi.fn();
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-failed-before-assistant.json",
				messagesPath: "/tmp/messages-failed-before-assistant.json",
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
		const userOnlyMessages = [
			{ role: "user", content: [{ type: "text", text: "hello" }] },
		];
		const manager = new RuntimeHostUnderTest({
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
						.mockReturnValue(userOnlyMessages),
					subscribeEvents: vi.fn(),
					getAgentId: vi.fn().mockReturnValue("agent-test"),
					getConversationId: vi.fn().mockReturnValue("conv-test"),
					messages: [],
				}) as never,
		});

		await expect(
			manager.startSession(
				normalizeStartInput({
					config: createConfig({ sessionId }),
					prompt: "hello",
					interactive: false,
				}),
			),
		).rejects.toThrow("boom");

		expect(persistSessionMessages).toHaveBeenCalledTimes(1);
		expect(persistSessionMessages).toHaveBeenCalledWith(
			sessionId,
			userOnlyMessages,
			"You are a test agent",
		);
		const persisted = persistSessionMessages.mock.calls[0]?.[1] as Array<{
			role?: string;
			metrics?: unknown;
			modelInfo?: unknown;
		}>;
		expect(persisted).toHaveLength(1);
		expect(persisted[0]?.role).toBe("user");
		expect(persisted[0]).not.toHaveProperty("metrics");
		expect(persisted[0]).not.toHaveProperty("modelInfo");
	});

	it("uses run for first send then continue for subsequent sends", async () => {
		const sessionId = "sess-2";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-2.json",
				messagesPath: "/tmp/messages-2.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			updateSession: vi.fn().mockResolvedValue({ updated: true }),
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
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: continueFn,
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);
		const first = await manager.runTurn({ sessionId, prompt: "first" });
		const second = await manager.runTurn({
			sessionId,
			prompt: "second",
			mode: "plan",
		});

		expect(first?.text).toBe("first");
		expect(second?.text).toBe("second");
		expect(run).toHaveBeenCalledTimes(1);
		expect(continueFn).toHaveBeenCalledTimes(1);
		expect(run).toHaveBeenCalledWith(
			'<user_input mode="act">first</user_input>',
			undefined,
			undefined,
		);
		expect(continueFn).toHaveBeenCalledWith(
			'<user_input mode="plan">second</user_input>',
			undefined,
			undefined,
		);
		expect(sessionService.persistSessionMessages).toHaveBeenCalledTimes(2);
	});

	it("keeps an interactive session reusable when abort makes the run reject", async () => {
		const sessionId = "sess-interactive-abort-reject";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-abort-reject.json",
				messagesPath: "/tmp/messages-abort-reject.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			updateSession: vi.fn().mockResolvedValue({ updated: true }),
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
		let rejectRun: ((error: Error) => void) | undefined;
		let markRunStarted: (() => void) | undefined;
		const runStarted = new Promise<void>((resolve) => {
			markRunStarted = resolve;
		});
		const run = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise<AgentResult>((_resolve, reject) => {
						rejectRun = reject;
						markRunStarted?.();
					}),
			)
			.mockResolvedValueOnce(createResult({ text: "second" }));
		const agent = {
			run,
			continue: vi.fn(),
			abort: vi.fn(() => {
				rejectRun?.(new Error("user cancelled"));
			}),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue([]),
			messages: [],
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () => agent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);
		const firstTurn = manager.runTurn({ sessionId, prompt: "slow" });
		await runStarted;
		await manager.abort(sessionId, new Error("user cancelled"));

		await expect(firstTurn).resolves.toMatchObject({
			finishReason: "aborted",
		});
		await expect(
			manager.runTurn({ sessionId, prompt: "again" }),
		).resolves.toMatchObject({
			text: "second",
			finishReason: "completed",
		});
		expect(run).toHaveBeenCalledTimes(2);
		expect(agent.shutdown).not.toHaveBeenCalled();
	});

	it("tracks accumulated usage per session across turns", async () => {
		const sessionId = "sess-usage";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-usage.json",
				messagesPath: "/tmp/messages-usage.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			updateSession: vi.fn().mockResolvedValue({ updated: true }),
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
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: continueFn,
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);

		await manager.runTurn({ sessionId, prompt: "first" });
		expect((await manager.getAccumulatedUsage(sessionId))?.usage).toEqual({
			inputTokens: 10,
			outputTokens: 3,
			cacheReadTokens: 1,
			cacheWriteTokens: 2,
			totalCost: 0.11,
		});

		await manager.runTurn({ sessionId, prompt: "second" });
		expect((await manager.getAccumulatedUsage(sessionId))?.usage).toEqual({
			inputTokens: 18,
			outputTokens: 7,
			cacheReadTokens: 3,
			cacheWriteTokens: 2,
			totalCost: 0.2,
		});
	});

	it("resumes saved interactive sessions without rewriting metadata or timestamps and seeds usage", async () => {
		const sessionId = "sess-resume-readonly";
		const sessionsDir = join(isolatedHomeDir, "sessions");
		const sessionDir = join(sessionsDir, sessionId);
		const messagesPath = join(sessionDir, `${sessionId}.messages.json`);
		mkdirSync(sessionDir, { recursive: true });
		writeFileSync(
			join(sessionDir, "investigator__resume.messages.json"),
			`${JSON.stringify({
				version: 1,
				messages: [
					{
						role: "assistant",
						content: "teammate answer",
						metrics: {
							inputTokens: 7,
							outputTokens: 5,
							cacheReadTokens: 2,
							cacheWriteTokens: 1,
							cost: 0.12,
						},
					},
				],
			})}\n`,
			"utf8",
		);
		const manifest = {
			...createManifest(sessionId),
			status: "completed" as const,
			ended_at: "2026-01-01T00:03:00.000Z",
			metadata: {
				title: "saved title",
				totalCost: 0.25,
				aggregatedAgentsCost: 0.37,
				checkpoint: {
					latest: { ref: "checkpoint-1", createdAt: 1, runCount: 1 },
					history: [{ ref: "checkpoint-1", createdAt: 1, runCount: 1 }],
				},
			},
			messages_path: messagesPath,
		};
		const initialMessages: MessageWithMetadata[] = [
			{ role: "user", content: "first prompt" },
			{
				role: "assistant",
				content: "first answer",
				metrics: {
					inputTokens: 11,
					outputTokens: 7,
					cacheReadTokens: 3,
					cacheWriteTokens: 2,
					cost: 0.25,
				},
			},
		];
		const createRootSessionWithArtifacts = vi.fn();
		const persistSessionMessages = vi.fn();
		const updateSessionStatus = vi.fn().mockResolvedValue({
			updated: true,
			endedAt: "2026-01-01T00:04:00.000Z",
		});
		const updateSession = vi.fn().mockResolvedValue({ updated: true });
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue(sessionsDir),
			readSessionManifest: vi.fn().mockReturnValue(manifest),
			createRootSessionWithArtifacts,
			persistSessionMessages,
			updateSessionStatus,
			updateSession,
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const continueFn = vi.fn().mockResolvedValue(
			createResult({
				usage: {
					inputTokens: 5,
					outputTokens: 4,
					totalCost: 0.1,
				},
				messages: [
					...initialMessages,
					{ role: "user", content: "second prompt" },
					{ role: "assistant", content: "second answer" },
				],
			}),
		);
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				registerLeadAgent: vi.fn(),
				shutdown: vi.fn(),
			}),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run: vi.fn(),
					continue: continueFn,
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue(initialMessages),
					messages: initialMessages,
				}) as never,
		});

		const pathlessConfig = {
			...createConfig({ sessionId }),
			cwd: undefined,
		};
		await manager.startSession({
			config: pathlessConfig,
			interactive: true,
			initialMessages,
			sessionMetadata: {
				title: "updated title",
				modelId: "anthropic/claude-haiku-4.5",
			},
		});

		expect(createRootSessionWithArtifacts).not.toHaveBeenCalled();
		expect(runtimeBuilder.build).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					cwd: manifest.cwd,
					workspaceRoot: manifest.workspace_root,
				}),
			}),
		);
		expect(persistSessionMessages).not.toHaveBeenCalled();
		expect(updateSessionStatus).not.toHaveBeenCalled();
		expect(updateSession).not.toHaveBeenCalled();
		expect((await manager.getSession(sessionId))?.metadata).toEqual(
			expect.objectContaining({
				title: "updated title",
				modelId: "anthropic/claude-haiku-4.5",
				checkpoint: manifest.metadata.checkpoint,
			}),
		);
		expect((await manager.getAccumulatedUsage(sessionId))?.usage).toEqual({
			inputTokens: 11,
			outputTokens: 7,
			cacheReadTokens: 3,
			cacheWriteTokens: 2,
			totalCost: 0.25,
		});
		expect(
			(await manager.getAccumulatedUsage(sessionId))?.aggregateUsage,
		).toEqual({
			inputTokens: 18,
			outputTokens: 12,
			cacheReadTokens: 5,
			cacheWriteTokens: 3,
			totalCost: 0.37,
		});

		await manager.runTurn({ sessionId, prompt: "second prompt" });

		expect(createRootSessionWithArtifacts).not.toHaveBeenCalled();
		expect(updateSessionStatus).toHaveBeenNthCalledWith(
			1,
			sessionId,
			"running",
			null,
		);
		expect(updateSessionStatus).toHaveBeenNthCalledWith(
			2,
			sessionId,
			"idle",
			null,
		);
		expect(updateSessionStatus).toHaveBeenCalledTimes(2);
		const persistedMetadata = updateSession.mock.calls[0]?.[0]
			.metadata as Record<string, unknown>;
		expect(persistedMetadata.title).toBe("saved title");
		expect(persistedMetadata.totalCost as number).toBeCloseTo(0.35);
		expect(persistedMetadata.aggregatedAgentsCost as number).toBeCloseTo(0.47);
		const persistedUsage = persistedMetadata.usage as Record<string, unknown>;
		const persistedAggregateUsage = persistedMetadata.aggregateUsage as Record<
			string,
			unknown
		>;
		expect(persistedUsage).toMatchObject({
			inputTokens: 16,
			outputTokens: 11,
			cacheReadTokens: 3,
			cacheWriteTokens: 2,
		});
		expect(persistedUsage.totalCost as number).toBeCloseTo(0.35);
		expect(persistedAggregateUsage).toMatchObject({
			inputTokens: 23,
			outputTokens: 16,
			cacheReadTokens: 5,
			cacheWriteTokens: 3,
		});
		expect(persistedAggregateUsage.totalCost as number).toBeCloseTo(0.47);
		expect((await manager.getAccumulatedUsage(sessionId))?.usage).toEqual({
			inputTokens: 16,
			outputTokens: 11,
			cacheReadTokens: 3,
			cacheWriteTokens: 2,
			totalCost: 0.35,
		});
		expect(
			(await manager.getAccumulatedUsage(sessionId))?.aggregateUsage,
		).toEqual({
			inputTokens: 23,
			outputTokens: 16,
			cacheReadTokens: 5,
			cacheWriteTokens: 3,
			totalCost: 0.47,
		});
	});

	it("restores full persisted aggregate usage when child message artifacts are missing", async () => {
		const sessionId = "sess-resume-aggregate-metadata";
		const sessionsDir = join(isolatedHomeDir, "sessions");
		const sessionDir = join(sessionsDir, sessionId);
		const messagesPath = join(sessionDir, `${sessionId}.messages.json`);
		mkdirSync(sessionDir, { recursive: true });
		const aggregateUsage = {
			inputTokens: 18,
			outputTokens: 12,
			cacheReadTokens: 5,
			cacheWriteTokens: 3,
			totalCost: 0.37,
		};
		const manifest = {
			...createManifest(sessionId),
			status: "completed" as const,
			ended_at: "2026-01-01T00:03:00.000Z",
			metadata: {
				title: "saved title",
				totalCost: 0.25,
				aggregatedAgentsCost: 0.37,
				aggregateUsage,
			},
			messages_path: messagesPath,
		};
		const initialMessages: MessageWithMetadata[] = [
			{ role: "user", content: "first prompt" },
			{
				role: "assistant",
				content: "first answer",
				metrics: {
					inputTokens: 11,
					outputTokens: 7,
					cacheReadTokens: 3,
					cacheWriteTokens: 2,
					cost: 0.25,
				},
			},
		];
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue(sessionsDir),
			readSessionManifest: vi.fn().mockReturnValue(manifest),
			createRootSessionWithArtifacts: vi.fn(),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn(),
			updateSession: vi.fn(),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: {
				build: vi.fn().mockReturnValue({
					tools: [],
					registerLeadAgent: vi.fn(),
					shutdown: vi.fn(),
				}),
			},
			createAgent: () =>
				({
					run: vi.fn(),
					continue: vi.fn(),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue(initialMessages),
					messages: initialMessages,
				}) as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
				initialMessages,
			}),
		);

		expect(
			(await manager.getAccumulatedUsage(sessionId))?.aggregateUsage,
		).toEqual(aggregateUsage);
	});

	it("aggregates teammate usage without double-counting lead usage events", async () => {
		const sessionId = "sess-team-usage";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-team-usage.json",
				messagesPath: "/tmp/messages-team-usage.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			updateSession: vi.fn().mockResolvedValue({ updated: true }),
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
		let onAgentEvent: ((event: AgentEvent) => void) | undefined;
		const run = vi.fn().mockImplementation(async () => {
			onAgentEvent?.({
				type: "usage",
				inputTokens: 10,
				outputTokens: 3,
				cacheReadTokens: 1,
				cacheWriteTokens: 2,
				cost: 0.11,
				totalInputTokens: 10,
				totalOutputTokens: 3,
				totalCacheReadTokens: 1,
				totalCacheWriteTokens: 2,
				totalCost: 0.11,
			});
			onTeamEvent?.({
				type: "agent_event",
				agentId: "investigator",
				event: {
					type: "usage",
					agentId: "agent-teammate-1",
					conversationId: "conv-teammate-1",
					inputTokens: 7,
					outputTokens: 5,
					cacheReadTokens: 2,
					cacheWriteTokens: 1,
					cost: 0.12,
					totalInputTokens: 7,
					totalOutputTokens: 5,
					totalCacheReadTokens: 2,
					totalCacheWriteTokens: 1,
					totalCost: 0.12,
				},
			});
			return createResult({
				text: "lead scheduled teammate",
				usage: {
					inputTokens: 10,
					outputTokens: 3,
					cacheReadTokens: 1,
					cacheWriteTokens: 2,
					totalCost: 0.11,
				},
			});
		});
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: vi.fn(),
					abort: vi.fn(),
					subscribeEvents: vi.fn((listener: (event: AgentEvent) => void) => {
						onAgentEvent = listener;
						return () => {};
					}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);

		await manager.runTurn({ sessionId, prompt: "run teammate work" });

		const usageSummary = await manager.getAccumulatedUsage(sessionId);
		const usage = usageSummary?.usage;
		expect(usage).toMatchObject({
			inputTokens: 10,
			outputTokens: 3,
			cacheReadTokens: 1,
			cacheWriteTokens: 2,
		});
		expect(usage?.totalCost).toBeCloseTo(0.11);
		const aggregateUsage = usageSummary?.aggregateUsage;
		expect(aggregateUsage).toMatchObject({
			inputTokens: 17,
			outputTokens: 8,
			cacheReadTokens: 3,
			cacheWriteTokens: 3,
		});
		expect(aggregateUsage?.totalCost).toBeCloseTo(0.23);
		const persistedMetadata = sessionService.updateSession.mock.calls[0]?.[0]
			.metadata as Record<string, unknown>;
		expect(persistedMetadata.totalCost as number).toBeCloseTo(0.11);
		expect(persistedMetadata.aggregatedAgentsCost as number).toBeCloseTo(0.23);
		const persistedUsage = persistedMetadata.usage as Record<string, unknown>;
		const persistedAggregateUsage = persistedMetadata.aggregateUsage as Record<
			string,
			unknown
		>;
		expect(persistedUsage).toMatchObject({
			inputTokens: 10,
			outputTokens: 3,
			cacheReadTokens: 1,
			cacheWriteTokens: 2,
		});
		expect(persistedUsage.totalCost as number).toBeCloseTo(0.11);
		expect(persistedAggregateUsage).toMatchObject({
			inputTokens: 17,
			outputTokens: 8,
			cacheReadTokens: 3,
			cacheWriteTokens: 3,
		});
		expect(persistedAggregateUsage.totalCost as number).toBeCloseTo(0.23);
	});

	it("queues sends with explicit queue or steer delivery and emits snapshots", async () => {
		const sessionId = "sess-delivery-queue";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-queue.json",
				messagesPath: "/tmp/messages-queue.json",
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
		let canStartRun = false;
		const run = vi.fn().mockResolvedValue(createResult({ text: "first" }));
		const continueFn = vi
			.fn()
			.mockResolvedValue(createResult({ text: "next" }));
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: continueFn,
					canStartRun: vi.fn(() => canStartRun),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});
		const events: Array<unknown> = [];
		manager.subscribe((event) => {
			events.push(event);
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);

		await expect(
			manager.runTurn({ sessionId, prompt: "queued first", delivery: "queue" }),
		).resolves.toBeUndefined();
		await expect(
			manager.runTurn({
				sessionId,
				prompt: "queued second",
				delivery: "steer",
			}),
		).resolves.toBeUndefined();

		expect(run).not.toHaveBeenCalled();
		expect(continueFn).not.toHaveBeenCalled();
		const promptSnapshots = events
			.filter((event) => {
				return (
					typeof event === "object" &&
					event !== null &&
					"type" in event &&
					event.type === "pending_prompts"
				);
			})
			.map((event) => (event as { payload: { prompts: unknown[] } }).payload);
		expect(promptSnapshots.at(-1)).toEqual({
			prompts: [
				expect.objectContaining({
					prompt: "queued second",
					delivery: "steer",
					attachmentCount: 0,
				}),
				expect.objectContaining({
					prompt: "queued first",
					delivery: "queue",
					attachmentCount: 0,
				}),
			],
			sessionId,
		});

		canStartRun = true;
		await manager.runTurn({ sessionId, prompt: "run now" });
		expect(run).toHaveBeenCalledTimes(1);
		expect(
			events.some((event) => {
				return (
					typeof event === "object" &&
					event !== null &&
					"type" in event &&
					event.type === "pending_prompt_submitted" &&
					"payload" in event &&
					(event.payload as { prompt?: string }).prompt === "queued second"
				);
			}),
		).toBe(true);
	});

	it("emits canonical session snapshots for local lifecycle updates", async () => {
		const sessionId = "sess-local-snapshot";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-snapshot.json",
				messagesPath: "/tmp/messages-snapshot.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({
				updated: true,
				endedAt: "2026-01-01T00:00:01.000Z",
			}),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
			readSessionManifest: vi.fn().mockResolvedValue(manifest),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({ tools: [], shutdown: vi.fn() }),
		};
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run: vi.fn().mockResolvedValue(
						createResult({
							messages: [
								{ role: "user", content: "hello" },
								{ role: "assistant", content: "ok" },
							],
							usage: {
								inputTokens: 3,
								outputTokens: 4,
								cacheReadTokens: 1,
								cacheWriteTokens: 2,
								totalCost: 0.12,
							},
						}),
					),
					continue: vi.fn(),
					canStartRun: vi.fn(() => true),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});
		const events: Array<unknown> = [];
		manager.subscribe((event) => events.push(event));

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				prompt: "hello",
			}),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		const snapshotEvent = events
			.filter(
				(event) =>
					typeof event === "object" &&
					event !== null &&
					"type" in event &&
					event.type === "session_snapshot",
			)
			.at(-1) as { payload: { snapshot: unknown } } | undefined;
		expect(snapshotEvent?.payload.snapshot).toMatchObject({
			version: 1,
			sessionId,
			source: SessionSource.CLI,
			workspace: { cwd: "/tmp/project", root: "/tmp/project" },
			model: { providerId: "mock-provider", modelId: "mock-model" },
			capabilities: {
				enableTools: true,
				enableSpawn: true,
				enableTeams: true,
			},
			lineage: { isSubagent: false },
		});
	});

	it("auto-queues sends to a running interactive session", async () => {
		const sessionId = "sess-auto-queue";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-auto-queue.json",
				messagesPath: "/tmp/messages-auto-queue.json",
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
		let canStartRun = false;
		const run = vi.fn().mockResolvedValue(createResult({ text: "first" }));
		const continueFn = vi
			.fn()
			.mockResolvedValue(createResult({ text: "next" }));
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: continueFn,
					canStartRun: vi.fn(() => canStartRun),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});
		const events: Array<unknown> = [];
		manager.subscribe((event) => {
			events.push(event);
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);

		await expect(
			manager.runTurn({ sessionId, prompt: "queued implicitly" }),
		).resolves.toBeUndefined();

		expect(run).not.toHaveBeenCalled();
		expect(continueFn).not.toHaveBeenCalled();
		const promptSnapshots = events
			.filter((event) => {
				return (
					typeof event === "object" &&
					event !== null &&
					"type" in event &&
					event.type === "pending_prompts"
				);
			})
			.map((event) => (event as { payload: { prompts: unknown[] } }).payload);
		expect(promptSnapshots.at(-1)).toEqual({
			prompts: [
				expect.objectContaining({
					prompt: "queued implicitly",
					delivery: "queue",
					attachmentCount: 0,
				}),
			],
			sessionId,
		});

		canStartRun = true;
		await manager.runTurn({ sessionId, prompt: "run now" });

		expect(run).toHaveBeenCalledTimes(1);
		expect(
			events.some((event) => {
				return (
					typeof event === "object" &&
					event !== null &&
					"type" in event &&
					event.type === "pending_prompt_submitted" &&
					"payload" in event &&
					(event.payload as { prompt?: string; delivery?: string }).prompt ===
						"queued implicitly" &&
					(event.payload as { delivery?: string }).delivery === "queue"
				);
			}),
		).toBe(true);
	});

	it("updates and removes pending prompts by id", async () => {
		const sessionId = "sess-edit-pending-queue";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-edit-queue.json",
				messagesPath: "/tmp/messages-edit-queue.json",
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
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run: vi.fn().mockResolvedValue(createResult({ text: "first" })),
					continue: vi.fn().mockResolvedValue(createResult({ text: "next" })),
					canStartRun: vi.fn(() => false),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});
		const events: Array<unknown> = [];
		manager.subscribe((event) => {
			events.push(event);
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
			}),
		);
		await manager.runTurn({
			sessionId,
			prompt: "queued first",
			delivery: "queue",
		});
		await manager.runTurn({
			sessionId,
			prompt: "queued second",
			delivery: "queue",
		});

		const queued = await manager.pendingPrompts.list({ sessionId });
		expect(queued.map((item) => item.prompt)).toEqual([
			"queued first",
			"queued second",
		]);

		const edited = await manager.pendingPrompts.update({
			sessionId,
			promptId: queued[0]?.id,
			prompt: "edited first",
		});
		expect(edited.updated).toBe(true);
		expect(edited.prompts.map((item) => item.prompt)).toEqual([
			"edited first",
			"queued second",
		]);

		const steered = await manager.pendingPrompts.update({
			sessionId,
			promptId: edited.prompts[1]?.id,
			delivery: "steer",
		});
		expect(
			steered.prompts.map(({ prompt, delivery }) => ({ prompt, delivery })),
		).toEqual([
			{ prompt: "queued second", delivery: "steer" },
			{ prompt: "edited first", delivery: "queue" },
		]);

		const removed = await manager.pendingPrompts.delete({
			sessionId,
			promptId: steered.prompts[0]?.id,
		});
		expect(removed.removed).toBe(true);
		expect(removed.prompt?.prompt).toBe("queued second");
		expect(removed.prompts.map((item) => item.prompt)).toEqual([
			"edited first",
		]);
		expect(
			events.some(
				(event) =>
					typeof event === "object" &&
					event !== null &&
					"type" in event &&
					event.type === "pending_prompts",
			),
		).toBe(true);
	});

	it("returns undefined accumulated usage for unknown sessions", async () => {
		const manager = new RuntimeHostUnderTest({
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
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
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
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: vi.fn(),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: agentShutdown,
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await expect(
			manager.startSession(
				normalizeStartInput({
					config: createConfig({ sessionId }),
					prompt: "hello",
					interactive: false,
				}),
			),
		).rejects.toThrow("run failed");
		expect(sessionService.updateSessionStatus).toHaveBeenCalledWith(
			sessionId,
			"failed",
			1,
		);
		expect(agentShutdown).toHaveBeenCalledTimes(1);
		expect(runtimeShutdown).toHaveBeenCalledTimes(1);
	});

	it("does not mask the run error when the failure-path transcript flush also fails", async () => {
		const sessionId = "sess-fail-persist";
		const manifest = createManifest(sessionId);
		const persistError = new Error("persist failed");
		const persistSessionMessages = vi.fn().mockRejectedValue(persistError);
		const logger: BasicLogger = {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		};
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-fail-persist.json",
				messagesPath: "/tmp/messages-fail-persist.json",
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
		const run = vi.fn().mockRejectedValue(new Error("run failed"));
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: vi.fn(),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await expect(
			manager.startSession(
				normalizeStartInput({
					config: createConfig({ sessionId, logger }),
					prompt: "hello",
					interactive: false,
				}),
			),
		).rejects.toThrow("run failed");
		expect(persistSessionMessages).toHaveBeenCalled();
		expect(logger.error).toHaveBeenCalledWith(
			"Failed to persist session messages after turn error",
			{ sessionId, error: persistError },
		);
	});

	it("marks a single-run error result as failed", async () => {
		const sessionId = "sess-error-result";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-error-result.json",
				messagesPath: "/tmp/messages-error-result.json",
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
				finishReason: "error",
				text: "",
			}),
		);
		const manager = new RuntimeHostUnderTest({
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
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		const started = await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				prompt: "hello",
				interactive: false,
			}),
		);

		expect(started.result?.finishReason).toBe("error");
		expect(sessionService.updateSessionStatus).toHaveBeenCalledWith(
			sessionId,
			"failed",
			1,
		);
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
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run: vi.fn(),
					continue: vi.fn(),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: agentShutdown,
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		const started = await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId: "sess-no-prompt" }),
				interactive: true,
			}),
		);
		await manager.stopSession(started.sessionId);

		expect(
			sessionService.createRootSessionWithArtifacts,
		).not.toHaveBeenCalled();
		expect(sessionService.updateSessionStatus).not.toHaveBeenCalled();
		expect(agentShutdown).toHaveBeenCalledWith("session_stop");
		expect(runtimeShutdown).toHaveBeenCalledTimes(1);
	});

	it("updates agent connection with refreshed OAuth key before turn", async () => {
		const sessionId = "sess-oauth";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-oauth.json",
				messagesPath: "/tmp/messages-oauth.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const updateConnectionDefaults = vi.fn();
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				delegatedAgentConfigProvider: {
					getRuntimeConfig: vi.fn(),
					getConnectionConfig: vi.fn(),
					updateConnectionDefaults,
				},
				shutdown: vi.fn(),
			}),
		};
		const run = vi.fn().mockResolvedValue(createResult({ text: "ok" }));
		const updateConnection = vi.fn();
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			oauthTokenManager: {
				resolveProviderApiKey: vi.fn().mockResolvedValue({
					apiKey: "oauth-access-new",
					refreshed: true,
				}),
			} as never,
			createAgent: () =>
				({
					run,
					continue: vi.fn(),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					restore: vi.fn(),
					updateConnection,
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({
					sessionId,
					providerId: "openai-codex",
					apiKey: "oauth-access-old",
				}),
				interactive: true,
			}),
		);
		await manager.runTurn({ sessionId, prompt: "hello" });

		expect(updateConnectionDefaults).toHaveBeenCalledWith({
			apiKey: "oauth-access-new",
		});
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
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			restore: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue([]),
			messages: [],
		});
		const manager = new RuntimeHostUnderTest({
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

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({
					sessionId,
					providerId: "vertex",
					modelId: "claude-sonnet-4@20250514",
				}),
				interactive: true,
			}),
		);
		await manager.runTurn({ sessionId, prompt: "hello" });

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

	it("forwards loopDetection config to the agent constructor", async () => {
		const sessionId = "sess-loop-detection";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-loop.json",
				messagesPath: "/tmp/messages-loop.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const run = vi.fn().mockResolvedValue(createResult());
		const createAgent = vi.fn().mockReturnValue({
			run,
			continue: vi.fn(),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			restore: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue([]),
			messages: [],
		});
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			},
			createAgent: createAgent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({
					sessionId,
					execution: {
						loopDetection: { softThreshold: 4, hardThreshold: 8 },
					},
				}),
				interactive: true,
			}),
		);
		await manager.runTurn({ sessionId, prompt: "test" });

		expect(createAgent).toHaveBeenCalledWith(
			expect.objectContaining({
				execution: {
					loopDetection: { softThreshold: 4, hardThreshold: 8 },
				},
			}),
		);
	});

	it("injects a core-owned compaction prepareTurn callback into the agent constructor", async () => {
		const sessionId = "sess-compaction";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-compaction.json",
				messagesPath: "/tmp/messages-compaction.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const run = vi.fn().mockResolvedValue(createResult());
		const createAgent = vi.fn().mockReturnValue({
			run,
			continue: vi.fn(),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue("conv-root-1"),
			restore: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue([]),
			messages: [],
		});
		const compact = vi.fn();
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			},
			createAgent: createAgent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({
					sessionId,
					compaction: {
						enabled: true,
						strategy: "basic",
						compact,
					},
				}),
				interactive: true,
			}),
		);
		await manager.runTurn({ sessionId, prompt: "test" });

		expect(createAgent).toHaveBeenCalledWith(
			expect.objectContaining({
				prepareTurn: expect.any(Function),
			}),
		);
	});

	it("binds unowned initial compaction state to the started session", async () => {
		const sessionId = "sess-compaction-initial";
		const manifest = createManifest(sessionId);
		const initialMessages: MessageWithMetadata[] = [
			{ role: "user", content: "large source" },
		];
		const initialCompactionState = createSessionCompactionState({
			sourceMessages: initialMessages,
			compactedMessages: [{ role: "user", content: "summary" }],
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-compaction-initial.json",
				messagesPath: "/tmp/messages-compaction-initial.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			persistSessionCompactionState: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const continuedMessages: MessageWithMetadata[] = [
			...initialMessages,
			{ role: "user", content: "continue" },
			{ role: "assistant", content: "continued" },
		];
		const run = vi.fn().mockResolvedValue(createResult());
		const continueRun = vi
			.fn()
			.mockResolvedValue(createResult({ messages: continuedMessages }));
		const createAgent = vi.fn().mockReturnValue({
			run,
			continue: continueRun,
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue(sessionId),
			restore: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue(initialMessages),
			messages: initialMessages,
		});
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			},
			createAgent: createAgent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({
					sessionId,
					compaction: {
						enabled: true,
						strategy: "basic",
						compact: vi.fn(),
					},
				}),
				initialMessages,
				initialCompactionState,
				interactive: true,
			}),
		);

		// Seeded sessions persist eagerly, so the unowned state is bound and
		// written as soon as the session starts.
		expect(sessionService.persistSessionCompactionState).toHaveBeenCalledWith(
			sessionId,
			expect.objectContaining({
				conversation_id: sessionId,
				messages: initialCompactionState.messages,
			}),
		);

		await manager.runTurn({ sessionId, prompt: "continue" });

		expect(continueRun).toHaveBeenCalledTimes(1);
	});

	// Manual /compact persists a sidecar regardless of the auto-compaction
	// setting, so the projection must stay wired even when compaction is
	// disabled — otherwise a manual compaction would silently never reach the
	// model. Without a sidecar the prepareTurn is a no-op.
	it("projects compaction state even when compaction is disabled", async () => {
		const sessionId = "sess-compaction-disabled";
		const manifest = createManifest(sessionId);
		const initialMessages: MessageWithMetadata[] = [
			{ role: "user", content: "canonical source" },
		];
		const initialCompactionState = createSessionCompactionState({
			sourceMessages: initialMessages,
			compactedMessages: [{ role: "user", content: "projected summary" }],
			conversationId: sessionId,
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-compaction-disabled.json",
				messagesPath: "/tmp/messages-compaction-disabled.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			persistSessionCompactionState: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const continuedMessages: MessageWithMetadata[] = [
			...initialMessages,
			{ role: "user", content: "follow-up" },
			{ role: "assistant", content: "continued" },
		];
		const run = vi.fn().mockResolvedValue(createResult());
		const continueRun = vi
			.fn()
			.mockResolvedValue(createResult({ messages: continuedMessages }));
		const createAgent = vi.fn().mockReturnValue({
			run,
			continue: continueRun,
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue(sessionId),
			restore: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue(initialMessages),
			messages: initialMessages,
		});
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			},
			createAgent: createAgent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({
					sessionId,
					compaction: {
						enabled: false,
						strategy: "basic",
					},
				}),
				initialMessages,
				initialCompactionState,
				interactive: true,
			}),
		);

		const prepareTurn = createAgent.mock.calls[0]?.[0]?.prepareTurn;
		expect(prepareTurn).toBeDefined();

		// Seeded sessions persist eagerly, so the sidecar lands on disk with
		// the seeded transcript and remains available for projection without
		// enabling automatic re-compaction.
		expect(sessionService.persistSessionCompactionState).toHaveBeenCalledWith(
			sessionId,
			expect.objectContaining({
				conversation_id: sessionId,
				messages: initialCompactionState.messages,
			}),
		);

		await manager.runTurn({ sessionId, prompt: "follow-up" });
		const followUpMessages = [
			...initialMessages,
			{ role: "user", content: "follow-up" },
		];
		const projected = await prepareTurn({
			agentId: "agent-root-1",
			conversationId: sessionId,
			parentAgentId: null,
			iteration: 1,
			abortSignal: new AbortController().signal,
			systemPrompt: "",
			tools: [],
			messages: followUpMessages,
			apiMessages: followUpMessages,
			model: {
				id: "mock-model",
				provider: "anthropic",
				info: { id: "mock-model", maxInputTokens: 100_000 },
			},
		});
		expect(projected?.messages).toEqual([
			{ role: "user", content: "projected summary" },
			{ role: "user", content: "follow-up" },
		]);
	});

	it("persists active manual compaction state against the persisted transcript", async () => {
		const sessionId = "sess-compaction-active-persisted";
		const tempCwd = mkdtempSync(join(tmpdir(), "compaction-active-"));
		try {
			const messagesPath = join(tempCwd, "messages.json");
			const persistedMessages = [
				{ role: "user", content: "hi" },
				{
					role: "assistant",
					content: "hello",
					modelInfo: { maxTokens: 1 },
				},
			] as MessageWithMetadata[];
			const liveMessages = [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "hello" },
			] as MessageWithMetadata[];
			writeFileSync(messagesPath, JSON.stringify(persistedMessages), "utf8");
			const manifest = {
				...createManifest(sessionId),
				messages_path: messagesPath,
			};
			const incoming = createSessionCompactionState({
				sourceMessages: persistedMessages,
				compactedMessages: [{ role: "user", content: "summary" }],
				conversationId: sessionId,
				updatedAt: "2026-01-01T00:00:00Z",
			});
			const sessionService = {
				ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
				createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
					manifestPath: "/tmp/manifest-compaction-active.json",
					messagesPath,
					manifest,
				}),
				persistSessionMessages: vi.fn(),
				persistSessionCompactionState: vi.fn(),
				updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
				writeSessionManifest: vi.fn(),
				listSessions: vi.fn().mockResolvedValue([
					{
						sessionId,
						provider: "mock-provider",
						model: "mock-model",
						cwd: "/tmp/project",
						workspaceRoot: "/tmp/project",
						createdAt: "2026-01-01T00:00:00.000Z",
						updatedAt: "2026-01-01T00:00:00.000Z",
						status: "completed",
						messagesPath,
					},
				]),
				deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
			};
			const createAgent = vi.fn().mockReturnValue({
				run: vi.fn().mockResolvedValue(createResult()),
				continue: vi.fn(),
				abort: vi.fn(),
				subscribeEvents: vi.fn().mockReturnValue(() => {}),
				canStartRun: vi.fn().mockReturnValue(true),
				getAgentId: vi.fn().mockReturnValue("agent-root-1"),
				getConversationId: vi.fn().mockReturnValue(sessionId),
				restore: vi.fn(),
				shutdown: vi.fn().mockResolvedValue(undefined),
				getMessages: vi.fn().mockReturnValue(liveMessages),
				messages: liveMessages,
			});
			const manager = new RuntimeHostUnderTest({
				distinctId,
				sessionService: sessionService as never,
				runtimeBuilder: {
					build: vi.fn().mockReturnValue({
						tools: [],
						shutdown: vi.fn(),
					}),
				},
				createAgent: createAgent as never,
			});

			await manager.startSession(
				normalizeStartInput({
					config: createConfig({
						sessionId,
						compaction: {
							enabled: true,
							strategy: "basic",
							compact: vi.fn().mockResolvedValue(undefined),
						},
					}),
					initialMessages: liveMessages,
					interactive: true,
				}),
			);

			await expect(
				manager.updateSessionCompactionState(sessionId, incoming),
			).resolves.toEqual({ updated: true });
			expect(sessionService.persistSessionCompactionState).toHaveBeenCalledWith(
				sessionId,
				incoming,
			);
			expect(createAgent.mock.results[0]?.value.restore).toHaveBeenCalledWith(
				persistedMessages,
			);
			const prepareTurn = createAgent.mock.calls[0]?.[0]?.prepareTurn;
			await expect(
				prepareTurn?.({
					agentId: "agent-root-1",
					conversationId: sessionId,
					parentAgentId: null,
					iteration: 1,
					abortSignal: new AbortController().signal,
					systemPrompt: "",
					tools: [],
					messages: [
						...persistedMessages,
						{ role: "user", content: "next" },
					] as MessageWithMetadata[],
					apiMessages: [
						...persistedMessages,
						{ role: "user", content: "next" },
					] as MessageWithMetadata[],
					model: {
						id: "mock-model",
						provider: "mock-provider",
						info: { id: "mock-model", maxInputTokens: 100_000 },
					},
				}),
			).resolves.toEqual({
				messages: [
					{ role: "user", content: "summary" },
					{ role: "user", content: "next" },
				],
			});
		} finally {
			rmSync(tempCwd, { recursive: true, force: true });
		}
	});

	it("persists auto-compaction state against runtime messages and replaces an invalid older sidecar", async () => {
		// Regression: the orchestrator appends the follow-up user turn to the
		// conversation store WITHOUT id/ts while the runtime's working
		// transcript (which prepareTurn sees, and which the compaction state's
		// source-prefix hash is computed over) carries codec-generated id/ts.
		// Validating the persist against agent.getMessages() therefore skipped
		// every auto-compaction write ("Skipped stale session compaction
		// state") and forced a full re-compaction on every subsequent turn.
		// Additionally, an unprojectable older sidecar (e.g. invalidated by
		// resume-time identity churn) must not permanently block a newer valid
		// state just because its source count is larger.
		const sessionId = "sess-compaction-auto-persist";
		const manifest = createManifest(sessionId);
		const priorMessages: MessageWithMetadata[] = [
			{ role: "user", content: "task", id: "m1", ts: 1 },
			{ role: "assistant", content: "working", id: "m2", ts: 2 },
		];
		// What the conversation store holds mid-turn: prior transcript plus the
		// just-appended follow-up WITHOUT identity fields.
		const storeMessages: MessageWithMetadata[] = [
			...priorMessages,
			{ role: "user", content: [{ type: "text", text: "follow-up" }] },
		];
		// What the runtime's prepareTurn context carries: the same transcript
		// with codec-assigned id/ts on the follow-up.
		const runtimeMessages: MessageWithMetadata[] = [
			...priorMessages,
			{
				role: "user",
				content: [{ type: "text", text: "follow-up" }],
				id: "msg_generated_1",
				ts: 3,
			},
		];
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-compaction-auto-persist.json",
				messagesPath: "/tmp/messages-compaction-auto-persist.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			persistSessionCompactionState: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const createAgent = vi.fn().mockReturnValue({
			run: vi.fn().mockResolvedValue(createResult()),
			continue: vi.fn(),
			abort: vi.fn(),
			subscribeEvents: vi.fn().mockReturnValue(() => {}),
			canStartRun: vi.fn().mockReturnValue(true),
			getAgentId: vi.fn().mockReturnValue("agent-root-1"),
			getConversationId: vi.fn().mockReturnValue(sessionId),
			restore: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue(storeMessages),
			messages: storeMessages,
		});
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder: {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			},
			createAgent: createAgent as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({
					sessionId,
					compaction: {
						enabled: true,
						strategy: "basic",
						compact: vi.fn().mockResolvedValue({
							messages: [{ role: "user", content: "summary" }],
						}),
					},
				}),
				initialMessages: priorMessages,
				interactive: true,
			}),
		);

		// Simulate an invalid older sidecar squatting in the session: it covers
		// MORE messages than the live transcript (so it can never project), and
		// under a count-first stale guard it would block every replacement.
		const staleState = createSessionCompactionState({
			sourceMessages: [
				...runtimeMessages,
				{ role: "assistant", content: "old extra message", id: "m4", ts: 4 },
			],
			compactedMessages: [{ role: "user", content: "stale summary" }],
			conversationId: sessionId,
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		const activeSessions = Reflect.get(manager as object, "sessions") as Map<
			string,
			{ compactionState?: typeof staleState }
		>;
		const activeSession = activeSessions.get(sessionId);
		expect(activeSession).toBeDefined();
		if (!activeSession) {
			throw new Error("expected active session");
		}
		activeSession.compactionState = staleState;

		const prepareTurn = createAgent.mock.calls[0]?.[0]?.prepareTurn;
		expect(prepareTurn).toBeDefined();

		const result = await prepareTurn({
			agentId: "agent-root-1",
			conversationId: sessionId,
			parentAgentId: null,
			iteration: 1,
			abortSignal: new AbortController().signal,
			systemPrompt: "",
			tools: [],
			messages: runtimeMessages,
			apiMessages: runtimeMessages,
			model: {
				id: "mock-model",
				provider: "mock-provider",
				// Tiny budget so the auto trigger always fires.
				info: { id: "mock-model", maxInputTokens: 10 },
			},
		});
		expect(result?.messages).toEqual([{ role: "user", content: "summary" }]);

		// The sidecar write must validate against the exact source messages the
		// state was computed from, not the store's id-less mid-turn shapes.
		expect(sessionService.persistSessionCompactionState).toHaveBeenCalledWith(
			sessionId,
			expect.objectContaining({
				conversation_id: sessionId,
				source_message_count: runtimeMessages.length,
				messages: [{ role: "user", content: "summary" }],
			}),
		);
	});

	it("orders equal-length compaction updates by parsed timestamp", async () => {
		const sessionId = "inactive-session";
		const tempCwd = mkdtempSync(join(tmpdir(), "compaction-stale-"));
		try {
			const messagesPath = join(tempCwd, "messages.json");
			const sourceMessages: MessageWithMetadata[] = [
				{ role: "user", content: "source" },
			];
			writeFileSync(messagesPath, JSON.stringify(sourceMessages), "utf8");
			const current = createSessionCompactionState({
				sourceMessages,
				compactedMessages: [{ role: "user", content: "current" }],
				conversationId: sessionId,
				updatedAt: "2026-01-01T00:00:00.500Z",
			});
			const incoming = createSessionCompactionState({
				sourceMessages,
				compactedMessages: [{ role: "user", content: "incoming" }],
				conversationId: sessionId,
				updatedAt: "2026-01-01T00:00:00Z",
			});
			const sessionService = {
				ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
				listSessions: vi.fn().mockResolvedValue([
					{
						sessionId,
						provider: "mock-provider",
						model: "mock-model",
						cwd: "/tmp/project",
						workspaceRoot: "/tmp/project",
						createdAt: "2026-01-01T00:00:00.000Z",
						updatedAt: "2026-01-01T00:00:00.000Z",
						status: "running",
						messagesPath,
					},
				]),
				readSessionCompactionState: vi.fn().mockResolvedValue(current),
				persistSessionCompactionState: vi.fn(),
			};
			const manager = new RuntimeHostUnderTest({
				distinctId,
				sessionService: sessionService as never,
			});

			await expect(
				manager.updateSessionCompactionState(sessionId, incoming),
			).resolves.toEqual({ updated: false });
			expect(
				sessionService.persistSessionCompactionState,
			).not.toHaveBeenCalled();
		} finally {
			rmSync(tempCwd, { recursive: true, force: true });
		}
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
			const manager = new RuntimeHostUnderTest({
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
						subscribeEvents: vi.fn().mockReturnValue(() => {}),
						canStartRun: vi.fn().mockReturnValue(true),
						getAgentId: vi.fn().mockReturnValue("agent-root-1"),
						getConversationId: vi.fn().mockReturnValue("conv-root-1"),
						shutdown: vi.fn().mockResolvedValue(undefined),
						getMessages: vi.fn().mockReturnValue([]),
						messages: [],
					}) as never,
			});

			await manager.startSession(
				normalizeStartInput({
					config: createConfig({
						sessionId,
						cwd: join(tempCwd, "docs"),
						workspaceRoot: tempCwd,
					}),
					interactive: true,
				}),
			);
			await manager.runTurn({
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
				messagesPath: "/tmp/messages-oauth-retry.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const updateConnectionDefaults = vi.fn();
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				delegatedAgentConfigProvider: {
					getRuntimeConfig: vi.fn(),
					getConnectionConfig: vi.fn(),
					updateConnectionDefaults,
				},
				shutdown: vi.fn(),
			}),
		};
		const run = vi
			.fn()
			.mockRejectedValueOnce(new Error("401 Unauthorized"))
			.mockResolvedValueOnce(
				createResult({
					text: "retried",
					usage: {
						inputTokens: 9,
						outputTokens: 4,
						cacheReadTokens: 2,
						cacheWriteTokens: 1,
						totalCost: 0.11,
					},
					model: {
						id: "claude-sonnet-4-6",
						provider: "anthropic",
						info: {
							id: "claude-sonnet-4-6",
							family: "claude-sonnet-4",
						},
					},
					messages: [
						{ role: "user", content: [{ type: "text", text: "hello" }] },
						{ role: "assistant", content: [{ type: "text", text: "retried" }] },
					],
				}),
			);
		const restore = vi.fn();
		const updateConnection = vi.fn();
		const resolveProviderApiKey = vi
			.fn()
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({
				apiKey: "oauth-access-new",
				refreshed: true,
			});
		const manager = new RuntimeHostUnderTest({
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
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					restore,
					updateConnection,
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({
					sessionId,
					providerId: "openai-codex",
					apiKey: "oauth-access-old",
				}),
				interactive: true,
			}),
		);
		const result = await manager.runTurn({ sessionId, prompt: "hello" });

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
		expect(updateConnectionDefaults).toHaveBeenCalledWith({
			apiKey: "oauth-access-new",
		});
		expect(sessionService.persistSessionMessages).toHaveBeenCalledTimes(1);
		const persisted = (
			sessionService.persistSessionMessages as ReturnType<typeof vi.fn>
		).mock.calls[0]?.[1] as Array<Record<string, unknown>> | undefined;
		expect(persisted?.[1]).toMatchObject({
			role: "assistant",
			modelInfo: {
				id: "claude-sonnet-4-6",
				provider: "anthropic",
				family: "claude-sonnet-4",
			},
			metrics: {
				inputTokens: 9,
				outputTokens: 4,
				cacheReadTokens: 2,
				cacheWriteTokens: 1,
				cost: 0.11,
			},
		});
	});

	it("auto-continues when async teammate runs complete after lead turn", async () => {
		const sessionId = "sess-team-auto-continue";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-team-auto-continue.json",
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
			return createResult({
				text: "lead scheduled teammate",
				messages: [
					{ role: "user", content: "run teammate work" },
					{ role: "assistant", content: "lead scheduled teammate" },
				],
			});
		});
		const continueFn = vi.fn().mockResolvedValue(
			createResult({
				text: "lead processed teammate result",
				messages: [
					{ role: "user", content: "run teammate work" },
					{ role: "assistant", content: "lead scheduled teammate" },
					{
						role: "user",
						content:
							"System-delivered teammate async run updates:\n- investigator completed",
					},
					{ role: "assistant", content: "lead processed teammate result" },
				],
			}),
		);
		const manager = new RuntimeHostUnderTest({
			distinctId,
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: continueFn,
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: false,
			}),
		);
		const result = await manager.runTurn({
			sessionId,
			prompt: "run teammate work",
		});

		expect(result?.text).toBe("lead processed teammate result");
		expect(run).toHaveBeenCalledTimes(1);
		expect(continueFn).toHaveBeenCalledTimes(1);
		expect(continueFn.mock.calls[0]?.[0]).toContain(
			"System-delivered teammate async run updates:",
		);
		const finalPersistedMessages = (
			sessionService.persistSessionMessages as ReturnType<typeof vi.fn>
		).mock.calls.at(-1)?.[1] as Array<Record<string, unknown>> | undefined;
		expect(finalPersistedMessages?.at(-1)).toMatchObject({
			role: "assistant",
			metrics: {
				inputTokens: 1,
				outputTokens: 2,
				cost: 0,
			},
			modelInfo: {
				id: "mock-model",
				provider: "mock-provider",
			},
		});
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
		const manager = new RuntimeHostUnderTest({
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
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				prompt: "run teammate work",
				interactive: false,
			}),
		);

		expect(sessionService.onTeamTaskStart).toHaveBeenCalledTimes(1);
		expect(sessionService.onTeamTaskEnd).toHaveBeenCalledWith(
			sessionId,
			"providers-investigator",
			"failed",
			"[error] 401 Unauthorized",
			undefined,
			failedMessages,
		);
	});

	it("persists teammate progress updates for team-task sub-sessions", async () => {
		const sessionId = "sess-team-task-progress";
		const manifest = createManifest(sessionId);
		const sessionService = {
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-team-task-progress.json",
				messagesPath: "/tmp/messages-team-task-progress.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
			onTeamTaskStart: vi.fn().mockResolvedValue(undefined),
			onTeamTaskEnd: vi.fn().mockResolvedValue(undefined),
			onTeamTaskProgress: vi.fn().mockResolvedValue(undefined),
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

		const manager = new RuntimeHostUnderTest({
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
							type: "run_progress",
							run: {
								id: "run_00002",
								agentId: "providers-investigator",
								status: "running",
								message: "Investigate provider boundaries",
								priority: 0,
								retryCount: 0,
								maxRetries: 0,
								continueConversation: false,
								startedAt: new Date("2026-01-01T00:00:00.000Z"),
								lastProgressAt: new Date("2026-01-01T00:00:01.000Z"),
								lastProgressMessage: "heartbeat",
								currentActivity: "heartbeat",
							},
							message: "heartbeat",
						});
						onTeamEvent?.({
							type: "agent_event",
							agentId: "providers-investigator",
							event: {
								type: "content_start",
								contentType: "text",
								text: "Drafting the provider boundary analysis now.",
							},
						});
						onTeamEvent?.({
							type: "task_end",
							agentId: "providers-investigator",
							result: createResult(),
						});
						return createResult({ text: "lead handled progress" });
					}),
					continue: vi.fn(),
					abort: vi.fn(),
					subscribeEvents: vi.fn().mockReturnValue(() => {}),
					canStartRun: vi.fn().mockReturnValue(true),
					getAgentId: vi.fn().mockReturnValue("agent-root-1"),
					getConversationId: vi.fn().mockReturnValue("conv-root-1"),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				prompt: "run teammate work",
				interactive: false,
			}),
		);

		expect(sessionService.onTeamTaskProgress).toHaveBeenCalledWith(
			sessionId,
			"providers-investigator",
			"heartbeat",
			{ kind: "heartbeat" },
		);
		expect(sessionService.onTeamTaskProgress).toHaveBeenCalledWith(
			sessionId,
			"providers-investigator",
			"Drafting the provider boundary analysis now.",
			{ kind: "text" },
		);
	});

	describe("task.completed telemetry anchoring", () => {
		function createTaskCompletedAdapter() {
			return {
				name: "task-completed-test",
				emit: vi.fn(),
				emitRequired: vi.fn(),
				recordCounter: vi.fn(),
				recordHistogram: vi.fn(),
				recordGauge: vi.fn(),
				isEnabled: vi.fn(() => true),
				flush: vi.fn().mockResolvedValue(undefined),
				dispose: vi.fn().mockResolvedValue(undefined),
			};
		}

		function createSubmitAndExitToolCall(): NonNullable<
			AgentResult["toolCalls"]
		>[number] {
			return {
				id: "call-submit-1",
				name: "submit_and_exit",
				input: { result: "done" },
				output: { ok: true },
				durationMs: 1,
				startedAt: new Date("2026-01-01T00:00:00.500Z"),
				endedAt: new Date("2026-01-01T00:00:00.600Z"),
			};
		}

		function createMockSessionService(manifest: SessionManifest) {
			return {
				ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
				createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
					manifestPath: "/tmp/manifest.json",
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
		}

		function countTaskCompletedEmissions(
			adapter: ReturnType<typeof createTaskCompletedAdapter>,
		): Array<Record<string, unknown>> {
			return adapter.emit.mock.calls
				.filter(([event]) => event === "task.completed")
				.map(([, payload]) => payload as Record<string, unknown>);
		}

		function getActiveSession(
			manager: RuntimeHostUnderTest,
			sessionId: string,
		): { status: string } {
			const sessions = (
				manager as unknown as { sessions: Map<string, { status: string }> }
			).sessions;
			const session = sessions.get(sessionId);
			if (!session) throw new Error("session was not registered");
			return session;
		}

		it("emits task.completed once with source=submit_and_exit when the assistant calls the completion tool in a non-interactive run", async () => {
			const sessionId = "sess-task-completed-submit-non-interactive";
			const manifest = createManifest(sessionId);
			const adapter = createTaskCompletedAdapter();
			const telemetry = new TelemetryService({
				adapters: [adapter],
				distinctId,
			});
			const sessionService = createMockSessionService(manifest);
			const runtimeBuilder = {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			};
			const agent = {
				run: vi.fn().mockResolvedValue(
					createResult({
						toolCalls: [createSubmitAndExitToolCall()],
					}),
				),
				continue: vi.fn(),
				getMessages: vi.fn().mockReturnValue([]),
				getAgentId: vi.fn().mockReturnValue("agent-root-1"),
				getConversationId: vi.fn().mockReturnValue("conv-root-1"),
				abort: vi.fn(),
				subscribeEvents: vi.fn().mockReturnValue(() => {}),
				canStartRun: vi.fn().mockReturnValue(true),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};
			const manager = new RuntimeHostUnderTest({
				distinctId,
				sessionService: sessionService as never,
				runtimeBuilder: runtimeBuilder as never,
				createAgent: () => agent as never,
				telemetry,
			});

			await manager.startSession(
				normalizeStartInput({
					config: createConfig({ telemetry, sessionId }),
					prompt: "do a thing then submit_and_exit",
					interactive: false,
				}),
			);

			const emissions = countTaskCompletedEmissions(adapter);
			expect(emissions).toHaveLength(1);
			expect(emissions[0]).toMatchObject({
				ulid: sessionId,
				source: "submit_and_exit",
				provider: "mock-provider",
				modelId: "mock-model",
			});
		});

		it("falls back to source=shutdown when a non-interactive run completes without submit_and_exit", async () => {
			const sessionId = "sess-task-completed-shutdown-fallback";
			const manifest = createManifest(sessionId);
			const adapter = createTaskCompletedAdapter();
			const telemetry = new TelemetryService({
				adapters: [adapter],
				distinctId,
			});
			const sessionService = createMockSessionService(manifest);
			const runtimeBuilder = {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			};
			const agent = {
				// No `submit_and_exit` in toolCalls — represents a non-interactive
				// run that finished cleanly without invoking the completion tool.
				run: vi.fn().mockResolvedValue(createResult({ toolCalls: [] })),
				continue: vi.fn(),
				getMessages: vi.fn().mockReturnValue([]),
				getAgentId: vi.fn().mockReturnValue("agent-root-1"),
				getConversationId: vi.fn().mockReturnValue("conv-root-1"),
				abort: vi.fn(),
				subscribeEvents: vi.fn().mockReturnValue(() => {}),
				canStartRun: vi.fn().mockReturnValue(true),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};
			const manager = new RuntimeHostUnderTest({
				distinctId,
				sessionService: sessionService as never,
				runtimeBuilder: runtimeBuilder as never,
				createAgent: () => agent as never,
				telemetry,
			});

			await manager.startSession(
				normalizeStartInput({
					config: createConfig({ telemetry, sessionId }),
					prompt: "just finish",
					interactive: false,
				}),
			);

			const emissions = countTaskCompletedEmissions(adapter);
			expect(emissions).toHaveLength(1);
			expect(emissions[0]).toMatchObject({
				ulid: sessionId,
				source: "shutdown",
			});
		});

		it("emits task.completed exactly once when an interactive turn invokes submit_and_exit and is later cancelled", async () => {
			const sessionId = "sess-task-completed-interactive-then-cancel";
			const manifest = createManifest(sessionId);
			const adapter = createTaskCompletedAdapter();
			const telemetry = new TelemetryService({
				adapters: [adapter],
				distinctId,
			});
			const sessionService = createMockSessionService(manifest);
			const runtimeBuilder = {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			};
			const agent = {
				run: vi.fn().mockResolvedValue(
					createResult({
						toolCalls: [createSubmitAndExitToolCall()],
					}),
				),
				continue: vi.fn(),
				getMessages: vi.fn().mockReturnValue([]),
				getAgentId: vi.fn().mockReturnValue("agent-root-1"),
				getConversationId: vi.fn().mockReturnValue("conv-root-1"),
				abort: vi.fn(),
				subscribeEvents: vi.fn().mockReturnValue(() => {}),
				canStartRun: vi.fn().mockReturnValue(true),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};
			const manager = new RuntimeHostUnderTest({
				distinctId,
				sessionService: sessionService as never,
				runtimeBuilder: runtimeBuilder as never,
				createAgent: () => agent as never,
				telemetry,
			});

			await manager.startSession(
				normalizeStartInput({
					config: createConfig({ telemetry, sessionId }),
					prompt: "complete and remain attached",
					interactive: true,
				}),
			);

			// Simulate the user later closing the interactive session via stop.
			await manager.stopSession(sessionId);

			const emissions = countTaskCompletedEmissions(adapter);
			expect(emissions).toHaveLength(1);
			expect(emissions[0]).toMatchObject({
				ulid: sessionId,
				source: "submit_and_exit",
			});
		});

		it("does not emit a duplicate task.completed when shutdownSession runs after a successful submit_and_exit observation", async () => {
			const sessionId = "sess-task-completed-no-double-fire";
			const manifest = createManifest(sessionId);
			const adapter = createTaskCompletedAdapter();
			const telemetry = new TelemetryService({
				adapters: [adapter],
				distinctId,
			});
			const sessionService = createMockSessionService(manifest);
			const runtimeBuilder = {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			};
			// Non-interactive: executeAgentTurn → finalizeSingleRun → shutdownSession,
			// all in the same `startSession(...)` call. We must see exactly one emission.
			const agent = {
				run: vi.fn().mockResolvedValue(
					createResult({
						toolCalls: [createSubmitAndExitToolCall()],
					}),
				),
				continue: vi.fn(),
				getMessages: vi.fn().mockReturnValue([]),
				getAgentId: vi.fn().mockReturnValue("agent-root-1"),
				getConversationId: vi.fn().mockReturnValue("conv-root-1"),
				abort: vi.fn(),
				subscribeEvents: vi.fn().mockReturnValue(() => {}),
				canStartRun: vi.fn().mockReturnValue(true),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};
			const manager = new RuntimeHostUnderTest({
				distinctId,
				sessionService: sessionService as never,
				runtimeBuilder: runtimeBuilder as never,
				createAgent: () => agent as never,
				telemetry,
			});

			await manager.startSession(
				normalizeStartInput({
					config: createConfig({ telemetry, sessionId }),
					prompt: "do then submit_and_exit",
					interactive: false,
				}),
			);

			const emissions = countTaskCompletedEmissions(adapter);
			expect(emissions).toHaveLength(1);
			expect(emissions[0]).toMatchObject({ source: "submit_and_exit" });
		});

		it("ignores failed submit_and_exit tool calls so the shutdown fallback still fires", async () => {
			const sessionId = "sess-task-completed-failed-submit";
			const manifest = createManifest(sessionId);
			const adapter = createTaskCompletedAdapter();
			const telemetry = new TelemetryService({
				adapters: [adapter],
				distinctId,
			});
			const sessionService = createMockSessionService(manifest);
			const runtimeBuilder = {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			};
			const failedSubmitCall: NonNullable<AgentResult["toolCalls"]>[number] = {
				...createSubmitAndExitToolCall(),
				error: "missing required field",
			};
			const agent = {
				run: vi.fn().mockResolvedValue(
					createResult({
						toolCalls: [failedSubmitCall],
					}),
				),
				continue: vi.fn(),
				getMessages: vi.fn().mockReturnValue([]),
				getAgentId: vi.fn().mockReturnValue("agent-root-1"),
				getConversationId: vi.fn().mockReturnValue("conv-root-1"),
				abort: vi.fn(),
				subscribeEvents: vi.fn().mockReturnValue(() => {}),
				canStartRun: vi.fn().mockReturnValue(true),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};
			const manager = new RuntimeHostUnderTest({
				distinctId,
				sessionService: sessionService as never,
				runtimeBuilder: runtimeBuilder as never,
				createAgent: () => agent as never,
				telemetry,
			});

			await manager.startSession(
				normalizeStartInput({
					config: createConfig({ telemetry, sessionId }),
					prompt: "attempt submit but fail",
					interactive: false,
				}),
			);

			const emissions = countTaskCompletedEmissions(adapter);
			expect(emissions).toHaveLength(1);
			expect(emissions[0]).toMatchObject({ source: "shutdown" });
		});

		it("emits task.completed exactly once when a stopped interactive session takes the release path after a clean final turn", async () => {
			const sessionId = "sess-task-completed-release-path";
			const manifest = createManifest(sessionId);
			const adapter = createTaskCompletedAdapter();
			const telemetry = new TelemetryService({
				adapters: [adapter],
				distinctId,
			});
			const sessionService = createMockSessionService(manifest);
			const runtimeBuilder = {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			};
			const agent = {
				// Clean final turn without submit_and_exit — records
				// lastInteractiveTurnFinishReason === "completed".
				run: vi.fn().mockResolvedValue(createResult({ toolCalls: [] })),
				continue: vi.fn(),
				getMessages: vi.fn().mockReturnValue([]),
				getAgentId: vi.fn().mockReturnValue("agent-root-1"),
				getConversationId: vi.fn().mockReturnValue("conv-root-1"),
				abort: vi.fn(),
				subscribeEvents: vi.fn().mockReturnValue(() => {}),
				canStartRun: vi.fn().mockReturnValue(true),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};
			const manager = new RuntimeHostUnderTest({
				distinctId,
				sessionService: sessionService as never,
				runtimeBuilder: runtimeBuilder as never,
				createAgent: () => agent as never,
				telemetry,
			});

			await manager.startSession(
				normalizeStartInput({
					config: createConfig({ telemetry, sessionId }),
					prompt: "finish the task cleanly",
					interactive: true,
				}),
			);

			// Truthful status reporting can leave a resident interactive session
			// with a terminal reported status (e.g. adopted from a resumed
			// manifest), which routes stopSession through releaseSessionRuntime
			// instead of shutdownSession.
			getActiveSession(manager, sessionId).status = "completed";
			const statusWritesBeforeStop =
				sessionService.updateSessionStatus.mock.calls.length;
			await manager.stopSession(sessionId);
			// The release branch never writes a session status — this proves the
			// stop really took the path that used to drop the emission.
			expect(sessionService.updateSessionStatus.mock.calls.length).toBe(
				statusWritesBeforeStop,
			);

			const emissions = countTaskCompletedEmissions(adapter);
			expect(emissions).toHaveLength(1);
			expect(emissions[0]).toMatchObject({
				ulid: sessionId,
				source: "shutdown",
				provider: "mock-provider",
				modelId: "mock-model",
			});
		});

		it("emits nothing when a released interactive session's final turn aborted", async () => {
			const sessionId = "sess-task-completed-release-aborted";
			const manifest = createManifest(sessionId);
			const adapter = createTaskCompletedAdapter();
			const telemetry = new TelemetryService({
				adapters: [adapter],
				distinctId,
			});
			const sessionService = createMockSessionService(manifest);
			const runtimeBuilder = {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			};
			const agent = {
				run: vi
					.fn()
					.mockResolvedValue(
						createResult({ finishReason: "aborted", toolCalls: [] }),
					),
				continue: vi.fn(),
				getMessages: vi.fn().mockReturnValue([]),
				getAgentId: vi.fn().mockReturnValue("agent-root-1"),
				getConversationId: vi.fn().mockReturnValue("conv-root-1"),
				abort: vi.fn(),
				subscribeEvents: vi.fn().mockReturnValue(() => {}),
				canStartRun: vi.fn().mockReturnValue(true),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};
			const manager = new RuntimeHostUnderTest({
				distinctId,
				sessionService: sessionService as never,
				runtimeBuilder: runtimeBuilder as never,
				createAgent: () => agent as never,
				telemetry,
			});

			await manager.startSession(
				normalizeStartInput({
					config: createConfig({ telemetry, sessionId }),
					prompt: "turn that gets aborted",
					interactive: true,
				}),
			);

			getActiveSession(manager, sessionId).status = "cancelled";
			await manager.stopSession(sessionId);

			expect(countTaskCompletedEmissions(adapter)).toHaveLength(0);
		});

		it("emits nothing when a session's final turn errors after an earlier clean turn", async () => {
			const sessionId = "sess-task-completed-late-error";
			const manifest = createManifest(sessionId);
			const adapter = createTaskCompletedAdapter();
			const telemetry = new TelemetryService({
				adapters: [adapter],
				distinctId,
			});
			const sessionService = createMockSessionService(manifest);
			const runtimeBuilder = {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			};
			const agent = {
				// First turn completes cleanly, second turn throws — the errored
				// turn is the session's final turn, so no task.completed may be
				// emitted from the stale "completed" of the first turn.
				run: vi.fn().mockResolvedValue(createResult({ toolCalls: [] })),
				continue: vi.fn().mockRejectedValue(new Error("provider exploded")),
				getMessages: vi.fn().mockReturnValue([]),
				getAgentId: vi.fn().mockReturnValue("agent-root-1"),
				getConversationId: vi.fn().mockReturnValue("conv-root-1"),
				abort: vi.fn(),
				subscribeEvents: vi.fn().mockReturnValue(() => {}),
				canStartRun: vi.fn().mockReturnValue(true),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};
			const manager = new RuntimeHostUnderTest({
				distinctId,
				sessionService: sessionService as never,
				runtimeBuilder: runtimeBuilder as never,
				createAgent: () => agent as never,
				telemetry,
			});

			await manager.startSession(
				normalizeStartInput({
					config: createConfig({ telemetry, sessionId }),
					prompt: "first turn finishes cleanly",
					interactive: true,
				}),
			);
			await expect(
				manager.runTurn({ sessionId, prompt: "second turn blows up" }),
			).rejects.toThrow("provider exploded");

			expect(countTaskCompletedEmissions(adapter)).toHaveLength(0);
		});

		it("does not double-fire from the release path after submit_and_exit already emitted", async () => {
			const sessionId = "sess-task-completed-release-no-double-fire";
			const manifest = createManifest(sessionId);
			const adapter = createTaskCompletedAdapter();
			const telemetry = new TelemetryService({
				adapters: [adapter],
				distinctId,
			});
			const sessionService = createMockSessionService(manifest);
			const runtimeBuilder = {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			};
			const agent = {
				run: vi.fn().mockResolvedValue(
					createResult({
						toolCalls: [createSubmitAndExitToolCall()],
					}),
				),
				continue: vi.fn(),
				getMessages: vi.fn().mockReturnValue([]),
				getAgentId: vi.fn().mockReturnValue("agent-root-1"),
				getConversationId: vi.fn().mockReturnValue("conv-root-1"),
				abort: vi.fn(),
				subscribeEvents: vi.fn().mockReturnValue(() => {}),
				canStartRun: vi.fn().mockReturnValue(true),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};
			const manager = new RuntimeHostUnderTest({
				distinctId,
				sessionService: sessionService as never,
				runtimeBuilder: runtimeBuilder as never,
				createAgent: () => agent as never,
				telemetry,
			});

			await manager.startSession(
				normalizeStartInput({
					config: createConfig({ telemetry, sessionId }),
					prompt: "complete via submit_and_exit",
					interactive: true,
				}),
			);

			getActiveSession(manager, sessionId).status = "completed";
			await manager.stopSession(sessionId);

			const emissions = countTaskCompletedEmissions(adapter);
			expect(emissions).toHaveLength(1);
			expect(emissions[0]).toMatchObject({
				ulid: sessionId,
				source: "submit_and_exit",
			});
		});

		it("emits task.completed exactly once when dispose() releases a cleanly finished interactive session", async () => {
			const sessionId = "sess-task-completed-dispose-release";
			const manifest = createManifest(sessionId);
			const adapter = createTaskCompletedAdapter();
			const telemetry = new TelemetryService({
				adapters: [adapter],
				distinctId,
			});
			const sessionService = createMockSessionService(manifest);
			const runtimeBuilder = {
				build: vi.fn().mockReturnValue({
					tools: [],
					shutdown: vi.fn(),
				}),
			};
			const agent = {
				run: vi.fn().mockResolvedValue(createResult({ toolCalls: [] })),
				continue: vi.fn(),
				getMessages: vi.fn().mockReturnValue([]),
				getAgentId: vi.fn().mockReturnValue("agent-root-1"),
				getConversationId: vi.fn().mockReturnValue("conv-root-1"),
				abort: vi.fn(),
				subscribeEvents: vi.fn().mockReturnValue(() => {}),
				canStartRun: vi.fn().mockReturnValue(true),
				shutdown: vi.fn().mockResolvedValue(undefined),
			};
			const manager = new RuntimeHostUnderTest({
				distinctId,
				sessionService: sessionService as never,
				runtimeBuilder: runtimeBuilder as never,
				createAgent: () => agent as never,
				telemetry,
			});

			await manager.startSession(
				normalizeStartInput({
					config: createConfig({ telemetry, sessionId }),
					prompt: "finish then get disposed",
					interactive: true,
				}),
			);

			getActiveSession(manager, sessionId).status = "completed";
			await manager.dispose("hub_restart");

			const emissions = countTaskCompletedEmissions(adapter);
			expect(emissions).toHaveLength(1);
			expect(emissions[0]).toMatchObject({
				ulid: sessionId,
				source: "shutdown",
			});
		});
	});

	describe("LocalRuntimeHost releasing a session mid-run", () => {
		it("aborts and drains the run before shutting the sandbox down", async () => {
			// A hub restart disposes its sessions. Tearing one down while a run is in
			// flight used to reject shutdown ("a run is in progress") and SIGTERM the
			// plugin sandbox with tool calls still pending, so a connector turn awaiting
			// the run got an error instead of an answer.
			const order: string[] = [];
			let running = true;
			const agent = {
				run: vi.fn().mockResolvedValue(createResult()),
				continue: vi.fn().mockResolvedValue(createResult()),
				getMessages: vi.fn().mockReturnValue([]),
				getAgentId: vi.fn().mockReturnValue("agent-mid-run"),
				getConversationId: vi.fn().mockReturnValue("conv-mid-run"),
				abort: vi.fn(() => {
					order.push("agent.abort");
					running = false;
				}),
				subscribeEvents: vi.fn().mockReturnValue(() => {}),
				// Reports "busy" until the abort lands, like a live run.
				canStartRun: vi.fn(() => !running),
				shutdown: vi.fn(async () => {
					order.push("agent.shutdown");
				}),
			};
			const runtimeShutdown = vi.fn(async () => {
				order.push("runtime.shutdown");
				if (running) {
					throw new Error(
						"SessionRuntime.shutdown called while a run is in progress (agentId=agent-mid-run)",
					);
				}
			});
			const runtimeBuilder = {
				build: vi
					.fn()
					.mockReturnValue({ tools: [], shutdown: runtimeShutdown }),
			};
			const manager = new RuntimeHostUnderTest({
				distinctId,
				sessionService: new FileSessionService(
					join(isolatedHomeDir, "sessions"),
				),
				runtimeBuilder: runtimeBuilder as never,
				createAgent: () => agent as never,
			});

			const started = await manager.startSession({
				config: {
					providerId: "mock-provider",
					modelId: "mock-model",
					systemPrompt: "You are a test agent",
					enableTools: false,
					enableSpawnAgent: false,
					enableAgentTeams: false,
				},
			});
			const session = (
				manager as unknown as {
					sessions: Map<
						string,
						{ pluginSandboxShutdown?: () => Promise<void> }
					>;
				}
			).sessions.get(started.sessionId);
			if (!session) {
				throw new Error("session was not registered");
			}
			session.pluginSandboxShutdown = async () => {
				order.push("sandbox.shutdown");
			};

			// dispose() is what a hub restart runs.
			await manager.dispose("hub_restart");

			// The abort has to come first, so the runtime drains instead of refusing and
			// the sandbox is only killed once no tool call can be pending.
			expect(order[0]).toBe("agent.abort");
			expect(order).toContain("sandbox.shutdown");
			expect(order.indexOf("agent.abort")).toBeLessThan(
				order.indexOf("sandbox.shutdown"),
			);
			expect(agent.abort).toHaveBeenCalledTimes(1);
		});
	});
});
