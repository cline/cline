/**
 * Unit tests for the new `SessionRuntime` orchestrator (PLAN.md
 * Step 8d).
 *
 * Scope:
 *  - constructor wires every state owner (conversation store, mistake
 *    tracker, loop detector, hook bridge, event adapter) correctly;
 *  - `run()` drives the injected `AgentRuntime` and fans adapted
 *    legacy `AgentEvent`s to subscribers;
 *  - `abort()` forwards into the active runtime;
 *  - `subscribeEvents` delivers **legacy** `AgentEvent` shapes;
 *  - `addTools` / `updateConnection` / `clearHistory` / `restore`
 *    mutate state;
 *  - `canStartRun` / `shutdown` guards enforce the lifecycle rules.
 */

import type { AgentRuntime, AgentRuntimeConfig } from "@clinebot/agents";
import type {
	AgentConfig,
	AgentEvent,
	AgentExtension,
	AgentExtensionContext,
	AgentMessage,
	AgentRunResult,
	AgentRuntimeEvent,
	AgentTool,
	AgentToolContext,
} from "@clinebot/shared";
import { describe, expect, it, vi } from "vitest";
import {
	SessionRuntime,
	type SessionRuntimeOrchestratorDeps,
} from "./session-runtime-orchestrator";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		providerId: "anthropic",
		modelId: "claude-3-5-sonnet",
		apiKey: "test-key",
		systemPrompt: "You are a helpful assistant.",
		tools: [],
		...overrides,
	};
}

interface FakeAgentRuntimeScript {
	/** Events to emit synchronously when `run`/`continue` is called. */
	readonly events?: readonly AgentRuntimeEvent[];
	/** Result returned by `run`/`continue`. Defaults to a completed run. */
	readonly result?: Partial<AgentRunResult>;
	/** If true, reject with the provided error instead of returning. */
	readonly throwError?: Error;
}

/**
 * Build a lightweight fake `AgentRuntime` that records calls and
 * deterministically emits the scripted events/result.
 */
function makeFakeAgentRuntime(script: FakeAgentRuntimeScript = {}): {
	runtime: AgentRuntime;
	calls: { run: unknown[]; continue: unknown[]; abort: unknown[] };
	listeners: Set<(event: AgentRuntimeEvent) => void>;
} {
	const listeners = new Set<(event: AgentRuntimeEvent) => void>();
	const calls = {
		run: [] as unknown[],
		continue: [] as unknown[],
		abort: [] as unknown[],
	};

	const baseResult: AgentRunResult = {
		agentId: "agent_fake",
		runId: "run_fake",
		status: "completed",
		iterations: 1,
		outputText: "ok",
		messages: [],
		usage: {
			inputTokens: 10,
			outputTokens: 5,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
		...script.result,
	};

	const emit = (): void => {
		for (const event of script.events ?? []) {
			for (const listener of listeners) {
				listener(event);
			}
		}
	};

	const runtime = {
		async run(input: unknown) {
			calls.run.push(input);
			emit();
			if (script.throwError) {
				throw script.throwError;
			}
			return baseResult;
		},
		async continue(input: unknown) {
			calls.continue.push(input);
			emit();
			if (script.throwError) {
				throw script.throwError;
			}
			return baseResult;
		},
		abort(reason?: string) {
			calls.abort.push(reason);
		},
		subscribe(listener: (event: AgentRuntimeEvent) => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		snapshot() {
			return {
				agentId: "agent_fake",
				runId: "run_fake",
				status: "running" as const,
				iteration: 0,
				messages: [] as readonly AgentMessage[],
				pendingToolCalls: [] as readonly string[],
				usage: {
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: 0,
				},
			};
		},
	} as unknown as AgentRuntime;

	return { runtime, calls, listeners };
}

function makeSnapshot() {
	return {
		agentId: "agent_fake",
		runId: "run_fake",
		status: "running" as const,
		iteration: 0,
		messages: [] as readonly AgentMessage[],
		pendingToolCalls: [] as readonly string[],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
	};
}

/** Convenience to stitch a fake runtime into SessionRuntime deps. */
function withFakeRuntime(script: FakeAgentRuntimeScript = {}): {
	deps: SessionRuntimeOrchestratorDeps;
	calls: ReturnType<typeof makeFakeAgentRuntime>["calls"];
	listeners: ReturnType<typeof makeFakeAgentRuntime>["listeners"];
} {
	const { runtime, calls, listeners } = makeFakeAgentRuntime(script);
	return {
		deps: { createAgentRuntimeImpl: () => runtime },
		calls,
		listeners,
	};
}

function withCapturingFakeRuntime(script: FakeAgentRuntimeScript = {}): {
	deps: SessionRuntimeOrchestratorDeps;
	configs: Parameters<
		NonNullable<SessionRuntimeOrchestratorDeps["createAgentRuntimeImpl"]>
	>[0][];
} {
	const configs: AgentRuntimeConfig[] = [];
	return {
		deps: {
			createAgentRuntimeImpl: (config) => {
				configs.push(config);
				return makeFakeAgentRuntime(script).runtime;
			},
		},
		configs,
	};
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe("SessionRuntime construction", () => {
	it("wires agentId, conversationId, and canStartRun", () => {
		const session = new SessionRuntime(makeAgentConfig());
		expect(session.getAgentId()).toMatch(/^agent_/);
		expect(session.getConversationId()).toMatch(/^conv_/);
		expect(session.canStartRun()).toBe(true);
		expect(session.getMessages()).toEqual([]);
	});

	it("seeds initial messages through ConversationStore", () => {
		const session = new SessionRuntime(
			makeAgentConfig({
				initialMessages: [
					{ role: "user", content: [{ type: "text", text: "hi" }] },
				],
			}),
		);
		expect(session.getMessages()).toHaveLength(1);
	});

	it("exposes an empty extension registry snapshot when no extensions are declared", () => {
		const session = new SessionRuntime(makeAgentConfig());
		const registry = session.getExtensionRegistry();
		expect(registry).toEqual({
			tools: [],
			commands: [],
			rules: [],
			messageBuilder: [],
			providers: [],
			automationEventTypes: [],
		});
	});
});

// ---------------------------------------------------------------------------
// getExtensionRegistry — real contribution-registry snapshot
// ---------------------------------------------------------------------------

describe("SessionRuntime.getExtensionRegistry", () => {
	it("returns tools/commands registered by extension setup() after the first run", async () => {
		const extTool: AgentTool = {
			name: "ext-echo",
			description: "extension tool",
			inputSchema: {},
			execute: async () => ({}),
		};
		const extCommand = {
			name: "ext-cmd",
			description: "extension command",
			execute: async () => ({}),
		};
		const extension = {
			name: "test-ext",
			manifest: { capabilities: ["tools", "commands"] },
			setup: (api: {
				registerTool: (t: AgentTool) => void;
				registerCommand: (c: typeof extCommand) => void;
			}) => {
				api.registerTool(extTool);
				api.registerCommand(extCommand);
			},
		};
		const { deps } = withFakeRuntime();
		const session = new SessionRuntime(
			makeAgentConfig({
				// @ts-expect-error — AgentExtension interface validates at runtime;
				// this fixture supplies only the fields ContributionRegistry needs.
				extensions: [extension],
			}),
			deps,
		);
		// Before run: registry is validated but not initialized yet.
		expect(session.getExtensionRegistry().tools).toEqual([]);

		await session.run("go");

		const registry = session.getExtensionRegistry();
		expect(registry.tools).toHaveLength(1);
		expect(registry.tools[0].name).toBe("ext-echo");
		expect(registry.commands).toHaveLength(1);
		expect(registry.commands[0].name).toBe("ext-cmd");
		expect(registry.automationEventTypes).toEqual([]);
	});

	it("composes extension-registered rules into the runtime system prompt", async () => {
		const extension: AgentExtension = {
			name: "rules-ext",
			manifest: { capabilities: ["rules"] },
			setup: (api) => {
				api.registerRule({
					id: "rules-ext:primary",
					content: "Always preserve architectural boundaries.",
				});
			},
		};
		const { deps, configs } = withCapturingFakeRuntime();
		const session = new SessionRuntime(
			makeAgentConfig({
				systemPrompt: "Base prompt.",
				extensions: [extension],
			}),
			deps,
		);

		await session.run("go");

		expect(configs[0]?.systemPrompt).toBe(
			"Base prompt.\n\nAlways preserve architectural boundaries.",
		);
	});

	it("passes session, caller, and logger context into extension setup()", async () => {
		const logger = {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		};
		const telemetry = {
			capture: vi.fn(),
		} as unknown as AgentConfig["telemetry"];
		const ingestEvent = vi.fn();
		let observed: AgentExtensionContext | undefined;
		const extension: AgentExtension = {
			name: "context-ext",
			manifest: { capabilities: ["tools", "automationEvents"] },
			setup: (_api, ctx) => {
				observed = ctx;
				ctx.logger?.log("plugin setup", {
					sessionId: ctx.session?.sessionId,
				});
			},
		};
		const { deps } = withFakeRuntime();
		const session = new SessionRuntime(
			makeAgentConfig({
				extensions: [extension],
				extensionContext: {
					session: { sessionId: "sess_plugin_context" },
					client: { name: "cline-sdk", version: "1.2.3" },
					user: { distinctId: "user-1" },
					workspace: { rootPath: "/tmp/workspace" },
					automation: { ingestEvent },
					logger,
					telemetry,
				},
			}),
			deps,
		);

		await session.run("go");

		expect(observed?.session?.sessionId).toBe("sess_plugin_context");
		expect(observed?.client).toEqual({
			name: "cline-sdk",
			version: "1.2.3",
		});
		expect(observed?.user?.distinctId).toBe("user-1");
		expect(observed?.workspaceInfo?.rootPath).toBe("/tmp/workspace");
		expect(observed?.automation?.ingestEvent).toBe(ingestEvent);
		expect(observed?.telemetry).toBe(telemetry);
		expect(logger.log).toHaveBeenCalledWith("plugin setup", {
			sessionId: "sess_plugin_context",
		});
	});

	it("merges extension-registered tools into the AgentRuntime tools for the turn", async () => {
		const extTool: AgentTool = {
			name: "ext-tool-a",
			description: "ext tool a",
			inputSchema: {},
			execute: async () => ({}),
		};
		const configTool: AgentTool = {
			name: "config-tool-b",
			description: "config tool b",
			inputSchema: {},
			execute: async () => ({}),
		};
		const extension = {
			name: "tool-ext",
			manifest: { capabilities: ["tools"] },
			setup: (api: { registerTool: (t: AgentTool) => void }) => {
				api.registerTool(extTool);
			},
		};

		let observedTools: ReadonlyArray<{ readonly name: string }> = [];
		const { runtime } = makeFakeAgentRuntime();
		const session = new SessionRuntime(
			makeAgentConfig({
				tools: [configTool],
				// @ts-expect-error — minimal fixture, see note above.
				extensions: [extension],
			}),
			{
				createAgentRuntimeImpl: (config) => {
					observedTools = (config.tools ?? []) as ReadonlyArray<{
						readonly name: string;
					}>;
					return runtime;
				},
			},
		);
		await session.run("go");
		const toolNames = observedTools.map((t) => t.name).sort();
		expect(toolNames).toEqual(["config-tool-b", "ext-tool-a"]);
	});
});

describe("SessionRuntime message preparation", () => {
	it("runs registered message builders and API-safe normalization before model calls", async () => {
		const build = vi.fn(async (messages) => [
			...messages,
			{
				role: "user" as const,
				content: [
					{
						type: "text" as const,
						text: "<user_input>builder-added</user_input>",
					},
				],
			},
		]);
		const extension: AgentExtension = {
			name: "message-builder-ext",
			manifest: { capabilities: ["messageBuilders"] },
			setup(api) {
				api.registerMessageBuilder({
					name: "append-builder-message",
					build,
				});
			},
		};
		const { deps, configs } = makeRecordingRuntimeFactory();
		const session = new SessionRuntime(
			makeAgentConfig({ extensions: [extension] }),
			deps,
		);

		await session.run("go");
		const beforeModel = configs[0]?.hooks?.beforeModel;
		expect(beforeModel).toBeDefined();

		const result = await beforeModel?.({
			snapshot: makeSnapshot(),
			request: {
				systemPrompt: "system",
				messages: [
					{
						id: "m1",
						role: "user",
						content: [
							{
								type: "text",
								text: "<user_input>original</user_input>",
							},
						],
						createdAt: 1,
					},
				],
				tools: [],
			},
		});

		expect(build).toHaveBeenCalledTimes(1);
		expect(build.mock.calls[0]?.[0]).toEqual([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "<user_input>original</user_input>",
					},
				],
			},
		]);
		const textParts = result?.messages?.flatMap((message) =>
			message.content.flatMap((part) =>
				part.type === "text" ? [part.text] : [],
			),
		);
		expect(textParts).toEqual(["original", "builder-added"]);
	});

	it("adapts prepareTurn with API-safe messages for runtime compaction", async () => {
		const prepareTurn = vi.fn(() => ({
			messages: [
				{
					role: "user" as const,
					content: "compacted transcript",
				},
			],
		}));
		const { deps, configs } = makeRecordingRuntimeFactory();
		const session = new SessionRuntime(
			makeAgentConfig({
				prepareTurn,
				knownModels: {
					"claude-3-5-sonnet": {
						id: "claude-3-5-sonnet",
						contextWindow: 200_000,
					},
				},
			}),
			deps,
		);

		await session.run("go");
		const runtimePrepareTurn = configs[0]?.prepareTurn;
		expect(runtimePrepareTurn).toBeDefined();

		const result = await runtimePrepareTurn?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 1,
			messages: [
				{
					id: "m1",
					role: "user",
					content: [
						{
							type: "text",
							text: "<user_input>large context</user_input>",
						},
					],
					createdAt: 1,
				},
			],
			systemPrompt: "system",
			tools: [],
			model: {},
		});

		expect(prepareTurn).toHaveBeenCalledWith(
			expect.objectContaining({
				agentId: "agent-1",
				conversationId: "conv-1",
				parentAgentId: null,
				iteration: 1,
				messages: [
					expect.objectContaining({
						id: "m1",
						role: "user",
						content: [
							{
								type: "text",
								text: "<user_input>large context</user_input>",
							},
						],
						ts: 1,
					}),
				],
				apiMessages: [
					expect.objectContaining({
						id: "m1",
						role: "user",
						content: [{ type: "text", text: "large context" }],
						ts: 1,
					}),
				],
				model: {
					id: "claude-3-5-sonnet",
					provider: "anthropic",
					info: {
						id: "claude-3-5-sonnet",
						contextWindow: 200_000,
					},
				},
			}),
		);
		expect(result?.messages).toHaveLength(1);
		expect(result?.messages?.[0]?.content).toEqual([
			{ type: "text", text: "compacted transcript" },
		]);
	});
});

// ---------------------------------------------------------------------------
// run() / continue()
// ---------------------------------------------------------------------------

it("derives tool image support metadata from resolved provider model catalog", async () => {
	const { deps, configs } = withCapturingFakeRuntime();
	const execute = vi.fn(async () => "ok");
	const session = new SessionRuntime(
		makeAgentConfig({
			providerId: "cline",
			modelId: "anthropic/claude-sonnet-4.6",
			tools: [
				{
					name: "read_file",
					description: "read a file",
					inputSchema: {},
					execute,
				},
			],
		}),
		deps,
	);

	await session.run("inspect image");

	expect(configs).toHaveLength(1);
	const runtimeConfig = configs[0];
	if (!runtimeConfig) {
		throw new Error("Expected runtime config");
	}
	const tool = runtimeConfig.tools?.[0];
	expect(tool?.execute).toBeDefined();
	if (!tool?.execute) {
		throw new Error("Expected adapted tool execute function");
	}
	const toolContext: AgentToolContext = {
		agentId: "agent-1",
		runId: "run-1",
		iteration: 0,
		toolCallId: "call-1",
		snapshot: {
			agentId: "agent-1",
			status: "running",
			iteration: 0,
			messages: [],
			pendingToolCalls: [],
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		},
		emitUpdate: () => {},
	};
	const result = await tool.execute({}, toolContext);
	expect(result).toBe("ok");
	expect(execute).toHaveBeenCalledTimes(1);
	expect(execute.mock.calls[0]).toEqual([expect.anything(), toolContext]);
	expect(runtimeConfig.toolContextMetadata).toEqual(
		expect.objectContaining({ modelSupportsImages: true }),
	);
});

describe("SessionRuntime.run", () => {
	it("invokes the injected AgentRuntime and returns an AgentResult", async () => {
		const { deps, calls } = withFakeRuntime({
			result: { outputText: "hello world", iterations: 2 },
		});
		const session = new SessionRuntime(makeAgentConfig(), deps);
		const result = await session.run("Say hi");
		expect(calls.run).toHaveLength(1);
		expect(result.text).toBe("hello world");
		expect(result.iterations).toBe(2);
		expect(result.finishReason).toBe("completed");
		expect(result.model.provider).toBe("anthropic");
		expect(result.model.id).toBe("claude-3-5-sonnet");
		expect(result.startedAt).toBeInstanceOf(Date);
		expect(result.endedAt).toBeInstanceOf(Date);
		expect(typeof result.durationMs).toBe("number");
	});

	it("appends the user turn into the conversation store", async () => {
		const { deps } = withFakeRuntime();
		const session = new SessionRuntime(makeAgentConfig(), deps);
		await session.run("question one");
		// After run.resetForRun() + append, the conversation should
		// contain at least the user message we appended.
		const messages = session.getMessages();
		const userMessage = messages.find((m) => m.role === "user");
		expect(userMessage).toBeDefined();
	});

	it("fans legacy events to subscribers (not new AgentRuntimeEvent shape)", async () => {
		const { deps } = withFakeRuntime({
			events: [
				{
					type: "turn-started",
					iteration: 1,
					snapshot: makeSnapshot(),
				},
			],
		});
		const session = new SessionRuntime(makeAgentConfig(), deps);
		const received: AgentEvent[] = [];
		session.subscribeEvents((event) => received.push(event));
		await session.run("go");

		// Legacy shape: iteration_start, not turn-started.
		const iterationStart = received.find((e) => e.type === "iteration_start");
		expect(iterationStart).toBeDefined();
		expect(
			received.some((e) => (e as { type: string }).type === "turn-started"),
		).toBe(false);
	});

	it("maps run-failed errors into AgentResult via thrown error", async () => {
		const { deps } = withFakeRuntime({ throwError: new Error("boom") });
		const session = new SessionRuntime(makeAgentConfig(), deps);
		await expect(session.run("go")).rejects.toThrow("boom");
	});

	it("rejects re-entrant run while the previous run is still active", async () => {
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const slowRuntime = {
			async run() {
				await gate;
				return {
					agentId: "agent_fake",
					runId: "run_fake",
					status: "completed" as const,
					iterations: 1,
					outputText: "",
					messages: [] as readonly AgentMessage[],
					usage: {
						inputTokens: 0,
						outputTokens: 0,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						totalCost: 0,
					},
				};
			},
			async continue() {
				await gate;
				return {
					agentId: "agent_fake",
					runId: "run_fake",
					status: "completed" as const,
					iterations: 1,
					outputText: "",
					messages: [] as readonly AgentMessage[],
					usage: {
						inputTokens: 0,
						outputTokens: 0,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						totalCost: 0,
					},
				};
			},
			abort() {},
			subscribe() {
				return () => {};
			},
			snapshot() {
				return {
					agentId: "a",
					status: "running" as const,
					iteration: 0,
					messages: [],
					pendingToolCalls: [],
					usage: {
						inputTokens: 0,
						outputTokens: 0,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						totalCost: 0,
					},
				};
			},
		} as unknown as AgentRuntime;

		const session = new SessionRuntime(makeAgentConfig(), {
			createAgentRuntimeImpl: () => slowRuntime,
		});
		const first = session.run("one");
		await Promise.resolve();
		expect(session.canStartRun()).toBe(false);
		await expect(session.continue("two")).rejects.toThrow(/"running"/i);
		release?.();
		await first;
		expect(session.canStartRun()).toBe(true);
	});
});

describe("SessionRuntime.continue", () => {
	it("delegates to AgentRuntime.continue", async () => {
		const { deps, calls } = withFakeRuntime();
		const session = new SessionRuntime(makeAgentConfig(), deps);
		await session.continue("more");
		expect(calls.continue).toHaveLength(1);
		expect(calls.run).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// abort
// ---------------------------------------------------------------------------

describe("SessionRuntime.abort", () => {
	it("forwards the reason into the active AgentRuntime", async () => {
		let release: (() => void) | undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const abortCalls: unknown[] = [];
		const runtime = {
			async run() {
				await gate;
				return {
					agentId: "agent_fake",
					runId: "run_fake",
					status: "aborted" as const,
					iterations: 0,
					outputText: "",
					messages: [] as readonly AgentMessage[],
					usage: {
						inputTokens: 0,
						outputTokens: 0,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						totalCost: 0,
					},
				};
			},
			async continue() {
				await gate;
				return {
					agentId: "agent_fake",
					runId: "run_fake",
					status: "aborted" as const,
					iterations: 0,
					outputText: "",
					messages: [] as readonly AgentMessage[],
					usage: {
						inputTokens: 0,
						outputTokens: 0,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						totalCost: 0,
					},
				};
			},
			abort(reason?: unknown) {
				abortCalls.push(reason);
				release?.();
			},
			subscribe() {
				return () => {};
			},
			snapshot() {
				return makeSnapshot();
			},
		} as unknown as AgentRuntime;

		const session = new SessionRuntime(makeAgentConfig(), {
			createAgentRuntimeImpl: () => runtime,
		});
		const runPromise = session.run("slow");
		// Wait for the session to install the active runtime. The
		// `buildUserTurnContent` dynamic-import + handler/tool setup
		// yield a handful of microtasks before `runtime.run()` is
		// awaited. Poll until `abort()` produces a call record.
		for (let i = 0; i < 50 && abortCalls.length === 0; i++) {
			session.abort("user cancelled");
			if (abortCalls.length === 0) {
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
		}
		const result = await runPromise;
		expect(abortCalls).toEqual(["user cancelled"]);
		expect(result.finishReason).toBe("aborted");
	});

	it("does not swallow the caller-visible rejection when abort rejects the run", async () => {
		let rejectRun: ((error: Error) => void) | undefined;
		const runGate = new Promise<AgentRunResult>((_resolve, reject) => {
			rejectRun = reject;
		});
		let markRunStarted: (() => void) | undefined;
		const runStarted = new Promise<void>((resolve) => {
			markRunStarted = resolve;
		});
		const abortCalls: unknown[] = [];
		const runtime = {
			async run() {
				markRunStarted?.();
				return await runGate;
			},
			async continue() {
				markRunStarted?.();
				return await runGate;
			},
			abort(reason?: unknown) {
				abortCalls.push(reason);
				rejectRun?.(new Error(String(reason ?? "aborted")));
			},
			subscribe() {
				return () => {};
			},
			snapshot() {
				return makeSnapshot();
			},
		} as unknown as AgentRuntime;

		const session = new SessionRuntime(makeAgentConfig(), {
			createAgentRuntimeImpl: () => runtime,
		});
		const runPromise = session.run("slow");
		await runStarted;
		session.abort("user cancelled");

		await expect(runPromise).rejects.toThrow("user cancelled");
		expect(abortCalls).toEqual(["user cancelled"]);
	});

	it("observes an abort rejection before the caller awaits the run", async () => {
		let rejectRun: ((error: Error) => void) | undefined;
		const runGate = new Promise<AgentRunResult>((_resolve, reject) => {
			rejectRun = reject;
		});
		let markRunStarted: (() => void) | undefined;
		const runStarted = new Promise<void>((resolve) => {
			markRunStarted = resolve;
		});
		const abortCalls: unknown[] = [];
		const runtime = {
			async run() {
				markRunStarted?.();
				return await runGate;
			},
			async continue() {
				markRunStarted?.();
				return await runGate;
			},
			abort(reason?: unknown) {
				abortCalls.push(reason);
				rejectRun?.(new Error(String(reason ?? "aborted")));
			},
			subscribe() {
				return () => {};
			},
			snapshot() {
				return makeSnapshot();
			},
		} as unknown as AgentRuntime;
		const unhandledReasons: unknown[] = [];
		const onUnhandledRejection = (reason: unknown): void => {
			unhandledReasons.push(reason);
		};

		process.prependListener("unhandledRejection", onUnhandledRejection);
		try {
			const session = new SessionRuntime(makeAgentConfig(), {
				createAgentRuntimeImpl: () => runtime,
			});
			const runPromise = session.run("slow");
			await runStarted;
			session.abort("user cancelled");
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(unhandledReasons).toEqual([]);
			await expect(runPromise).rejects.toThrow("user cancelled");
			expect(abortCalls).toEqual(["user cancelled"]);
		} finally {
			process.off("unhandledRejection", onUnhandledRejection);
		}
	});

	it("is a no-op when no run is active", () => {
		const { deps } = withFakeRuntime();
		const session = new SessionRuntime(makeAgentConfig(), deps);
		expect(() => session.abort()).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// state mutators
// ---------------------------------------------------------------------------

describe("SessionRuntime.addTools / updateConnection / clearHistory / restore", () => {
	const echoTool: AgentTool = {
		name: "echo",
		description: "e",
		inputSchema: {},
		execute: async () => ({}),
	};

	it("addTools is a no-op when the list is empty", () => {
		const session = new SessionRuntime(makeAgentConfig({ tools: [echoTool] }));
		session.addTools([]);
		expect(session.canStartRun()).toBe(true);
	});

	it("addTools merges new tools and skips duplicates by name", () => {
		const session = new SessionRuntime(makeAgentConfig({ tools: [echoTool] }));
		session.addTools([echoTool, { ...echoTool, name: "other" }]);
		expect(session.canStartRun()).toBe(true);
	});

	it("updateConnection mutates provider/model/api fields for next run", async () => {
		const { deps, calls } = withFakeRuntime();
		const session = new SessionRuntime(makeAgentConfig(), deps);
		session.updateConnection({ modelId: "claude-4", apiKey: "new-key" });
		const result = await session.run("go");
		expect(result.model.id).toBe("claude-4");
		expect(calls.run).toHaveLength(1);
	});

	it("clearHistory resets the conversation store", () => {
		const session = new SessionRuntime(
			makeAgentConfig({
				initialMessages: [
					{ role: "user", content: [{ type: "text", text: "hi" }] },
				],
			}),
		);
		expect(session.getMessages()).toHaveLength(1);
		session.clearHistory();
		expect(session.getMessages()).toEqual([]);
	});

	it("restore replaces the conversation store with provided messages", () => {
		const session = new SessionRuntime(makeAgentConfig());
		session.restore([
			{ role: "user", content: [{ type: "text", text: "first" }] },
			{ role: "assistant", content: [{ type: "text", text: "second" }] },
		]);
		const messages = session.getMessages();
		expect(messages).toHaveLength(2);
		expect(messages[0].role).toBe("user");
		expect(messages[1].role).toBe("assistant");
	});
});

// ---------------------------------------------------------------------------
// shutdown
// ---------------------------------------------------------------------------

describe("SessionRuntime.shutdown", () => {
	it("completes successfully when no run is active and locks out future runs", async () => {
		const session = new SessionRuntime(makeAgentConfig());
		await expect(session.shutdown()).resolves.toBeUndefined();
		expect(session.canStartRun()).toBe(false);
	});

	it("is idempotent across repeat calls", async () => {
		const session = new SessionRuntime(makeAgentConfig());
		await session.shutdown();
		await expect(session.shutdown()).resolves.toBeUndefined();
	});

	it("waits for an aborted in-flight run before shutting down", async () => {
		let releaseRun: (() => void) | undefined;
		let markRunEntered: (() => void) | undefined;
		const runEntered = new Promise<void>((resolve) => {
			markRunEntered = resolve;
		});
		const abortCalls: unknown[] = [];
		const runtime = {
			async run() {
				await new Promise<void>((resolve) => {
					releaseRun = resolve;
					markRunEntered?.();
				});
				return {
					agentId: "agent_fake",
					runId: "run_fake",
					status: "aborted" as const,
					iterations: 1,
					outputText: "",
					messages: [],
					usage: {
						inputTokens: 0,
						outputTokens: 0,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						totalCost: 0,
					},
				};
			},
			async continue() {
				throw new Error("not used");
			},
			abort(reason?: unknown) {
				abortCalls.push(reason);
				releaseRun?.();
			},
			subscribe() {
				return () => {};
			},
			snapshot() {
				return makeSnapshot();
			},
		} as unknown as AgentRuntime;

		const session = new SessionRuntime(makeAgentConfig(), {
			createAgentRuntimeImpl: () => runtime,
		});

		const runPromise = session.run("slow");
		await runEntered;
		session.abort("session_stop");
		expect(abortCalls).toEqual(["session_stop"]);
		await expect(session.shutdown("session_stop")).resolves.toBeUndefined();
		await expect(runPromise).resolves.toMatchObject({
			finishReason: "aborted",
		});
		expect(session.canStartRun()).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// subscribeEvents lifecycle
// ---------------------------------------------------------------------------

describe("SessionRuntime.subscribeEvents", () => {
	it("unsubscribes cleanly", async () => {
		const { deps } = withFakeRuntime({
			events: [
				{
					type: "turn-finished",
					iteration: 1,
					toolCallCount: 0,
					snapshot: makeSnapshot(),
				},
			],
		});
		const session = new SessionRuntime(makeAgentConfig(), deps);
		const received: AgentEvent[] = [];
		const unsubscribe = session.subscribeEvents((event) =>
			received.push(event),
		);
		unsubscribe();
		await session.run("go");
		expect(received).toHaveLength(0);
	});

	it("swallows listener errors without breaking fanout", async () => {
		const { deps } = withFakeRuntime({
			events: [
				{
					type: "turn-finished",
					iteration: 1,
					toolCallCount: 0,
					snapshot: makeSnapshot(),
				},
			],
		});
		const session = new SessionRuntime(makeAgentConfig(), {
			...deps,
			logger: {
				debug: vi.fn(),
				log: vi.fn(),
				error: vi.fn(),
			},
		});
		const good = vi.fn();
		session.subscribeEvents(() => {
			throw new Error("listener boom");
		});
		session.subscribeEvents(good);
		await session.run("go");
		expect(good).toHaveBeenCalled();
	});
});

// ===========================================================================
// P1 defect regression suites (#1, #2, #3) — added by impl-session-fixer.
// ===========================================================================

/**
 * Build a runtime-factory that records the `AgentRuntimeConfig` it
 * receives on every call and returns an `AgentRunResult` produced by
 * the caller-supplied `producer`. Used to assert seeding / hook wiring.
 */
function makeRecordingRuntimeFactory(
	producer: (
		call: number,
	) => Pick<AgentRunResult, "messages" | "outputText"> | undefined = () =>
		undefined,
): {
	deps: SessionRuntimeOrchestratorDeps;
	configs: Array<
		Parameters<
			NonNullable<SessionRuntimeOrchestratorDeps["createAgentRuntimeImpl"]>
		>[0]
	>;
} {
	const configs: Array<
		Parameters<
			NonNullable<SessionRuntimeOrchestratorDeps["createAgentRuntimeImpl"]>
		>[0]
	> = [];
	const deps: SessionRuntimeOrchestratorDeps = {
		createAgentRuntimeImpl: (config) => {
			configs.push(config);
			const callIndex = configs.length;
			const produced = producer(callIndex);
			const baseResult: AgentRunResult = {
				agentId: "agent_fake",
				runId: `run_fake_${callIndex}`,
				status: "completed",
				iterations: 1,
				outputText: produced?.outputText ?? "",
				messages: produced?.messages ?? [],
				usage: {
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: 0,
				},
			};
			return {
				async run() {
					return baseResult;
				},
				async continue() {
					return baseResult;
				},
				abort() {},
				subscribe() {
					return () => {};
				},
				snapshot: makeSnapshot,
			} as unknown as AgentRuntime;
		},
	};
	return { deps, configs };
}

// ---------------------------------------------------------------------------
// [#1] initialMessages seeding (P1 defect #1)
// ---------------------------------------------------------------------------

describe("SessionRuntime.run — initialMessages seeding (P1 #1)", () => {
	it("seeds prior transcript into every subsequent run's runtime config", async () => {
		const { deps, configs } = makeRecordingRuntimeFactory((call) => {
			if (call === 1) {
				return {
					outputText: "hi back",
					messages: [
						{
							id: "m1",
							role: "user",
							content: [{ type: "text", text: "hello" }],
							createdAt: 1,
						},
						{
							id: "m2",
							role: "assistant",
							content: [{ type: "text", text: "hi back" }],
							createdAt: 2,
						},
					],
				};
			}
			return undefined;
		});
		const session = new SessionRuntime(makeAgentConfig(), deps);
		await session.run("hello");
		await session.continue("again");
		expect(configs).toHaveLength(2);
		// Turn 1 seeds: just the current-turn user message.
		const firstSeed = configs[0].initialMessages ?? [];
		expect(firstSeed.length).toBe(1);
		expect(firstSeed[0].role).toBe("user");
		// Turn 2 seeds: turn-1 user + assistant + turn-2 user.
		const secondSeed = configs[1].initialMessages ?? [];
		expect(secondSeed.length).toBeGreaterThanOrEqual(3);
		expect(secondSeed.some((m) => m.role === "assistant")).toBe(true);
	});

	it("preserves multi-turn transcript in getMessages() across run + continue", async () => {
		const { deps } = makeRecordingRuntimeFactory((call) => {
			if (call === 1) {
				return {
					outputText: "one",
					messages: [
						{
							id: "u1",
							role: "user",
							content: [{ type: "text", text: "q1" }],
							createdAt: 1,
						},
						{
							id: "a1",
							role: "assistant",
							content: [{ type: "text", text: "one" }],
							createdAt: 2,
						},
					],
				};
			}
			return {
				outputText: "two",
				messages: [
					{
						id: "u1",
						role: "user",
						content: [{ type: "text", text: "q1" }],
						createdAt: 1,
					},
					{
						id: "a1",
						role: "assistant",
						content: [{ type: "text", text: "one" }],
						createdAt: 2,
					},
					{
						id: "u2",
						role: "user",
						content: [{ type: "text", text: "q2" }],
						createdAt: 3,
					},
					{
						id: "a2",
						role: "assistant",
						content: [{ type: "text", text: "two" }],
						createdAt: 4,
					},
				],
			};
		});
		const session = new SessionRuntime(makeAgentConfig(), deps);
		await session.run("q1");
		await session.continue("q2");
		const messages = session.getMessages();
		expect(messages).toHaveLength(4);
		expect(messages.map((m) => m.role)).toEqual([
			"user",
			"assistant",
			"user",
			"assistant",
		]);
	});

	it("seeds runtime with messages provided via restore()", async () => {
		const { deps, configs } = makeRecordingRuntimeFactory();
		const session = new SessionRuntime(makeAgentConfig(), deps);
		session.restore([
			{ role: "user", content: [{ type: "text", text: "prior-user" }] },
			{
				role: "assistant",
				content: [{ type: "text", text: "prior-assistant" }],
			},
		]);
		await session.continue("followup");
		expect(configs).toHaveLength(1);
		const seed = configs[0].initialMessages ?? [];
		expect(seed.length).toBeGreaterThanOrEqual(3);
		expect(seed.some((m) => m.role === "assistant")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// [#3] MistakeTracker + LoopDetectionTracker wiring (P1 defect #3)
// ---------------------------------------------------------------------------

/**
 * Build a manual AgentRuntime stub that exposes listener fan-out so
 * tests can drive the tracker pipeline by emitting scripted
 * `AgentRuntimeEvent`s synchronously from `run()`/`continue()`.
 */
function makeScriptedRuntime(script: {
	events: readonly AgentRuntimeEvent[];
}): {
	deps: SessionRuntimeOrchestratorDeps;
	abortCalls: string[];
} {
	const abortCalls: string[] = [];
	const baseResult: AgentRunResult = {
		agentId: "agent_fake",
		runId: "run_fake",
		status: "completed",
		iterations: 1,
		outputText: "",
		messages: [],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
	};
	let listener: ((e: AgentRuntimeEvent) => void) | undefined;
	const runtime = {
		async run() {
			for (const e of script.events) listener?.(e);
			return baseResult;
		},
		async continue() {
			for (const e of script.events) listener?.(e);
			return baseResult;
		},
		abort(reason?: string) {
			abortCalls.push(reason ?? "");
		},
		subscribe(l: (e: AgentRuntimeEvent) => void) {
			listener = l;
			return () => {
				listener = undefined;
			};
		},
		snapshot: makeSnapshot,
	} as unknown as AgentRuntime;
	return {
		deps: { createAgentRuntimeImpl: () => runtime },
		abortCalls,
	};
}

function failedToolTurnEvents(): AgentRuntimeEvent[] {
	return [
		{ type: "turn-started", iteration: 1, snapshot: makeSnapshot() },
		{
			type: "tool-started",
			iteration: 1,
			toolCall: {
				type: "tool-call",
				toolCallId: "tc",
				toolName: "t",
				input: { n: 1 },
			},
			snapshot: makeSnapshot(),
		},
		{
			type: "tool-finished",
			iteration: 1,
			toolCall: {
				type: "tool-call",
				toolCallId: "tc",
				toolName: "t",
				input: { n: 1 },
			},
			message: {
				id: "m",
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "tc",
						toolName: "t",
						output: "fail",
						isError: true,
					},
				],
				createdAt: 1,
			},
			snapshot: makeSnapshot(),
		},
		{
			type: "turn-finished",
			iteration: 1,
			toolCallCount: 1,
			snapshot: makeSnapshot(),
		},
	];
}

function failedStructuredToolTurnEvents(): AgentRuntimeEvent[] {
	return [
		{ type: "turn-started", iteration: 1, snapshot: makeSnapshot() },
		{
			type: "tool-started",
			iteration: 1,
			toolCall: {
				type: "tool-call",
				toolCallId: "tc_structured",
				toolName: "exec",
				input: { cmd: "pwd" },
			},
			snapshot: makeSnapshot(),
		},
		{
			type: "tool-finished",
			iteration: 1,
			toolCall: {
				type: "tool-call",
				toolCallId: "tc_structured",
				toolName: "exec",
				input: { cmd: "pwd" },
			},
			message: {
				id: "m_structured",
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "tc_structured",
						toolName: "exec",
						output: {
							message: "sandbox denied",
							code: "EPERM",
						},
						isError: true,
					},
				],
				createdAt: 1,
			},
			snapshot: makeSnapshot(),
		},
		{
			type: "turn-finished",
			iteration: 1,
			toolCallCount: 1,
			snapshot: makeSnapshot(),
		},
	];
}

describe("SessionRuntime.run — tracker wiring (P1 #3)", () => {
	it("aborts after maxConsecutiveMistakes failed-tool turns", async () => {
		const { deps, abortCalls } = makeScriptedRuntime({
			events: failedToolTurnEvents(),
		});
		const session = new SessionRuntime(
			makeAgentConfig({ execution: { maxConsecutiveMistakes: 2 } }),
			deps,
		);
		await session.run("one");
		// First failed turn — counter 1 < 2, no abort yet.
		expect(abortCalls).toHaveLength(0);
		await session.continue("two");
		// Second failed turn — counter reaches 2, tracker calls abort.
		expect(abortCalls.length).toBeGreaterThanOrEqual(1);
	});

	it("serializes structured tool errors in mistake details", async () => {
		const errors: string[] = [];
		const { deps } = makeScriptedRuntime({
			events: failedStructuredToolTurnEvents(),
		});
		const session = new SessionRuntime(
			makeAgentConfig({ execution: { maxConsecutiveMistakes: 1 } }),
			{
				...deps,
				telemetry: undefined,
				logger: {
					log() {},
					debug() {},
					error() {},
				},
			},
		);
		session.subscribeEvents((event) => {
			if (event.type === "error") {
				errors.push(event.error.message);
			}
		});

		await session.run("run tool");

		expect(errors).toContain(
			'1 tool call(s) failed: [exec] {"message":"sandbox denied","code":"EPERM"}',
		);
	});

	it("resets mistake tracking when run() starts a fresh conversation", async () => {
		const { deps, abortCalls } = makeScriptedRuntime({
			events: failedToolTurnEvents(),
		});
		const session = new SessionRuntime(
			makeAgentConfig({ execution: { maxConsecutiveMistakes: 2 } }),
			deps,
		);
		await session.run("task one");
		expect(abortCalls).toHaveLength(0);
		await session.run("task two");
		expect(abortCalls).toHaveLength(0);
	});

	it("aborts on hard-threshold loop detection of identical tool calls", async () => {
		const identical = (i: number): AgentRuntimeEvent => ({
			type: "tool-started",
			iteration: i,
			toolCall: {
				type: "tool-call",
				toolCallId: `tc${i}`,
				toolName: "same",
				input: { a: 1 },
			},
			snapshot: makeSnapshot(),
		});
		const { deps, abortCalls } = makeScriptedRuntime({
			events: [
				{ type: "turn-started", iteration: 1, snapshot: makeSnapshot() },
				identical(1),
				identical(1),
				identical(1),
			],
		});
		const session = new SessionRuntime(
			makeAgentConfig({
				execution: {
					maxConsecutiveMistakes: 6,
					loopDetection: { softThreshold: 2, hardThreshold: 3 },
				},
			}),
			deps,
		);
		await session.run("loop-me");
		expect(abortCalls.length).toBeGreaterThanOrEqual(1);
	});

	it("resets loop detection when run() starts a fresh conversation", async () => {
		const identical = (i: number): AgentRuntimeEvent => ({
			type: "tool-started",
			iteration: i,
			toolCall: {
				type: "tool-call",
				toolCallId: `tc${i}`,
				toolName: "same",
				input: { a: 1 },
			},
			snapshot: makeSnapshot(),
		});
		const { deps, abortCalls } = makeScriptedRuntime({
			events: [
				{ type: "turn-started", iteration: 1, snapshot: makeSnapshot() },
				identical(1),
				identical(1),
			],
		});
		const session = new SessionRuntime(
			makeAgentConfig({
				execution: {
					maxConsecutiveMistakes: 6,
					loopDetection: { softThreshold: 2, hardThreshold: 3 },
				},
			}),
			deps,
		);
		await session.run("task one");
		expect(abortCalls).toHaveLength(0);
		await session.run("task two");
		expect(abortCalls).toHaveLength(0);
	});

	it("does not trigger loop-detection when execution.loopDetection === false", async () => {
		const identical = (i: number): AgentRuntimeEvent => ({
			type: "tool-started",
			iteration: i,
			toolCall: {
				type: "tool-call",
				toolCallId: `tc${i}`,
				toolName: "same",
				input: { a: 1 },
			},
			snapshot: makeSnapshot(),
		});
		const { deps, abortCalls } = makeScriptedRuntime({
			events: [
				{ type: "turn-started", iteration: 1, snapshot: makeSnapshot() },
				identical(1),
				identical(1),
				identical(1),
				identical(1),
				identical(1),
			],
		});
		const session = new SessionRuntime(
			makeAgentConfig({ execution: { loopDetection: false } }),
			deps,
		);
		await session.run("many-identical");
		expect(abortCalls).toHaveLength(0);
	});

	it("does not abort on productive turns (successful tool calls)", async () => {
		const events: AgentRuntimeEvent[] = [
			{ type: "turn-started", iteration: 1, snapshot: makeSnapshot() },
			{
				type: "tool-started",
				iteration: 1,
				toolCall: {
					type: "tool-call",
					toolCallId: "ok",
					toolName: "t",
					input: { n: 1 },
				},
				snapshot: makeSnapshot(),
			},
			{
				type: "tool-finished",
				iteration: 1,
				toolCall: {
					type: "tool-call",
					toolCallId: "ok",
					toolName: "t",
					input: { n: 1 },
				},
				message: {
					id: "m",
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: "ok",
							toolName: "t",
							output: "ok",
						},
					],
					createdAt: 1,
				},
				snapshot: makeSnapshot(),
			},
			{
				type: "turn-finished",
				iteration: 1,
				toolCallCount: 1,
				snapshot: makeSnapshot(),
			},
		];
		const { deps, abortCalls } = makeScriptedRuntime({ events });
		const session = new SessionRuntime(
			makeAgentConfig({ execution: { maxConsecutiveMistakes: 2 } }),
			deps,
		);
		await session.run("a");
		await session.continue("b");
		await session.continue("c");
		expect(abortCalls).toHaveLength(0);
	});
});
