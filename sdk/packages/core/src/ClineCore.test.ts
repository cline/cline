import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClineCoreStartInput } from "./cline-core/types";
import type {
	StartSessionInput,
	StartSessionResult,
} from "./runtime/host/runtime-host";

const { createRuntimeHostMock } = vi.hoisted(() => ({
	createRuntimeHostMock: vi.fn(),
}));

vi.mock("./runtime/host/host", () => ({
	createRuntimeHost: createRuntimeHostMock,
}));

import type { AgentResult } from "@cline/shared";
import { ClineCore } from "./ClineCore";
import { NoOpFeatureFlagsProvider } from "./services/feature-flags";

function createStartInput(): ClineCoreStartInput {
	return {
		config: {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: "test",
			cwd: "/tmp/workspace",
			workspaceRoot: "/tmp/workspace",
			systemPrompt: "You are concise.",
			mode: "act",
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
		},
		prompt: "hello",
		interactive: false,
	};
}

function createStartResult(sessionId: string): StartSessionResult {
	return {
		sessionId,
		manifest: {} as StartSessionResult["manifest"],
		manifestPath: `/tmp/${sessionId}.json`,
		messagesPath: `/tmp/${sessionId}.messages.json`,
	};
}

function createAgentResult(text: string): AgentResult {
	const now = new Date("2026-04-24T10:00:00.000Z");
	return {
		text,
		usage: {
			inputTokens: 1,
			outputTokens: 1,
		},
		messages: [],
		toolCalls: [],
		iterations: 1,
		finishReason: "completed",
		model: {
			id: "test-model",
			provider: "test-provider",
		},
		startedAt: now,
		endedAt: now,
		durationMs: 1,
	};
}

function git(cwd: string, args: string[]): string {
	return execFileSync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
	}).trim();
}

describe("ClineCore", () => {
	beforeEach(() => {
		createRuntimeHostMock.mockReset();
	});

	it("compares a checkpoint to the current workspace through the public SDK API", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-core-compare-"));
		let core: ClineCore | undefined;
		try {
			git(dir, ["init", "-b", "main"]);
			git(dir, ["config", "user.email", "test@example.com"]);
			git(dir, ["config", "user.name", "Test User"]);
			writeFileSync(join(dir, "tracked.txt"), "before\n", "utf8");
			git(dir, ["add", "."]);
			git(dir, ["commit", "-m", "initial"]);
			const checkpointRef = git(dir, ["rev-parse", "HEAD"]);
			writeFileSync(join(dir, "tracked.txt"), "after\n", "utf8");

			const host = {
				runtimeAddress: undefined,
				startSession: vi.fn(),
				runTurn: vi.fn(),
				restoreSession: vi.fn(),
				getAccumulatedUsage: vi.fn(),
				abort: vi.fn(),
				stopSession: vi.fn(),
				dispose: vi.fn(),
				getSession: vi.fn(async () => ({
					sessionId: "session-1",
					cwd: dir,
					workspaceRoot: dir,
					metadata: {
						checkpoint: {
							history: [
								{
									ref: checkpointRef,
									runCount: 1,
									createdAt: 1,
									kind: "commit",
								},
							],
						},
					},
				})),
				listSessions: vi.fn(),
				deleteSession: vi.fn(),
				updateSession: vi.fn(),
				readSessionMessages: vi.fn(),
				dispatchHookEvent: vi.fn(),
				subscribe: vi.fn(() => () => {}),
				updateSessionModel: vi.fn(),
			};
			createRuntimeHostMock.mockResolvedValue(host);

			core = await ClineCore.create();
			const result = await core.compareCheckpoint({
				sessionId: "session-1",
				checkpointRunCount: 1,
			});

			expect(host.getSession).toHaveBeenCalledWith("session-1");
			expect(result.checkpoint.ref).toBe(checkpointRef);
			expect(result.diffs).toEqual([
				{
					filePath: join(dir, "tracked.txt"),
					leftContent: "before\n",
					rightContent: "after\n",
				},
			]);
		} finally {
			await core?.dispose();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("applies start-session bootstraps before delegating to the host", async () => {
		const listeners: Array<
			(event: { type: string; payload: { sessionId: string } }) => void
		> = [];
		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(async (input: StartSessionInput) => {
				expect(input.config.systemPrompt).toBe("Bootstrapped prompt");
				expect(input.localRuntime?.extensions).toEqual([
					expect.objectContaining({ name: "enterprise" }),
				]);
				return createStartResult("session-1");
			}),
			runTurn: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(async () => undefined),
			listSessions: vi.fn(),
			deleteSession: vi.fn(),
			readSessionMessages: vi.fn(),
			subscribe: vi.fn((listener) => {
				listeners.push(listener);
				return () => {};
			}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

		const dispose = vi.fn(async () => {});
		const applyToStartSessionInput = vi.fn(
			async (input: ClineCoreStartInput) => ({
				...input,
				config: {
					...input.config,
					systemPrompt: "Bootstrapped prompt",
					extensions: [
						{
							name: "enterprise",
							manifest: { capabilities: [] },
							setup: vi.fn(),
						},
					],
				},
			}),
		);

		const core = await ClineCore.create({
			prepare: async () => ({
				applyToStartSessionInput,
				dispose,
			}),
		});

		await core.start(createStartInput());

		expect(applyToStartSessionInput).toHaveBeenCalledTimes(1);
		expect(host.startSession).toHaveBeenCalledTimes(1);
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(listeners).toHaveLength(1);
	});

	it("re-prepares a full config and replaces the active bootstrap on restart", async () => {
		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(async () => createStartResult("session-restart")),
			restartSession: vi.fn(async (input: StartSessionInput) => {
				expect(input.config).toMatchObject({
					sessionId: "session-restart",
					providerId: "openai-codex",
					modelId: "gpt-5.3-codex",
					systemPrompt: "prepared restart",
				});
				expect(input).not.toHaveProperty("prompt");
				expect(input).not.toHaveProperty("initialMessages");
				return createStartResult("session-restart");
			}),
			runTurn: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(async () => ({ sessionId: "session-restart" })),
			listSessions: vi.fn(),
			deleteSession: vi.fn(),
			readSessionMessages: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

		const initialDispose = vi.fn();
		const restartedDispose = vi.fn();
		let prepareCount = 0;
		const core = await ClineCore.create({
			prepare: async () => {
				const dispose =
					prepareCount++ === 0 ? initialDispose : restartedDispose;
				return {
					applyToStartSessionInput: (input) => ({
						...input,
						config: {
							...input.config,
							systemPrompt:
								input.config.providerId === "openai-codex"
									? "prepared restart"
									: input.config.systemPrompt,
						},
					}),
					dispose,
				};
			},
		});

		await core.start({ ...createStartInput(), interactive: true });
		const restarted = await core.restart({
			sessionId: "session-restart",
			config: {
				...createStartInput().config,
				providerId: "openai-codex",
				modelId: "gpt-5.3-codex",
			},
			interactive: true,
		});

		expect(restarted.sessionId).toBe("session-restart");
		expect(host.restartSession).toHaveBeenCalledTimes(1);
		expect(initialDispose).toHaveBeenCalledTimes(1);
		expect(restartedDispose).not.toHaveBeenCalled();

		await core.dispose();
		expect(restartedDispose).toHaveBeenCalledTimes(1);
	});

	it("disposes active session bootstraps when the session ends", async () => {
		let listener:
			| ((event: { type: string; payload: { sessionId: string } }) => void)
			| undefined;
		const host = {
			runtimeAddress: "127.0.0.1:5317",
			startSession: vi.fn(async () => createStartResult("session-2")),
			runTurn: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(async () => ({ sessionId: "session-2" })),
			listSessions: vi.fn(),
			deleteSession: vi.fn(),
			readSessionMessages: vi.fn(),
			subscribe: vi.fn((nextListener) => {
				listener = nextListener;
				return () => {};
			}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

		const dispose = vi.fn(async () => {});
		const core = await ClineCore.create({
			prepare: async () => ({
				applyToStartSessionInput: (input) => input,
				dispose,
			}),
		});
		expect(core.runtimeAddress).toBe("127.0.0.1:5317");

		await core.start(createStartInput());
		expect(dispose).not.toHaveBeenCalled();

		listener?.({ type: "ended", payload: { sessionId: "session-2" } });
		await Promise.resolve();

		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it("emits session.started telemetry when a new session is started", async () => {
		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(async () => createStartResult("session-telemetry")),
			runTurn: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(async () => undefined),
			listSessions: vi.fn(),
			deleteSession: vi.fn(),
			readSessionMessages: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

		const telemetry = {
			capture: vi.fn(),
			captureRequired: vi.fn(),
			setDistinctId: vi.fn(),
			setMetadata: vi.fn(),
			updateCommonProperties: vi.fn(),
			isEnabled: vi.fn(() => true),
			recordCounter: vi.fn(),
			recordHistogram: vi.fn(),
			recordGauge: vi.fn(),
			flush: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
		};

		const core = await ClineCore.create({
			backendMode: "local",
			clientName: "unit-test-client",
			telemetry: telemetry as never,
		});
		await core.start(createStartInput());

		expect(telemetry.capture).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "session.started",
				properties: expect.objectContaining({
					sessionId: "session-telemetry",
					source: "core",
					providerId: "anthropic",
					modelId: "claude-sonnet-4-6",
					enableTools: true,
					enableSpawnAgent: false,
					enableAgentTeams: false,
					clientName: "unit-test-client",
				}),
			}),
		);
	});

	it("merges instance and per-start runtime capabilities", async () => {
		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(async (_input: StartSessionInput) =>
				createStartResult("session-capabilities"),
			),
			runTurn: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(async () => undefined),
			listSessions: vi.fn(),
			deleteSession: vi.fn(),
			readSessionMessages: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);
		const askQuestion = vi.fn(async () => "yes");
		const submit = vi.fn(async () => "submitted");
		const requestToolApproval = vi.fn(async () => ({ approved: true }));

		const core = await ClineCore.create({
			capabilities: {
				toolExecutors: { askQuestion },
				requestToolApproval,
			},
		});

		await core.start({
			...createStartInput(),
			capabilities: {
				toolExecutors: { submit },
			},
		});

		const startInput = vi.mocked(host.startSession).mock.calls.at(-1)?.[0] as
			| StartSessionInput
			| undefined;
		expect(startInput).toBeDefined();
		if (!startInput) throw new Error("Expected host.startSession to be called");
		expect(startInput.capabilities?.toolExecutors).toMatchObject({
			askQuestion,
			submit,
		});
		expect(startInput.capabilities?.requestToolApproval).toBe(
			requestToolApproval,
		);
	});

	it("normalizes config extension context into local runtime before delegating to the host", async () => {
		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(async (_input: StartSessionInput) =>
				createStartResult("session-extension-context"),
			),
			runTurn: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(async () => undefined),
			listSessions: vi.fn(),
			deleteSession: vi.fn(),
			readSessionMessages: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

		const onTeamRestored = vi.fn();
		const clientContext = {
			name: "VSCode Extension",
			version: "3.27.0",
			platform: "Visual Studio Code",
			platformVersion: "1.102.3",
			isMultiRoot: true,
		};
		const core = await ClineCore.create();

		await core.start({
			...createStartInput(),
			config: {
				...createStartInput().config,
				extensionContext: {
					client: clientContext,
				},
			},
			localRuntime: {
				onTeamRestored,
			},
		});

		const startInput = vi.mocked(host.startSession).mock.calls.at(-1)?.[0] as
			| StartSessionInput
			| undefined;
		expect(startInput).toBeDefined();
		if (!startInput) throw new Error("Expected host.startSession to be called");
		expect(startInput.config).not.toHaveProperty("extensionContext");
		expect(startInput.localRuntime?.extensionContext?.client).toEqual(
			clientContext,
		);
		expect(startInput.localRuntime?.onTeamRestored).toBe(onTeamRestored);
	});

	it("prefers the per-session telemetry service over the ClineCore one", async () => {
		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(async () => createStartResult("session-override")),
			runTurn: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(async () => undefined),
			listSessions: vi.fn(),
			deleteSession: vi.fn(),
			readSessionMessages: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

		const coreTelemetry = {
			capture: vi.fn(),
			setDistinctId: vi.fn(),
			updateCommonProperties: vi.fn(),
			isEnabled: vi.fn(() => true),
		};
		const sessionTelemetry = {
			capture: vi.fn(),
			setDistinctId: vi.fn(),
			updateCommonProperties: vi.fn(),
			isEnabled: vi.fn(() => true),
		};

		const core = await ClineCore.create({
			backendMode: "local",
			telemetry: coreTelemetry as never,
		});
		const input = createStartInput();
		input.config.telemetry = sessionTelemetry as never;
		await core.start(input);

		expect(sessionTelemetry.capture).toHaveBeenCalledWith(
			expect.objectContaining({ event: "session.started" }),
		);
		expect(coreTelemetry.capture).not.toHaveBeenCalled();
	});

	it("uses a no-op feature flags provider by default", async () => {
		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(),
			runTurn: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(async () => undefined),
			listSessions: vi.fn(),
			deleteSession: vi.fn(),
			readSessionMessages: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

		const core = await ClineCore.create();

		expect(core.featureFlags.getProvider()).toBeInstanceOf(
			NoOpFeatureFlagsProvider,
		);
		await core.dispose();
		expect(host.dispose).toHaveBeenCalledTimes(1);
	});

	it("hydrates list rows through the core API", async () => {
		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(),
			runTurn: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(async () => undefined),
			listSessions: vi.fn(async () => [
				{
					sessionId: "session-3",
					source: "cli",
					pid: 1,
					startedAt: "2026-04-21T02:17:46.169Z",
					status: "completed",
					interactive: false,
					provider: "",
					model: "",
					cwd: "/tmp/workspace",
					workspaceRoot: "/tmp/workspace",
					enableTools: true,
					enableSpawn: false,
					enableTeams: false,
					prompt: "hello",
					metadata: {},
					updatedAt: "2026-04-21T02:17:46.169Z",
				},
			]),
			deleteSession: vi.fn(),
			updateSession: vi.fn(),
			readSessionMessages: vi.fn(async () => [
				{
					role: "user",
					content: [{ type: "text", text: "hello" }],
				},
				{
					role: "assistant",
					content: [{ type: "text", text: "hi" }],
					modelInfo: {
						provider: "cline",
						id: "anthropic/claude-sonnet-4.6",
					},
					metrics: {
						cost: 0.02,
					},
				},
			]),
			dispatchHookEvent: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

		const core = await ClineCore.create();
		const [row] = await core.list(10);

		expect(host.listSessions).toHaveBeenCalledWith(20);
		expect(host.readSessionMessages).toHaveBeenCalledWith("session-3");
		expect(row).toMatchObject({
			sessionId: "session-3",
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
			metadata: {
				title: "hello",
				totalCost: 0.02,
			},
		});
	});

	it("can list sessions without hydrating message history", async () => {
		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(),
			runTurn: vi.fn(),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(),
			listSessions: vi.fn(async () => [
				{
					sessionId: "session-lightweight",
					source: "core",
					pid: 1,
					startedAt: "2026-04-21T02:17:46.169Z",
					status: "completed",
					interactive: false,
					provider: "cline",
					model: "anthropic/claude-sonnet-4.6",
					cwd: "/tmp/workspace",
					workspaceRoot: "/tmp/workspace",
					enableTools: true,
					enableSpawn: false,
					enableTeams: false,
					isSubagent: false,
					metadata: { title: "stored title" },
					updatedAt: "2026-04-21T02:17:46.169Z",
				},
			]),
			deleteSession: vi.fn(),
			updateSession: vi.fn(),
			readSessionMessages: vi.fn(),
			dispatchHookEvent: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

		const core = await ClineCore.create();
		const [row] = await core.list(10, { hydrate: false });

		// Hydration and default root-session filtering are consumed by
		// ClineCore/listSessionHistory; the host list contract only receives the
		// numeric scan limit.
		expect(host.listSessions.mock.calls).toEqual([[20]]);
		expect(host.readSessionMessages).not.toHaveBeenCalled();
		expect(row).toMatchObject({
			sessionId: "session-lightweight",
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
			metadata: { title: "stored title" },
		});
	});

	it("exposes event automation through ClineCore instead of CronService", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-core-automation-"));
		const cronDir = join(root, ".cline", "cron");
		const reportsDir = join(cronDir, "reports");
		const dbPath = join(root, ".cline", "data", "db", "cron.db");
		mkdirSync(join(cronDir, "events"), { recursive: true });
		writeFileSync(
			join(cronDir, "events", "local.event.md"),
			`---
id: local-test
title: Local Test
workspaceRoot: ${root}
event: local.manual_test
filters:
  topic: cron-feature-2
---
Summarize the local event.
`,
			"utf8",
		);

		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(async () => createStartResult("automation-session")),
			runTurn: vi.fn(async () => createAgentResult("automation complete")),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(async () => undefined),
			listSessions: vi.fn(),
			deleteSession: vi.fn(),
			updateSession: vi.fn(),
			readSessionMessages: vi.fn(),
			dispatchHookEvent: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

		try {
			const core = await ClineCore.create({
				automation: {
					cronDir,
					reportsDir,
					dbPath,
					autoStart: false,
					pollIntervalMs: 10_000,
				},
			});
			await core.automation.reconcileNow();
			const result = core.automation.ingestEvent({
				eventId: "evt_local_1",
				eventType: "local.manual_test",
				source: "local",
				subject: "manual smoke test",
				occurredAt: "2026-04-24T10:00:00.000Z",
				attributes: { topic: "cron-feature-2" },
			});

			expect(result.matchedSpecIds).toHaveLength(1);
			expect(result.queuedRuns).toHaveLength(1);

			await core.automation.start();
			await core.automation.stop();
			await core.dispose();

			expect(host.startSession).toHaveBeenCalledTimes(1);
			expect(host.runTurn).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId: "automation-session",
					prompt: expect.stringContaining("Trigger event:"),
				}),
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("delegates restore to the runtime host", async () => {
		const restoreResult = {
			sessionId: "restored-session",
			startResult: createStartResult("restored-session"),
			messages: [
				{ role: "user" as const, content: "first" },
				{ role: "assistant" as const, content: "first response" },
				{ role: "user" as const, content: "second" },
			],
			checkpoint: {
				ref: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				createdAt: 2,
				runCount: 2,
				kind: "commit" as const,
			},
		};
		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(async () => createStartResult("restored-session")),
			runTurn: vi.fn(),
			restoreSession: vi.fn(async () => restoreResult),
			getAccumulatedUsage: vi.fn(),
			abort: vi.fn(),
			stopSession: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(),
			listSessions: vi.fn(),
			deleteSession: vi.fn(),
			updateSession: vi.fn(),
			readSessionMessages: vi.fn(),
			dispatchHookEvent: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			updateSessionModel: vi.fn(),
		};
		createRuntimeHostMock.mockResolvedValue(host);

		const core = await ClineCore.create();
		const result = await core.restore({
			sessionId: "source-session",
			checkpointRunCount: 2,
			restore: {
				messages: true,
				workspace: false,
				omitCheckpointMessageFromSession: true,
			},
			start: createStartInput(),
		});

		expect(host.restoreSession).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "source-session",
				checkpointRunCount: 2,
				restore: {
					messages: true,
					workspace: false,
					omitCheckpointMessageFromSession: true,
				},
				start: expect.objectContaining({
					config: expect.objectContaining({
						providerId: "anthropic",
						modelId: "claude-sonnet-4-6",
					}),
				}),
			}),
		);
		expect(result.messages).toEqual(restoreResult.messages);
		expect(result.sessionId).toBe("restored-session");
	});
});
