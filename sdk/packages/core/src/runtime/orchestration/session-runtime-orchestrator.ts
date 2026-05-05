/**
 * Per-session `SessionRuntime` orchestrator.
 *
 * Owns all cross-turn state for one logical agent session:
 *
 *   - `ConversationStore`      — message transcript + session-started gate
 *   - `MistakeTracker`         — per-session consecutive-mistake counter
 *   - `LoopDetectionTracker`   — per-session repeated-tool-call detector
 *   - `MessageBuilder`         — provider-message assembly cache
 *   - `AgentRuntimeHooks`      — runtime-native hooks from config/extensions
 *   - `RuntimeEventAdapter`    — per-run stateful `AgentRuntimeEvent`
 *                                → legacy `AgentEvent` translator
 *   - listener registry        — host subscribers see legacy `AgentEvent`s
 *   - pending tool set, abort  — per-run lifecycle housekeeping
 *
 * A fresh `AgentRuntime` is instantiated per run via
 * `createAgentRuntime(createAgentRuntimeConfig({...}))`. All
 * session-level state outlives any one `AgentRuntime`, making
 * OAuth-retry and run replay feasible.
 */

import type { AgentRuntime } from "@clinebot/agents";
import { createAgentRuntime } from "@clinebot/agents";
import {
	type AgentConfig,
	type AgentEvent,
	type AgentExtension,
	type AgentExtensionRegistry,
	type AgentExtensionRule,
	type AgentFinishReason,
	type AgentMessage,
	type AgentResult,
	type AgentRunResult,
	type AgentRuntimeEvent,
	type AgentRuntimeHooks,
	type AgentRuntimePrepareTurnContext,
	type AgentTool,
	type BasicLogger,
	type ContributionRegistry,
	createContributionRegistry,
	type ITelemetryService,
	type LegacyAgentUsage,
	type LoopDetectionConfig,
	type Message,
	type MessageWithMetadata,
	type ModelInfo,
	type ToolCallRecord,
} from "@clinebot/shared";
import {
	createAgentModelFromConfig,
	resolveKnownModelsFromConfig,
} from "../../services/llms/handler-factory";
import { MessageBuilder } from "../../session/services/message-builder";
import { ConversationStore } from "../../session/stores/conversation-store";
import {
	agentMessagesToMessages,
	agentMessagesToMessagesWithMetadata,
	messagesToAgentMessages,
} from "../config/agent-message-codec";
import { createAgentRuntimeConfig } from "../config/agent-runtime-config-builder";
import { LoopDetectionTracker } from "../safety/loop-detection";
import { MistakeTracker } from "../safety/mistake-tracker";
import { RuntimeEventAdapter } from "./runtime-event-adapter";

function formatToolResultError(output: unknown): string {
	if (typeof output === "string") {
		return output;
	}
	if (output instanceof Error) {
		return output.message;
	}
	try {
		return JSON.stringify(output);
	} catch {
		return String(output);
	}
}

async function resolveRuleContent(
	rule: AgentExtensionRule,
): Promise<string | undefined> {
	const content =
		typeof rule.content === "function" ? await rule.content() : rule.content;
	const trimmed = content.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function mergeSystemPromptRules(
	systemPrompt: string,
	rules: ReadonlyArray<string>,
): string {
	const base = systemPrompt.trim();
	const additional = rules
		.map((rule) => rule.trim())
		.filter(Boolean)
		.join("\n\n");
	if (base && additional) {
		return `${base}\n\n${additional}`;
	}
	return base || additional;
}

function mergeRuntimeHooks(
	layers: Array<Partial<AgentRuntimeHooks> | undefined>,
): Partial<AgentRuntimeHooks> {
	const hooks = layers.filter(
		(layer): layer is Partial<AgentRuntimeHooks> => layer !== undefined,
	);
	if (hooks.length === 0) {
		return {};
	}

	return {
		beforeRun: async (ctx) => {
			for (const hook of hooks) {
				const result = await hook.beforeRun?.(ctx);
				if (result?.stop) return result;
			}
			return undefined;
		},
		afterRun: async (ctx) => {
			for (const hook of hooks) {
				await hook.afterRun?.(ctx);
			}
		},
		beforeModel: async (ctx) => {
			let request = ctx.request;
			let aggregate:
				| Awaited<ReturnType<NonNullable<AgentRuntimeHooks["beforeModel"]>>>
				| undefined;
			for (const hook of hooks) {
				const result = await hook.beforeModel?.({ ...ctx, request });
				if (!result) continue;
				if (result.stop) return result;
				aggregate = {
					...aggregate,
					...result,
					options: {
						...(aggregate?.options ?? {}),
						...(result.options ?? {}),
					},
				};
				request = {
					...request,
					...(result.messages ? { messages: result.messages } : {}),
					...(result.tools ? { tools: result.tools } : {}),
					...(result.options
						? { options: { ...(request.options ?? {}), ...result.options } }
						: {}),
				};
			}
			return aggregate;
		},
		afterModel: async (ctx) => {
			for (const hook of hooks) {
				const result = await hook.afterModel?.(ctx);
				if (result?.stop) return result;
			}
			return undefined;
		},
		beforeTool: async (ctx) => {
			let input = ctx.input;
			let aggregate:
				| Awaited<ReturnType<NonNullable<AgentRuntimeHooks["beforeTool"]>>>
				| undefined;
			for (const hook of hooks) {
				const result = await hook.beforeTool?.({ ...ctx, input });
				if (!result) continue;
				if (result.stop || result.skip) return result;
				aggregate = { ...aggregate, ...result };
				if (Object.hasOwn(result, "input")) {
					input = result.input;
				}
			}
			return aggregate;
		},
		afterTool: async (ctx) => {
			let result = ctx.result;
			let aggregate:
				| Awaited<ReturnType<NonNullable<AgentRuntimeHooks["afterTool"]>>>
				| undefined;
			for (const hook of hooks) {
				const next = await hook.afterTool?.({ ...ctx, result });
				if (!next) continue;
				if (next.stop) return next;
				aggregate = { ...aggregate, ...next };
				if (next.result) {
					result = next.result;
				}
			}
			return aggregate;
		},
		onEvent: async (event) => {
			for (const hook of hooks) {
				await hook.onEvent?.(event);
			}
		},
	};
}

// =============================================================================
// Public types
// =============================================================================

/**
 * Listener invoked for every legacy `AgentEvent` produced by the
 * session runtime. Use `subscribeEvents(listener)` — it returns an
 * `unsubscribe` function.
 */
export type SessionEventListener = (event: AgentEvent) => void;

/** Subset of host-side deps needed by the session orchestrator. */
export interface SessionRuntimeOrchestratorDeps {
	readonly logger?: BasicLogger;
	readonly telemetry?: ITelemetryService;
	/**
	 * Test hook: override the `AgentRuntime` factory. Production
	 * callers leave this undefined and get the real `createAgentRuntime`.
	 */
	readonly createAgentRuntimeImpl?: (
		config: Parameters<typeof createAgentRuntime>[0],
	) => AgentRuntime;
}

/** Connection overrides applied via `updateConnection`. */
export interface ConnectionOverrides {
	providerId?: string;
	modelId?: string;
	apiKey?: string;
	baseUrl?: string;
	headers?: Record<string, string>;
	providerConfig?: unknown;
	reasoningEffort?: AgentConfig["reasoningEffort"];
	thinking?: boolean;
	thinkingBudgetTokens?: number;
}

// =============================================================================
// SessionRuntime orchestrator
// =============================================================================

/**
 * Per-session orchestrator. Construct once per agent session; call
 * `run` / `continue` repeatedly. The class matches the subset of
 * runtime-facing session surface.
 */
export class SessionRuntime {
	private config: AgentConfig;
	private readonly agentId: string;
	private readonly parentAgentId?: string;
	private readonly logger?: BasicLogger;
	// Reserved for §3.4.4 telemetry parity (not yet consumed — §3.4.4
	// listed as explicitly deferred until telemetry wiring is added).
	// Typed as `readonly` to preserve the field slot for future use
	// without re-touching the constructor.
	readonly telemetry?: ITelemetryService;
	private readonly conversation: ConversationStore;
	private readonly mistakeTracker: MistakeTracker;
	private readonly loopTracker: LoopDetectionTracker;
	/**
	 * True when `execution.loopDetection === false` at construction
	 * time. Loop inspection is skipped entirely — the tracker still
	 * exists for API compatibility but is never fed.
	 */
	private readonly loopDetectionDisabled: boolean;
	// Host-owned provider request preparation. This runs immediately
	// before the model call so every loop iteration sees extension
	// message builders and API-safe normalization.
	readonly messageBuilder: MessageBuilder;
	/**
	 * Contribution registry that hosts extension-provided tools,
	 * commands, message builders, and providers. Lazily initialized
	 * on first run (parity with legacy `Agent.ensureExtensionsInitialized`
	 * at `packages/agents/src/agent.ts:1122-1147`).
	 */
	private readonly contributionRegistry: ContributionRegistry<
		AgentExtension,
		AgentTool,
		Message[]
	>;
	private extensionsInitialized = false;
	private readonly listeners = new Set<SessionEventListener>();
	private readonly createAgentRuntimeImpl: (
		config: Parameters<typeof createAgentRuntime>[0],
	) => AgentRuntime;

	/** Stable run id for the active run. */
	private activeRunId: string | null = null;
	/** True while a run is in flight. `canStartRun()` is the negation. */
	private running = false;
	/** True once `abort()` has been requested for the active run. */
	private abortRequested = false;
	/** Last abort reason requested for the active run. */
	private abortReason: string | undefined;
	/** Reference to the current run's `AgentRuntime` so `abort` can forward. */
	private activeRuntime: AgentRuntime | null = null;
	/** Promise returned from the current run so shutdown can await its drain. */
	private activeRunPromise: Promise<AgentResult> | null = null;
	/** Per-run `Agent → AgentEvent` adapter; `reset()` each run. */
	private readonly eventAdapter = new RuntimeEventAdapter();
	/** Session-shutdown gate — rejects late runs. */
	private shutdownCalled = false;
	/** Running tally of tool-call records for `AgentResult.toolCalls`. */
	private currentRunToolCalls: ToolCallRecord[] = [];
	/** Aggregated usage across the current run. */
	private currentRunUsage: LegacyAgentUsage = {
		inputTokens: 0,
		outputTokens: 0,
	};
	/** Tool-start timestamps for `ToolCallRecord.durationMs`. */
	private toolStartedAt = new Map<string, Date>();
	/** Tool-call input snapshot for `ToolCallRecord.input`. */
	private toolInputs = new Map<string, unknown>();
	/**
	 * Per-turn tool outcome counters used by the MistakeTracker wiring.
	 * Reset on every `turn-started` event; consumed on `turn-finished`
	 * to feed `mistakeTracker.record` when every tool call erred and no
	 * successful call landed. Matches legacy `agent.ts` tool-failure
	 * mistake-feed path (§3.4.6 + pre-Step-9 oracle lines 972-997).
	 */
	private currentTurnSuccessfulTools = 0;
	private currentTurnFailedTools = 0;
	private currentTurnFailureDetails: string[] = [];
	/**
	 * Serial queue for `MistakeTracker.record(...)` + loop-detection
	 * side-effects fired from the sync `handleRuntimeEvent` stream. The
	 * tracker's `record()` is async but the runtime event stream is
	 * synchronous, so we chain tracker work onto a promise and await it
	 * in `executeRun` before returning the `AgentResult`.
	 */
	private activeTrackerWork: Promise<void> = Promise.resolve();
	/** True when tracker logic has issued an abort for the active run. */
	private trackerAbortInFlight = false;

	constructor(config: AgentConfig, deps: SessionRuntimeOrchestratorDeps = {}) {
		this.config = config;
		this.agentId = `agent_${Date.now()}_${Math.random()
			.toString(36)
			.slice(2, 8)}`;
		this.parentAgentId = config.parentAgentId;
		this.logger = deps.logger ?? config.logger;
		this.telemetry = deps.telemetry ?? config.telemetry;
		this.createAgentRuntimeImpl =
			deps.createAgentRuntimeImpl ?? createAgentRuntime;

		this.conversation = new ConversationStore(config.initialMessages);
		this.messageBuilder = new MessageBuilder();
		this.contributionRegistry = createContributionRegistry<
			AgentExtension,
			AgentTool,
			Message[]
		>({
			extensions: config.extensions ? [...config.extensions] : [],
			setupContext: {
				session: config.extensionContext?.session,
				client: config.extensionContext?.client,
				user: config.extensionContext?.user,
				workspaceInfo: config.extensionContext?.workspace,
				automation: config.extensionContext?.automation,
				logger: config.extensionContext?.logger ?? this.logger,
				telemetry: config.extensionContext?.telemetry ?? this.telemetry,
			},
		});
		// Resolve + validate eagerly so `getExtensionRegistry()` is
		// callable before the first run (legacy parity with
		// `Agent` constructor at packages/agents/src/agent.ts:158-159).
		// `setup()` is deferred to `ensureExtensionsInitialized` on
		// the first run so async extension setup can't block the
		// constructor.
		this.contributionRegistry.resolve();
		this.contributionRegistry.validate();

		const maxMistakes = config.execution?.maxConsecutiveMistakes ?? 6;
		this.mistakeTracker = new MistakeTracker({
			maxConsecutiveMistakes: maxMistakes,
			onLimitReached: config.onConsecutiveMistakeLimitReached,
			emit: (event) => this.emitLegacyEvent(event),
			log: (level, message, metadata) =>
				leveledLog(this.logger, level, message, metadata),
			agentId: this.agentId,
			getConversationId: () => this.conversation.getConversationId(),
			getActiveRunId: () => this.activeRunId ?? "",
			appendRecoveryNotice: (message, _reason) => {
				this.conversation.appendMessage({
					role: "user",
					content: [{ type: "text", text: message }],
				});
			},
		});
		const loopDetectionInput = config.execution?.loopDetection;
		this.loopDetectionDisabled = loopDetectionInput === false;
		const loopConfig: Partial<LoopDetectionConfig> | undefined =
			loopDetectionInput === false || loopDetectionInput === undefined
				? undefined
				: loopDetectionInput;
		this.loopTracker = new LoopDetectionTracker(loopConfig);
	}

	// -------------------------------------------------------------------
	// Accessors & state mutators
	// -------------------------------------------------------------------

	getAgentId(): string {
		return this.agentId;
	}

	getConversationId(): string {
		return this.conversation.getConversationId();
	}

	getMessages(): MessageWithMetadata[] {
		return this.conversation.getMessages();
	}

	/** True when no run is currently active and the session is not shut down. */
	canStartRun(): boolean {
		return !this.running && !this.shutdownCalled;
	}

	/**
	 * Snapshot of the contribution registry (tools, commands, and other
	 * extension contributions).
	 *
	 * Before the first run, the registry is in the `validate` phase:
	 * extensions are validated but their `setup()` callbacks have not
	 * run yet, so the snapshot only reflects eagerly-declared
	 * contributions. After the first `run()`/`continue()`, the
	 * registry is initialized (§`ensureExtensionsInitialized`), and
	 * the snapshot reflects everything extensions registered via
	 * `api.registerTool` / `registerCommand` / `registerMessageBuilder`
	 * / `registerProvider` / `registerAutomationEventType`.
	 */
	getExtensionRegistry(): AgentExtensionRegistry<AgentTool, Message[]> {
		return this.contributionRegistry.getRegistrySnapshot();
	}

	/** Append additional tools to every subsequent turn's runtime config. */
	addTools(tools: AgentTool[]): void {
		if (tools.length === 0) {
			return;
		}
		const existing = new Set(this.config.tools.map((tool) => tool.name));
		const merged = [...this.config.tools];
		for (const tool of tools) {
			if (!existing.has(tool.name)) {
				merged.push(tool);
				existing.add(tool.name);
			}
		}
		this.config = { ...this.config, tools: merged };
	}

	/** Mutate provider / reasoning fields for subsequent runs. */
	updateConnection(overrides: ConnectionOverrides): void {
		const next: AgentConfig = { ...this.config };
		if (overrides.providerId !== undefined)
			next.providerId = overrides.providerId;
		if (overrides.modelId !== undefined) next.modelId = overrides.modelId;
		if (overrides.apiKey !== undefined) next.apiKey = overrides.apiKey;
		if (overrides.baseUrl !== undefined) next.baseUrl = overrides.baseUrl;
		if (overrides.headers !== undefined) next.headers = overrides.headers;
		if (overrides.providerConfig !== undefined)
			next.providerConfig = overrides.providerConfig;
		if (overrides.reasoningEffort !== undefined)
			next.reasoningEffort = overrides.reasoningEffort;
		if (overrides.thinking !== undefined) next.thinking = overrides.thinking;
		if (overrides.thinkingBudgetTokens !== undefined)
			next.thinkingBudgetTokens = overrides.thinkingBudgetTokens;
		this.config = next;
	}

	clearHistory(): void {
		this.conversation.clearHistory();
		this.resetConversationBoundaryTrackers();
	}

	restore(messages: readonly MessageWithMetadata[]): void {
		this.conversation.restore(messages);
		this.resetConversationBoundaryTrackers();
	}

	private resetConversationBoundaryTrackers(): void {
		this.mistakeTracker.reset();
		this.loopTracker.reset();
	}

	// -------------------------------------------------------------------
	// Event subscription (legacy shape)
	// -------------------------------------------------------------------

	/**
	 * Subscribe to **legacy** `AgentEvent`s. The session runtime
	 * translates the new `AgentRuntimeEvent` stream via
	 * `RuntimeEventAdapter` before fanout, so consumers see the
	 * pre-swap shape.
	 */
	subscribeEvents(listener: SessionEventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	// -------------------------------------------------------------------
	// Abort / shutdown
	// -------------------------------------------------------------------

	abort(reason?: unknown): void {
		const message =
			typeof reason === "string"
				? reason
				: reason instanceof Error
					? reason.message
					: reason === undefined
						? undefined
						: String(reason);
		this.abortRequested = true;
		this.abortReason = message;
		if (this.activeRunPromise) {
			/**
			 * Why this exists in hub mode:
			 *
			 * The TUI and the runtime are not always in the same process. In hub
			 * mode, the visible TUI talks to a shared daemon over websocket. When the
			 * user sends a prompt, the TUI sends a "start this run" command to the
			 * daemon. The daemon starts the AgentRuntime and stores the promise for
			 * that run as `activeRunPromise`.
			 *
			 * If the user presses Escape, the TUI sends a separate "cancel the
			 * current run" command to the daemon. Cancelling a run means aborting the
			 * AgentRuntime. That is supposed to interrupt the provider stream or any
			 * other in-flight async work, and the normal way that interruption shows
			 * up in JavaScript is a rejected promise. That rejection is not a bug by
			 * itself. It is the expected result of the user saying "stop this
			 * request."
			 *
			 * The important detail is that the rejection is already handled by the
			 * code path that started the run. The original "start this run" command
			 * is still awaiting `sessionHost.send(...)`, and that await is what
			 * should eventually turn the run result or run error into a reply/event
			 * for the client.
			 *
			 * The problem we hit was a timing gap inside the daemon process. The
			 * separate cancel command can call `activeRuntime.abort(message)` while
			 * the original start command is still waiting elsewhere. The abort can
			 * make `activeRunPromise` reject immediately. If the runtime reports that
			 * rejection before the original start command observes it, Node/Bun can
			 * briefly classify it as an `unhandledRejection`.
			 *
			 * In the hub daemon, `unhandledRejection` is fatal. That is normally the
			 * right policy because real unhandled errors should not be ignored. But
			 * for this cancellation path it meant Escape could kill the daemon even
			 * though the run error was expected and the original start command was
			 * still responsible for handling it. After the daemon died, the next
			 * prompt looked like it started loading, then silently stalled because
			 * the TUI was talking to a dead runtime process.
			 *
			 * This `.catch()` is not the real application-level error handling. It is
			 * only a local safety observer attached before we trigger the abort, so
			 * the daemon does not mistake an expected cancellation rejection for a
			 * process crash. We do not replace `activeRunPromise`, await this catch,
			 * or convert the rejection into success. The original start command, and
			 * any other caller awaiting `run()` / `continue()`, still receives the
			 * same result or error it would have received without this observer.
			 */
			void this.activeRunPromise.catch(() => {});
		}
		this.activeRuntime?.abort(message);
	}

	/** Shut the session down after any active run drains. */
	async shutdown(_reason?: string, _timeoutMs?: number): Promise<void> {
		if (this.running) {
			if (!this.abortRequested || !this.activeRunPromise) {
				throw new Error(
					`SessionRuntime.shutdown called while a run is in progress (agentId=${this.agentId})`,
				);
			}
			await this.activeRunPromise;
		}
		if (this.shutdownCalled) {
			return;
		}
		this.shutdownCalled = true;
	}

	// -------------------------------------------------------------------
	// Run / continue
	// -------------------------------------------------------------------

	run(
		userMessage: string,
		userImages?: string[],
		userFiles?: string[],
	): Promise<AgentResult> {
		this.conversation.resetForRun();
		this.resetConversationBoundaryTrackers();
		return this.executeRun({
			userMessage,
			userImages,
			userFiles,
			isContinue: false,
		});
	}

	continue(
		userMessage?: string,
		userImages?: string[],
		userFiles?: string[],
	): Promise<AgentResult> {
		return this.executeRun({
			userMessage,
			userImages,
			userFiles,
			isContinue: true,
		});
	}

	// -------------------------------------------------------------------
	// Private implementation
	// -------------------------------------------------------------------

	private async composeSystemPrompt(): Promise<string> {
		const rules: string[] = [];
		for (const rule of this.contributionRegistry.getRegisteredRules()) {
			const content = await resolveRuleContent(rule);
			if (content) {
				rules.push(content);
			}
		}
		return mergeSystemPromptRules(this.config.systemPrompt, rules);
	}

	private executeRun(input: {
		userMessage?: string;
		userImages?: string[];
		userFiles?: string[];
		isContinue: boolean;
	}): Promise<AgentResult> {
		let activePromise!: Promise<AgentResult>;
		activePromise = this.executeRunInternal(input).finally(() => {
			if (this.activeRunPromise === activePromise) {
				this.activeRunPromise = null;
			}
		});
		this.activeRunPromise = activePromise;
		return activePromise;
	}

	private async executeRunInternal(input: {
		userMessage?: string;
		userImages?: string[];
		userFiles?: string[];
		isContinue: boolean;
	}): Promise<AgentResult> {
		if (this.shutdownCalled) {
			throw new Error(
				`SessionRuntime.run called after shutdown (agentId=${this.agentId})`,
			);
		}
		if (this.running) {
			throw new Error(
				`SessionRuntime state is "running"; call canStartRun() first (agentId=${this.agentId})`,
			);
		}
		this.running = true;
		this.abortRequested = false;
		this.abortReason = undefined;
		this.activeRunId = `run_${Date.now()}_${Math.random()
			.toString(36)
			.slice(2, 8)}`;
		// Lazily initialize contribution-registry extensions on the
		// first run, before runtime construction.
		await this.ensureExtensionsInitialized();
		this.eventAdapter.reset();
		this.currentRunToolCalls = [];
		this.currentRunUsage = { inputTokens: 0, outputTokens: 0 };
		this.toolStartedAt.clear();
		this.toolInputs.clear();
		this.currentTurnSuccessfulTools = 0;
		this.currentTurnFailedTools = 0;
		this.currentTurnFailureDetails = [];
		this.activeTrackerWork = Promise.resolve();
		this.trackerAbortInFlight = false;

		const startedAt = new Date();
		const effectiveUserMessage = input.userMessage;

		// Append the user turn (if any) to the conversation store. This
		// must happen BEFORE we snapshot `initialMessages` below so the
		// runtime sees the user message as part of its seed — we then
		// pass an empty input to `runtime.run()` so the runtime does not
		// append the message a second time (AgentRuntime.execute treats
		// a falsy input as "no additional messages", per
		// packages/agents/src/agent-runtime.ts normalizeInput path).
		if (effectiveUserMessage !== undefined) {
			const content = await buildUserTurnContent(
				effectiveUserMessage,
				input.userImages,
				input.userFiles,
				this.config.userFileContentLoader,
			);
			this.conversation.appendMessage({ role: "user", content });
		}

		// Build the AgentRuntime for this turn.
		const systemPrompt = await this.composeSystemPrompt();
		const agentModel = createAgentModelFromConfig(this.config, this.logger);
		// Merge extension-contributed tools with the config-declared
		// tools for this turn. Extensions register tools via
		// `api.registerTool` during `setup()` — parity with legacy
		// `Agent.ensureExtensionsInitialized` at pre-Step-9 `agent.ts:1140-1146`
		// which merged `this.contributionRegistry.getRegisteredTools()`
		// into `this.config.tools`. Dedupe by name so a config tool
		// wins over a same-named extension tool (legacy behaviour:
		// `validateTools` rejects duplicates; here we prefer the
		// explicitly-declared config tool).
		const extensionTools = this.contributionRegistry.getRegisteredTools();
		const mergedToolsByName = new Map<string, AgentTool>();
		for (const tool of extensionTools) {
			mergedToolsByName.set(tool.name, tool);
		}
		for (const tool of this.config.tools) {
			mergedToolsByName.set(tool.name, tool);
		}
		const conversationId = this.conversation.getConversationId();
		const modelInfo = tryGetModelInfo(this.config);
		const tools = Array.from(mergedToolsByName.values());
		// Seed initialMessages with the full prior transcript (including
		// the user message we just appended) so multi-turn history is
		// preserved across runs. Fixes P1 #1: prior turns were silently
		// lost because `createAgentRuntimeConfig` received no seed and
		// `replaceMessages(runResult.messages)` downstream overwrote the
		// conversation with just the current-turn trail.
		const initialMessages = messagesToAgentMessages(
			this.conversation.getMessages(),
		);
		const runtimeConfig = createAgentRuntimeConfig({
			agentConfig: this.config,
			sessionId: this.config.sessionId,
			agentId: this.agentId,
			conversationId,
			parentAgentId: this.parentAgentId,
			model: agentModel,
			logger: this.logger,
			tools,
			toolContextMetadata: {
				modelSupportsImages:
					modelInfo?.capabilities?.includes("images") ?? true,
				...this.config.toolContextMetadata,
			},
			hooks: this.createRuntimeHooks(),
			prepareTurn: this.createRuntimePrepareTurn(modelInfo, tools),
			initialMessages,
			systemPrompt,
		});
		const runtime = this.createAgentRuntimeImpl(runtimeConfig);
		this.activeRuntime = runtime;
		if (this.abortRequested) {
			runtime.abort(this.abortReason);
		}

		// Subscribe to runtime events; fan out legacy events to listeners
		// and keep private book-keeping for tool-call records / usage.
		const unsubscribe = runtime.subscribe((event: AgentRuntimeEvent) => {
			this.handleRuntimeEvent(event);
		});

		let runResult: AgentRunResult | undefined;
		let thrownError: Error | undefined;
		try {
			// Pass empty input so AgentRuntime does not duplicate the
			// user message we already seeded via `initialMessages`. The
			// runtime's `normalizeInput` treats `""`/`undefined` as
			// "no extra messages".
			if (input.isContinue) {
				runResult = await runtime.continue(undefined);
			} else {
				runResult = await runtime.run("");
			}
		} catch (error) {
			thrownError = error instanceof Error ? error : new Error(String(error));
		} finally {
			unsubscribe();
			// Drain any in-flight tracker work (mistake/loop side-effects
			// queued from handleRuntimeEvent) before we clear state so a
			// late abort can still reach the runtime if needed.
			try {
				await this.activeTrackerWork;
			} catch (error) {
				this.logger?.error?.(
					"SessionRuntime tracker work failed during drain",
					{ agentId: this.agentId, error },
				);
			}
			this.activeRuntime = null;
			this.running = false;
			this.abortRequested = false;
			this.abortReason = undefined;
		}

		// Persist the runtime's message trail back into the conversation
		// store so later turns see assistant output. The runtime state
		// was seeded with the full transcript, so `runResult.messages`
		// IS the complete new transcript (seed + newly-produced turn).
		if (runResult && runResult.messages.length > 0) {
			const replacement = agentMessagesToMessagesWithMetadata(
				runResult.messages,
			);
			this.conversation.replaceMessages(replacement);
		}

		const endedAt = new Date();
		try {
			return this.buildLegacyResult({
				runResult,
				thrownError,
				startedAt,
				endedAt,
			});
		} finally {
			this.activeRunId = null;
		}
	}

	/**
	 * Initialize the contribution registry once per session. Runs
	 * extension `setup()` callbacks so they can `registerTool`,
	 * `registerCommand`, `registerMessageBuilder`, and
	 * `registerProvider`. Matches legacy `Agent.ensureExtensionsInitialized`
	 * at pre-Step-9 `agent.ts:1122-1147`:
	 *
	 *   - on `hookErrorMode === "throw"`, setup failures propagate;
	 *   - otherwise setup failures emit a recoverable `error` event
	 *     via the legacy event channel and leave the registry
	 *     partially initialized.
	 *
	 * Idempotent: subsequent calls are no-ops once the registry has
	 * been activated.
	 */
	private async ensureExtensionsInitialized(): Promise<void> {
		if (this.extensionsInitialized) {
			return;
		}
		try {
			await this.contributionRegistry.initialize();
		} catch (error) {
			if (this.config.hookErrorMode === "throw") {
				throw error;
			}
			this.emitLegacyEvent({
				type: "error",
				error: error instanceof Error ? error : new Error(String(error)),
				recoverable: true,
				iteration: 0,
			});
		}
		this.extensionsInitialized = true;
	}

	private createRuntimeHooks(): Partial<AgentRuntimeHooks> {
		const hooks = mergeRuntimeHooks([
			this.config.hooks,
			...this.contributionRegistry
				.getValidatedExtensions()
				.map((extension) => extension.hooks),
		]);
		return {
			...hooks,
			beforeModel: async (ctx) => {
				const control = await hooks.beforeModel?.(ctx);
				if (control?.stop) {
					return control;
				}
				const messages = control?.messages ?? ctx.request.messages;
				const preparedMessages =
					await this.prepareMessagesForModelRequest(messages);
				return {
					...control,
					messages: preparedMessages,
				};
			},
		};
	}

	private createRuntimePrepareTurn(
		modelInfo: ModelInfo | undefined,
		tools: AgentTool[],
	):
		| ((context: AgentRuntimePrepareTurnContext) => Promise<
				| {
						messages?: readonly AgentMessage[];
						systemPrompt?: string;
				  }
				| undefined
		  >)
		| undefined {
		const prepareTurn = this.config.prepareTurn;
		if (!prepareTurn) {
			return undefined;
		}

		return async (context) => {
			const messages = agentMessagesToMessagesWithMetadata(context.messages);
			const apiMessages = await this.prepareProviderMessagesForApi(messages);
			const result = await prepareTurn({
				agentId: context.agentId,
				conversationId:
					context.conversationId ?? this.conversation.getConversationId(),
				parentAgentId: context.parentAgentId ?? null,
				iteration: context.iteration,
				messages,
				apiMessages,
				abortSignal: context.signal ?? new AbortController().signal,
				systemPrompt: context.systemPrompt ?? "",
				tools,
				model: {
					id: this.config.modelId,
					provider: this.config.providerId,
					info: modelInfo,
				},
				emitStatusNotice: context.emitStatusNotice,
			});
			if (!result) {
				return undefined;
			}
			return {
				...(result.messages
					? { messages: messagesToAgentMessages(result.messages) }
					: {}),
				...(result.systemPrompt !== undefined
					? { systemPrompt: result.systemPrompt }
					: {}),
			};
		};
	}

	private async prepareMessagesForModelRequest(
		messages: readonly AgentMessage[],
	): Promise<AgentMessage[]> {
		const providerMessages = await this.prepareProviderMessagesForApi(
			agentMessagesToMessages(messages),
		);
		return messagesToAgentMessages(providerMessages);
	}

	private async prepareProviderMessagesForApi(
		messages: MessageWithMetadata[],
	): Promise<MessageWithMetadata[]> {
		let providerMessages = messages;
		const messageBuilders =
			this.contributionRegistry.getRegistrySnapshot().messageBuilder;
		for (const builder of messageBuilders) {
			providerMessages = await builder.build(providerMessages);
		}
		return this.messageBuilder.buildForApi(providerMessages);
	}

	private handleRuntimeEvent(event: AgentRuntimeEvent): void {
		// Track tool-call records before translation so the timing data
		// is available to observers via `AgentResult.toolCalls`.
		switch (event.type) {
			case "message-added":
			case "assistant-message": {
				this.syncConversationFromRuntimeMessage(event.snapshot.messages, [
					event.message,
				]);
				break;
			}
			case "turn-started": {
				// Reset per-turn tool-outcome counters used by the
				// MistakeTracker wiring. Parity with pre-Step-9
				// agent.ts which accumulates per-iteration success/fail
				// counts and feeds them into recordMistake at the
				// turn boundary.
				this.currentTurnSuccessfulTools = 0;
				this.currentTurnFailedTools = 0;
				this.currentTurnFailureDetails = [];
				break;
			}
			case "tool-started": {
				this.toolStartedAt.set(event.toolCall.toolCallId, new Date());
				this.toolInputs.set(event.toolCall.toolCallId, event.toolCall.input);
				// Loop-detection inspection: identical consecutive
				// tool-call signatures trip the tracker. On "soft"
				// verdict we append a recovery notice; on "hard"
				// verdict we feed the mistake tracker with
				// forceAtLimit:true and abort. Parity with pre-Step-9
				// agent.ts L917-954.
				this.inspectLoopForToolCall(
					event.toolCall.toolName,
					event.toolCall.input,
					event.iteration,
				);
				break;
			}
			case "tool-finished": {
				const startedAt = this.toolStartedAt.get(event.toolCall.toolCallId);
				const endedAt = new Date();
				const input = this.toolInputs.get(event.toolCall.toolCallId);
				this.toolStartedAt.delete(event.toolCall.toolCallId);
				this.toolInputs.delete(event.toolCall.toolCallId);
				const resultPart = event.message.content.find(
					(part) => part.type === "tool-result",
				);
				const isError =
					resultPart?.type === "tool-result" && resultPart.isError === true;
				const errorText = isError
					? formatToolResultError(
							resultPart?.type === "tool-result"
								? resultPart.output
								: undefined,
						)
					: undefined;
				const record: ToolCallRecord = {
					id: event.toolCall.toolCallId,
					name: event.toolCall.toolName,
					input,
					output:
						resultPart?.type === "tool-result" ? resultPart.output : undefined,
					error: errorText,
					durationMs:
						startedAt === undefined
							? 0
							: endedAt.getTime() - startedAt.getTime(),
					startedAt: startedAt ?? endedAt,
					endedAt,
				};
				this.currentRunToolCalls.push(record);
				// Per-turn success/failure bookkeeping for MistakeTracker.
				if (isError) {
					this.currentTurnFailedTools += 1;
					if (errorText) {
						this.currentTurnFailureDetails.push(
							`[${event.toolCall.toolName}] ${errorText}`,
						);
					}
				} else {
					this.currentTurnSuccessfulTools += 1;
				}
				break;
			}
			case "turn-finished": {
				// End-of-turn mistake evaluation: legacy parity (pre-Step-9
				// agent.ts L972-997). When some tool calls failed and the
				// turn had no successful tool calls, record a mistake;
				// reset on productive turns.
				const failed = this.currentTurnFailedTools;
				const succeeded = this.currentTurnSuccessfulTools;
				if (failed > 0 && succeeded === 0) {
					const details = this.currentTurnFailureDetails.join("; ");
					this.enqueueMistakeRecord({
						iteration: event.iteration,
						reason: "tool_execution_failed",
						details: `${failed} tool call(s) failed${
							details ? `: ${details}` : ""
						}`,
					});
				} else if (succeeded > 0) {
					// Productive turn — reset the tracker so transient
					// failures don't accumulate across unrelated turns.
					this.mistakeTracker.reset();
				}
				break;
			}
			case "usage-updated": {
				this.currentRunUsage = {
					inputTokens: event.usage.inputTokens,
					outputTokens: event.usage.outputTokens,
					cacheReadTokens:
						event.usage.cacheReadTokens > 0
							? event.usage.cacheReadTokens
							: undefined,
					cacheWriteTokens:
						event.usage.cacheWriteTokens > 0
							? event.usage.cacheWriteTokens
							: undefined,
					totalCost: event.usage.totalCost,
				};
				break;
			}
			default:
				break;
		}
		for (const legacy of this.eventAdapter.translate(event)) {
			this.emitLegacyEvent(legacy);
		}
	}

	private syncConversationFromRuntimeMessage(
		snapshotMessages: readonly AgentMessage[],
		fallbackMessages: readonly AgentMessage[],
	): void {
		if (snapshotMessages.length > 0) {
			this.conversation.replaceMessages(
				agentMessagesToMessagesWithMetadata(snapshotMessages),
			);
			return;
		}
		if (fallbackMessages.length === 0) return;
		const existingIds = new Set(
			this.conversation
				.getMessages()
				.map((message) => message.id)
				.filter((id): id is string => typeof id === "string"),
		);
		const newMessages = agentMessagesToMessagesWithMetadata(
			fallbackMessages,
		).filter((message) => !message.id || !existingIds.has(message.id));
		if (newMessages.length === 0) return;
		this.conversation.replaceMessages([
			...this.conversation.getMessages(),
			...newMessages,
		]);
	}

	private emitLegacyEvent(event: AgentEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch (error) {
				this.logger?.error?.("SessionRuntime event listener threw", {
					agentId: this.agentId,
					error,
				});
			}
		}
	}

	/**
	 * Feed the `LoopDetectionTracker` with a tool-call and react to
	 * the returned verdict. Parity with pre-Step-9 agent.ts L917-954:
	 *
	 *   - `"soft"`  → append a recovery notice telling the model to
	 *                 change approach;
	 *   - `"hard"`  → feed `MistakeTracker.record` with
	 *                 `forceAtLimit:true`. When the tracker returns
	 *                 `action: "stop"`, append the stop notice and
	 *                 abort the active runtime.
	 */
	private inspectLoopForToolCall(
		toolName: string,
		input: unknown,
		iteration: number,
	): void {
		if (this.trackerAbortInFlight || this.loopDetectionDisabled) {
			return;
		}
		const verdict = this.loopTracker.inspect({ name: toolName, input });
		if (verdict.kind === "ok") {
			return;
		}
		if (verdict.kind === "soft") {
			if (verdict.message) {
				this.conversation.appendMessage({
					role: "user",
					content: [{ type: "text", text: verdict.message }],
				});
			}
			return;
		}
		// Hard escalation.
		this.enqueueMistakeRecord({
			iteration,
			reason: "tool_execution_failed",
			forceAtLimit: true,
			details:
				verdict.message ??
				`Detected repeated tool calls to \`${toolName}\`; stopping to avoid a loop.`,
		});
	}

	/**
	 * Enqueue a mistake-record onto the serial tracker work chain. The
	 * runtime event stream is synchronous but `MistakeTracker.record`
	 * is async — chaining onto a shared promise preserves ordering
	 * (legacy parity) and lets `executeRun` await draining before
	 * returning the `AgentResult`.
	 *
	 * When the tracker returns `action: "stop"`, append the stop notice
	 * to the conversation and abort the active runtime so the run ends
	 * with `finishReason: "aborted"`.
	 */
	private enqueueMistakeRecord(input: {
		iteration: number;
		reason: "api_error" | "invalid_tool_call" | "tool_execution_failed";
		details?: string;
		forceAtLimit?: boolean;
	}): void {
		if (this.trackerAbortInFlight) {
			return;
		}
		this.activeTrackerWork = this.activeTrackerWork.then(async () => {
			if (this.trackerAbortInFlight) {
				return;
			}
			const outcome = await this.mistakeTracker.record(input);
			if (outcome.action === "stop") {
				this.trackerAbortInFlight = true;
				this.conversation.appendMessage({
					role: "user",
					content: [{ type: "text", text: outcome.message }],
				});
				this.activeRuntime?.abort(outcome.reason ?? outcome.message);
			}
		});
	}

	private buildLegacyResult(input: {
		runResult: AgentRunResult | undefined;
		thrownError: Error | undefined;
		startedAt: Date;
		endedAt: Date;
	}): AgentResult {
		const { runResult, thrownError, startedAt, endedAt } = input;
		const durationMs = endedAt.getTime() - startedAt.getTime();
		const finishReason: AgentFinishReason = thrownError
			? "error"
			: deriveFinishReason(runResult);
		const text =
			runResult?.outputText ||
			(runResult?.status === "failed" ? runResult.error?.message : undefined) ||
			"";
		const usage: LegacyAgentUsage = runResult
			? {
					inputTokens: runResult.usage.inputTokens,
					outputTokens: runResult.usage.outputTokens,
					cacheReadTokens:
						runResult.usage.cacheReadTokens > 0
							? runResult.usage.cacheReadTokens
							: undefined,
					cacheWriteTokens:
						runResult.usage.cacheWriteTokens > 0
							? runResult.usage.cacheWriteTokens
							: undefined,
					totalCost: runResult.usage.totalCost,
				}
			: this.currentRunUsage;
		const messages = runResult
			? agentMessagesToMessagesWithMetadata(runResult.messages)
			: this.conversation.getMessages();
		const modelInfo = tryGetModelInfo(this.config);
		if (thrownError) {
			throw thrownError;
		}
		return {
			text,
			usage,
			messages,
			toolCalls: this.currentRunToolCalls,
			iterations: runResult?.iterations ?? 0,
			finishReason,
			model: {
				id: this.config.modelId,
				provider: this.config.providerId,
				info: modelInfo,
			},
			startedAt,
			endedAt,
			durationMs,
		};
	}
}

// =============================================================================
// Module-level helpers
// =============================================================================

function leveledLog(
	logger: BasicLogger | undefined,
	level: "debug" | "info" | "warn" | "error",
	message: string,
	metadata?: Record<string, unknown>,
): void {
	if (!logger) {
		return;
	}
	if (level === "debug") {
		logger.debug(message, metadata);
		return;
	}
	if (level === "error" && logger.error) {
		logger.error(message, metadata);
		return;
	}
	const severity: "info" | "warn" | "error" =
		level === "warn" ? "warn" : level === "error" ? "error" : "info";
	logger.log(message, { ...metadata, severity });
}

function deriveFinishReason(
	runResult: AgentRunResult | undefined,
): AgentFinishReason {
	if (!runResult) {
		return "error";
	}
	switch (runResult.status) {
		case "completed":
			return "completed";
		case "aborted":
			return "aborted";
		case "failed":
			return "error";
	}
}

async function buildUserTurnContent(
	userMessage: string,
	userImages: string[] | undefined,
	userFiles: string[] | undefined,
	loader: AgentConfig["userFileContentLoader"],
): Promise<Message["content"]> {
	// Import lazily to avoid a circular-import hazard via runtime barrels.
	const { buildInitialUserContent } = await import("./user-input-builder");
	return buildInitialUserContent(userMessage, userImages, userFiles, loader);
}

function tryGetModelInfo(config: AgentConfig): ModelInfo | undefined {
	if (config.knownModels?.[config.modelId]) {
		return config.knownModels[config.modelId];
	}
	const resolvedKnownModels = resolveKnownModelsFromConfig(config);
	if (resolvedKnownModels?.[config.modelId]) {
		return resolvedKnownModels[config.modelId];
	}
	return undefined;
}
