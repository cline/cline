import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BedrockCoderCoreStartInput } from "./bedrock-coder-core/types";
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

import { BedrockCoderCore } from "./BedrockCoderCore";

function createStartInput(): BedrockCoderCoreStartInput {
	return {
		config: {
			providerId: "bedrock",
			modelId: "claude-sonnet-4-6",
			providerConfig: {
				providerId: "bedrock",
				modelId: "claude-sonnet-4-6",
				connection: { region: "us-east-1" },
			},
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

function git(cwd: string, args: string[]): string {
	return execFileSync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
	}).trim();
}

describe("BedrockCoderCore", () => {
	beforeEach(() => {
		createRuntimeHostMock.mockReset();
	});

	it("compares a checkpoint to the current workspace through the public SDK API", async () => {
		const dir = mkdtempSync(join(tmpdir(), "bedrock-coder-core-compare-"));
		let core: BedrockCoderCore | undefined;
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

			core = await BedrockCoderCore.create();
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
			async (input: BedrockCoderCoreStartInput) => ({
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

		const core = await BedrockCoderCore.create({
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

	it("preserves an omitted workspace until the execution host resolves it", async () => {
		const host = {
			runtimeAddress: undefined,
			startSession: vi.fn(async (_input: StartSessionInput) =>
				createStartResult("session-pathless"),
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
		const core = await BedrockCoderCore.create();

		await core.start({
			config: {
				providerId: "bedrock",
				modelId: "claude-sonnet-4-6",
				providerConfig: {
					providerId: "bedrock",
					modelId: "claude-sonnet-4-6",
					connection: { region: "us-east-1" },
				},
				systemPrompt: "You are concise.",
				mode: "act",
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		});

		expect(host.startSession).toHaveBeenCalledTimes(1);
		const forwarded = host.startSession.mock.calls[0]?.[0];
		expect(forwarded?.config).not.toHaveProperty("cwd");
		expect(forwarded?.config).not.toHaveProperty("workspaceRoot");
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
		const core = await BedrockCoderCore.create({
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

		const core = await BedrockCoderCore.create({
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
		const core = await BedrockCoderCore.create();

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
						provider: "bedrockCoder",
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

		const core = await BedrockCoderCore.create();
		const [row] = await core.list(10);

		expect(host.listSessions).toHaveBeenCalledWith(20);
		expect(host.readSessionMessages).toHaveBeenCalledWith("session-3");
		expect(row).toMatchObject({
			sessionId: "session-3",
			provider: "bedrockCoder",
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
					provider: "bedrockCoder",
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

		const core = await BedrockCoderCore.create();
		const [row] = await core.list(10, { hydrate: false });

		// Hydration and default root-session filtering are consumed by
		// BedrockCoderCore/listSessionHistory; the host list contract only receives the
		// numeric scan limit.
		expect(host.listSessions.mock.calls).toEqual([[20]]);
		expect(host.readSessionMessages).not.toHaveBeenCalled();
		expect(row).toMatchObject({
			sessionId: "session-lightweight",
			provider: "bedrockCoder",
			model: "anthropic/claude-sonnet-4.6",
			metadata: { title: "stored title" },
		});
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

		const core = await BedrockCoderCore.create();
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
						providerId: "bedrock",
						modelId: "claude-sonnet-4-6",
					}),
				}),
			}),
		);
		expect(result.messages).toEqual(restoreResult.messages);
		expect(result.sessionId).toBe("restored-session");
	});
});
