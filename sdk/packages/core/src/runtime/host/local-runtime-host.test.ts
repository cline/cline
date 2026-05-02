import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageWithMetadata } from "@clinebot/llms";
import type {
	AgentExtensionAutomationContext,
	AgentResult,
	BasicLogger,
} from "@clinebot/shared";
import { setClineDir, setHomeDir } from "@clinebot/shared/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelemetryService } from "../../services/telemetry/TelemetryService";
import type { SessionManifest } from "../../session/models/session-manifest";
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

function _createGitRepo(cwd: string): void {
	execFileSync("git", ["-C", cwd, "init"], { stdio: "pipe" });
	execFileSync("git", ["-C", cwd, "config", "user.name", "Codex Test"], {
		stdio: "pipe",
	});
	execFileSync(
		"git",
		["-C", cwd, "config", "user.email", "codex@example.com"],
		{
			stdio: "pipe",
		},
	);
	writeFileSync(join(cwd, "note.txt"), "base\n", "utf8");
	execFileSync("git", ["-C", cwd, "add", "note.txt"], { stdio: "pipe" });
	execFileSync("git", ["-C", cwd, "commit", "-m", "initial"], {
		stdio: "pipe",
	});
}

describe("LocalRuntimeHost", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
	};
	let isolatedHomeDir = "";

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "core-session-home-"));
		process.env.HOME = isolatedHomeDir;
		process.env.CLINE_DIR = join(isolatedHomeDir, ".cline");
		setHomeDir(isolatedHomeDir);
		setClineDir(process.env.CLINE_DIR);
	});

	afterEach(() => {
		process.env.HOME = envSnapshot.HOME;
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR;
		setHomeDir(envSnapshot.HOME ?? "~");
		setClineDir(envSnapshot.CLINE_DIR ?? join("~", ".cline"));
		rmSync(isolatedHomeDir, { recursive: true, force: true });
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
				expect(config.requestToolApproval).toBe(requestToolApproval);
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

	it("persists initial messages for idle resumed sessions", async () => {
		const sessionId = "sess-fork-copy";
		const manifest = createManifest(sessionId);
		const initialMessages: MessageWithMetadata[] = [
			{ role: "user" as const, content: "build a thing" },
			{ role: "assistant" as const, content: "done" },
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
			continue: vi.fn().mockResolvedValue(createResult()),
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
		expect(sessionService.createRootSessionWithArtifacts).toHaveBeenCalledTimes(
			1,
		);
		expect(sessionService.persistSessionMessages).toHaveBeenCalledWith(
			sessionId,
			initialMessages,
			"You are a test agent",
		);
		expect(sessionService.updateSessionStatus).toHaveBeenCalledWith(
			sessionId,
			"completed",
			0,
		);
		await expect(manager.getSession(sessionId)).resolves.toMatchObject({
			sessionId,
			status: "completed",
		});
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

	it("marks interactive turns completed without disposing the session", async () => {
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
					...(status === "running"
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
			"completed",
			0,
		);
		await expect(manager.getSession(sessionId)).resolves.toMatchObject({
			sessionId,
			status: "completed",
		});
		expect(agent.shutdown).not.toHaveBeenCalled();
		expect(runtime.shutdown).not.toHaveBeenCalled();
	});

	it("disposes idle interactive sessions without changing completed status", async () => {
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

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
				initialMessages: [{ role: "user", content: "done already" }],
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

	it("drops and ignores queued prompts once a session is aborting", async () => {
		const sessionId = "sess-abort-pending";
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
			payload: { prompt: "queued before abort" },
		});
		expect(harness.getPendingPrompts(sessionId)).toEqual([
			{ prompt: "queued before abort", delivery: "queue" },
		]);

		await manager.abort(sessionId, new Error("test abort"));
		expect(agent.abort).toHaveBeenCalledTimes(1);
		expect(harness.getPendingPrompts(sessionId)).toEqual([]);

		await harness.handlePluginEvent(sessionId, {
			name: "queue_message",
			payload: { prompt: "queued after abort" },
		});
		expect(harness.getPendingPrompts(sessionId)).toEqual([]);
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
		const second = await manager.runTurn({ sessionId, prompt: "second" });

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
		expect(await manager.getAccumulatedUsage(sessionId)).toEqual({
			inputTokens: 10,
			outputTokens: 3,
			cacheReadTokens: 1,
			cacheWriteTokens: 2,
			totalCost: 0.11,
		});

		await manager.runTurn({ sessionId, prompt: "second" });
		expect(await manager.getAccumulatedUsage(sessionId)).toEqual({
			inputTokens: 18,
			outputTokens: 7,
			cacheReadTokens: 3,
			cacheWriteTokens: 2,
			totalCost: 0.2,
		});
	});

	it("resumes saved interactive sessions without rewriting metadata or timestamps and seeds usage", async () => {
		const sessionId = "sess-resume-readonly";
		const manifest = {
			...createManifest(sessionId),
			status: "completed" as const,
			ended_at: "2026-01-01T00:03:00.000Z",
			metadata: { title: "saved title", totalCost: 0.25 },
			messages_path: `/tmp/sessions/${sessionId}/${sessionId}.messages.json`,
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
			ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
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

		await manager.startSession(
			normalizeStartInput({
				config: createConfig({ sessionId }),
				interactive: true,
				initialMessages,
			}),
		);

		expect(createRootSessionWithArtifacts).not.toHaveBeenCalled();
		expect(persistSessionMessages).not.toHaveBeenCalled();
		expect(updateSessionStatus).not.toHaveBeenCalled();
		expect(updateSession).not.toHaveBeenCalled();
		expect(await manager.getAccumulatedUsage(sessionId)).toEqual({
			inputTokens: 11,
			outputTokens: 7,
			cacheReadTokens: 3,
			cacheWriteTokens: 2,
			totalCost: 0.25,
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
			"completed",
			0,
		);
		expect(updateSession).toHaveBeenCalledWith({
			sessionId,
			metadata: { title: "saved title", totalCost: 0.35 },
		});
		expect(await manager.getAccumulatedUsage(sessionId)).toEqual({
			inputTokens: 16,
			outputTokens: 11,
			cacheReadTokens: 3,
			cacheWriteTokens: 2,
			totalCost: 0.35,
		});
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
				providerId: "openai-codex",
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
});
