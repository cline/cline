// VscodeSessionHost — wraps ClineCore with VSCode-specific customizations
//
// Uses ClineCore.create() so the SDK owns session input normalization,
// lifecycle bootstrapping, and host selection while the VSCode extension
// still provides its custom McpHub-backed runtime builder.

import {
	type ApplyPatchExecutor,
	ClineCore,
	type ClineCoreListHistoryOptions,
	type ClineCoreStartInput,
	type CompareCheckpointInput,
	type CompareCheckpointResult,
	type CoreSessionEvent,
	type EditorExecutor,
	type HookEventPayload,
	type ITelemetryService,
	type PendingPromptMutationResult,
	type PendingPromptsDeleteInput,
	type PendingPromptsListInput,
	type PendingPromptsUpdateInput,
	type PreparedRemoteConfigCoreIntegration,
	type RestoreInput,
	type RestoreResult,
	type SendSessionInput,
	type SessionAccumulatedUsage,
	type SessionCompactionState,
	type SessionHistoryRecord,
	type SessionPendingPrompt,
	type SessionRecord,
	type StartSessionInput,
	type StartSessionResult,
	type ToolExecutors,
} from "@cline/core"
import {
	type AgentToolContext,
	RUNTIME_CONFIG_EXTENSION_KINDS,
	type ToolApprovalRequest,
	type ToolApprovalResult,
	type ToolPolicy,
} from "@cline/shared"
import { StateManager } from "@/core/storage/StateManager"
import type { VscodeTerminalManager } from "@/hosts/vscode/terminal/VscodeTerminalManager"
import { getDistinctId } from "@/services/logging/distinctId"
import type { McpHub } from "@/services/mcp/McpHub"
import { Logger } from "@/shared/services/Logger"
import type { SdkForegroundCommandCoordinator } from "./sdk-foreground-command-coordinator"
import type { SdkSessionHost } from "./session-host"
import { createVscodeExtraTools } from "./vscode-runtime-builder"
import { getEffectiveTerminalExecutionMode } from "./vscode-terminal-execution-mode"

export interface VscodeSessionHostOptions {
	mcpHub: McpHub
	requestToolApproval?: (request: {
		agentId: string
		conversationId: string
		iteration: number
		toolCallId: string
		toolName: string
		input: unknown
		policy: { enabled: boolean; autoApprove: boolean }
	}) => Promise<{ approved: boolean; reason?: string }>
	/** Executor for the SDK's built-in ask_question tool (equivalent to classic ask_followup_question). */
	askQuestion?: (question: string, options: string[], context: AgentToolContext) => Promise<string>
	/**
	 * Custom `editor` tool executor (diff-view edit pipeline). Fully replaces the SDK's
	 * default disk-writing executor.
	 */
	editorExecutor?: EditorExecutor
	/**
	 * Custom `apply_patch` tool executor (reverts the approval-time diff preview before
	 * delegating to the SDK's default patch application).
	 */
	applyPatchExecutor?: ApplyPatchExecutor
	/**
	 * Custom `read_files` executor (resolves relative paths against the workspace root
	 * instead of the extension host's process.cwd(), which is usually "/").
	 */
	readFileExecutor?: ToolExecutors["readFile"]
	/** Per-tool approval policies derived from the user's auto-approval settings. */
	toolPolicies?: Record<string, ToolPolicy>
	/** Shared SDK telemetry service owned by SdkController. */
	telemetry?: ITelemetryService
	/** Resolves once the applicable remote config is ready for a new SDK session. */
	beforeStartSession?: () => Promise<void>
	/** Returns the latest prepared remote-config integration, if remote config is active. */
	getRemoteConfigIntegration?: () => PreparedRemoteConfigCoreIntegration | undefined
	/**
	 * Lazy factory for the VscodeTerminalManager.
	 * When provided, the SDK's built-in `run_commands` is suppressed and replaced
	 * with a custom tool that supports foreground/background terminal execution.
	 */
	getTerminalManager?: () => VscodeTerminalManager
	/** Registry of in-flight foreground executions for "Proceed While Running". */
	foregroundCommands?: SdkForegroundCommandCoordinator
}

export class VscodeSessionHost implements SdkSessionHost {
	readonly runtimeAddress: string | undefined
	private readonly inner: ClineCore
	private readonly prepareStartSessionInput?: (input: ClineCoreStartInput) => Promise<ClineCoreStartInput>

	private constructor(
		inner: ClineCore,
		prepareStartSessionInput?: (input: ClineCoreStartInput) => Promise<ClineCoreStartInput>,
	) {
		this.inner = inner
		this.runtimeAddress = inner.runtimeAddress
		this.prepareStartSessionInput = prepareStartSessionInput
	}
	updateSessionModel?(sessionId: string, modelId: string): Promise<void> {
		return this.inner.updateSessionModel(sessionId, modelId)
	}

	static async create(options: VscodeSessionHostOptions): Promise<VscodeSessionHost> {
		// Build tool executor capabilities from options — only include keys that are provided.
		// When a terminal manager is available, suppress the SDK's built-in run_commands
		// tool by setting bash to undefined. Our custom run_commands (provided via
		// extraTools) replaces it with foreground/background terminal support.
		const toolExecutors: Partial<ToolExecutors> = {}
		if (options.askQuestion) {
			toolExecutors.askQuestion = options.askQuestion
		}
		if (options.editorExecutor) {
			toolExecutors.editor = options.editorExecutor
		}
		if (options.applyPatchExecutor) {
			toolExecutors.applyPatch = options.applyPatchExecutor
		}
		if (options.readFileExecutor) {
			toolExecutors.readFile = options.readFileExecutor
		}
		if (options.getTerminalManager) {
			// Setting bash to undefined suppresses the SDK's createShellTool():
			// createDefaultTools() checks `enableBash && executors.bash` — falsy
			// bash means no built-in run_commands tool is created.
			;(toolExecutors as Record<string, unknown>).bash = undefined
		}

		// Single funnel for session-start preparation: waits on the remote-config
		// readiness/policy gate, applies the remote-config integration, and adds
		// the VSCode extra tools. Used by ClineCore's prepare hook for normal
		// starts AND by restore() for checkpoint-restore replacement sessions,
		// which ClineCore starts without running the prepare hook.
		const prepareStartSessionInput = async (input: ClineCoreStartInput): Promise<ClineCoreStartInput> => {
			await options.beforeStartSession?.()
			// Read only after the readiness gate: it may have atomically replaced
			// the integration that must be captured by this session.
			const remoteConfigIntegration = options.getRemoteConfigIntegration?.()
			const inputWithRemoteConfig = remoteConfigIntegration
				? await remoteConfigIntegration.applyToStartSessionInput(input)
				: input
			const requestedTerminalExecutionMode = StateManager.get().getGlobalStateKey("vscodeTerminalExecutionMode")
			const extraTools = await createVscodeExtraTools(options.mcpHub, {
				cwd: inputWithRemoteConfig.config.cwd,
				getTerminalManager: options.getTerminalManager,
				vscodeTerminalExecutionMode: getEffectiveTerminalExecutionMode(requestedTerminalExecutionMode),
				foregroundCommands: options.foregroundCommands,
			})
			return {
				...inputWithRemoteConfig,
				source: inputWithRemoteConfig.source ?? "vscode",
				// The extension runs file hooks through its own hooks adapter
				// (status chips, hooksEnabled setting, HookFactory discovery).
				// Exclude the SDK core's file-hook extension or every hook
				// would execute twice per event.
				localRuntime: {
					...(inputWithRemoteConfig.localRuntime ?? {}),
					configExtensions: (
						inputWithRemoteConfig.localRuntime?.configExtensions ?? RUNTIME_CONFIG_EXTENSION_KINDS
					).filter((kind) => kind !== "hooks"),
				},
				config: {
					...inputWithRemoteConfig.config,
					telemetry: inputWithRemoteConfig.config.telemetry ?? options.telemetry,
					extraTools: [...(inputWithRemoteConfig.config.extraTools ?? []), ...extraTools],
				},
			}
		}

		const inner = await ClineCore.create({
			backendMode: "local",
			capabilities: {
				requestToolApproval: options.requestToolApproval as
					| ((request: ToolApprovalRequest) => Promise<ToolApprovalResult>)
					| undefined,
				toolExecutors: Object.keys(toolExecutors).length > 0 ? toolExecutors : undefined,
			},
			toolPolicies: options.toolPolicies,
			telemetry: options.telemetry,
			distinctId: getDistinctId() || undefined,
			prepare: async () => ({
				applyToStartSessionInput: prepareStartSessionInput,
			}),
		})

		Logger.log("[VscodeSessionHost] Initialized with ClineCore + VSCode extra tools")
		if (options.getTerminalManager) {
			Logger.log("[VscodeSessionHost] SDK run_commands suppressed; using custom foreground/background terminal tool")
		}
		return new VscodeSessionHost(inner, prepareStartSessionInput)
	}

	async start(input: StartSessionInput): Promise<StartSessionResult>
	async start(input: ClineCoreStartInput): Promise<StartSessionResult>
	async start(input: StartSessionInput | ClineCoreStartInput): Promise<StartSessionResult> {
		return this.inner.start(input as ClineCoreStartInput)
	}

	async send(input: SendSessionInput) {
		Logger.log(`[VscodeSessionHost] send() called: sessionId=${input.sessionId}, prompt=${input.prompt?.substring(0, 50)}`)
		try {
			const result = await this.inner.send(input)
			Logger.log(
				`[VscodeSessionHost] send() completed: text=${result?.text?.substring(0, 100)}, inputTokens=${result?.usage?.inputTokens}`,
			)
			return result
		} catch (error) {
			Logger.error("[VscodeSessionHost] send() error:", error)
			throw error
		}
	}

	async getAccumulatedUsage(sessionId: string): Promise<SessionAccumulatedUsage | undefined> {
		return (await this.inner.getAccumulatedUsage(sessionId))?.usage
	}

	async abort(sessionId: string, reason?: unknown): Promise<void> {
		try {
			return await this.inner.abort(sessionId, reason)
		} catch (error) {
			// AbortError is expected when cancelling a running task —
			// AbortController.abort() fires synchronously and may cause
			// listeners to throw. Suppress it here so callers don't
			// need to handle it.
			if (error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"))) {
				Logger.debug(`[VscodeSessionHost] AbortError during abort (expected): ${sessionId}`)
				return
			}
			throw error
		}
	}

	async stop(sessionId: string): Promise<void> {
		return this.inner.stop(sessionId)
	}

	async dispose(reason?: string): Promise<void> {
		return this.inner.dispose(reason)
	}

	async get(sessionId: string): Promise<SessionRecord | undefined> {
		return this.inner.get(sessionId)
	}

	async list(limit?: number, options: Omit<ClineCoreListHistoryOptions, "limit"> = {}): Promise<SessionHistoryRecord[]> {
		return this.inner.list(limit, options)
	}

	async listHistory(options: ClineCoreListHistoryOptions = {}): Promise<SessionHistoryRecord[]> {
		return this.inner.listHistory(options)
	}

	async delete(sessionId: string): Promise<boolean> {
		return this.inner.delete(sessionId)
	}

	async readMessages(sessionId: string) {
		return this.inner.readMessages(sessionId)
	}

	async readLiveMessages(sessionId: string) {
		return this.inner.readLiveMessages(sessionId)
	}

	async updateSessionCompactionState(sessionId: string, state: SessionCompactionState): Promise<{ updated: boolean }> {
		return this.inner.updateSessionCompactionState(sessionId, state)
	}

	async restore(input: RestoreInput): Promise<RestoreResult> {
		// ClineCore.restore starts the checkpoint-restore replacement session
		// WITHOUT running the prepare hook, which would bypass the remote-config
		// session gate and integration. Run the same preparation here.
		if (input.start && this.prepareStartSessionInput) {
			input = { ...input, start: await this.prepareStartSessionInput(input.start) }
		}
		return this.inner.restore(input)
	}

	async compareCheckpoint(input: CompareCheckpointInput): Promise<CompareCheckpointResult> {
		return this.inner.compareCheckpoint(input)
	}

	async update(
		sessionId: string,
		updates: {
			prompt?: string | null
			metadata?: Record<string, unknown> | null
			title?: string | null
		},
	): Promise<{ updated: boolean }> {
		return this.inner.update(sessionId, updates)
	}

	async handleHookEvent(payload: HookEventPayload): Promise<void> {
		return this.inner.ingestHookEvent(payload)
	}

	pendingPrompts(action: "list", input: PendingPromptsListInput): Promise<SessionPendingPrompt[]>
	pendingPrompts(action: "update", input: PendingPromptsUpdateInput): Promise<PendingPromptMutationResult>
	pendingPrompts(action: "delete", input: PendingPromptsDeleteInput): Promise<PendingPromptMutationResult>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	pendingPrompts(action: any, input: any): any {
		switch (action) {
			case "list":
				return this.inner.pendingPrompts.list(input)
			case "update":
				return this.inner.pendingPrompts.update(input)
			case "delete":
				return this.inner.pendingPrompts.delete(input)
			default:
				throw new Error(`Unsupported pending prompt action: ${String(action)}`)
		}
	}

	subscribe(listener: (event: CoreSessionEvent) => void): () => void {
		return this.inner.subscribe(listener)
	}
}
