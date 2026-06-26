// VscodeSessionHost — wraps ClineCore with VSCode-specific customizations
//
// Uses ClineCore.create() so the SDK owns session input normalization,
// lifecycle bootstrapping, and host selection while the VSCode extension
// still provides its custom McpHub-backed runtime builder.

import {
	ClineCore,
	type ClineCoreListHistoryOptions,
	type ClineCoreStartInput,
	type CoreSessionEvent,
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
	type SessionHistoryRecord,
	type SessionPendingPrompt,
	type SessionRecord,
	type StartSessionInput,
	type StartSessionResult,
	type ToolExecutors,
} from "@cline/core"
import { type AgentToolContext, type ToolApprovalRequest, type ToolApprovalResult, type ToolPolicy } from "@cline/shared"
import { StateManager } from "@/core/storage/StateManager"
import type { VscodeTerminalManager } from "@/hosts/vscode/terminal/VscodeTerminalManager"
import { getDistinctId } from "@/services/logging/distinctId"
import type { McpHub } from "@/services/mcp/McpHub"
import { Logger } from "@/shared/services/Logger"
import type { SdkSessionHost } from "./session-host"
import { createVscodeExtraTools } from "./vscode-runtime-builder"

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
	/** Per-tool approval policies derived from the user's auto-approval settings. */
	toolPolicies?: Record<string, ToolPolicy>
	/** Shared SDK telemetry service owned by SdkController. */
	telemetry?: ITelemetryService
	/** Returns the latest prepared remote-config integration, if remote config is active. */
	getRemoteConfigIntegration?: () => PreparedRemoteConfigCoreIntegration | undefined
	/**
	 * Lazy factory for the VscodeTerminalManager.
	 * When provided, the SDK's built-in `run_commands` is suppressed and replaced
	 * with a custom tool that supports foreground/background terminal execution.
	 */
	getTerminalManager?: () => VscodeTerminalManager
}

export class VscodeSessionHost implements SdkSessionHost {
	readonly runtimeAddress: string | undefined
	private readonly inner: ClineCore

	private constructor(inner: ClineCore) {
		this.inner = inner
		this.runtimeAddress = inner.runtimeAddress
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
		if (options.getTerminalManager) {
			// Setting bash to undefined suppresses the SDK's createShellTool():
			// createDefaultTools() checks `enableBash && executors.bash` — falsy
			// bash means no built-in run_commands tool is created.
			;(toolExecutors as Record<string, unknown>).bash = undefined
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
				applyToStartSessionInput: async (input: ClineCoreStartInput): Promise<ClineCoreStartInput> => {
					const remoteConfigIntegration = options.getRemoteConfigIntegration?.()
					const inputWithRemoteConfig = remoteConfigIntegration
						? await remoteConfigIntegration.applyToStartSessionInput(input)
						: input
					const terminalExecutionMode = StateManager.get().getGlobalStateKey("vscodeTerminalExecutionMode")
					const extraTools = await createVscodeExtraTools(options.mcpHub, {
						cwd: inputWithRemoteConfig.config.cwd,
						getTerminalManager: options.getTerminalManager,
						vscodeTerminalExecutionMode: terminalExecutionMode,
					})
					return {
						...inputWithRemoteConfig,
						source: inputWithRemoteConfig.source ?? "vscode",
						config: {
							...inputWithRemoteConfig.config,
							telemetry: inputWithRemoteConfig.config.telemetry ?? options.telemetry,
							extraTools: [...(inputWithRemoteConfig.config.extraTools ?? []), ...extraTools],
						},
					}
				},
			}),
		})

		Logger.log("[VscodeSessionHost] Initialized with ClineCore + VSCode extra tools")
		if (options.getTerminalManager) {
			Logger.log("[VscodeSessionHost] SDK run_commands suppressed; using custom foreground/background terminal tool")
		}
		return new VscodeSessionHost(inner)
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

	async restore(input: RestoreInput): Promise<RestoreResult> {
		return this.inner.restore(input)
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
