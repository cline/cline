// VscodeSessionHost — wraps ClineCore with VSCode-specific customizations
//
// Uses ClineCore.create() so the SDK owns session input normalization,
// lifecycle bootstrapping, and host selection while the VSCode extension
// still provides its custom McpHub-backed runtime builder.

import {
	ClineCore,
	type ClineCoreStartInput,
	type CoreSessionEvent,
	type HookEventPayload,
	type SendSessionInput,
	type SessionAccumulatedUsage,
	type SessionHost,
	type SessionRecord,
	type StartSessionInput,
	type StartSessionResult,
	type ToolExecutors,
} from "@clinebot/core"
import { type ToolApprovalRequest, type ToolApprovalResult, type ToolContext } from "@clinebot/shared"
import { getDistinctId } from "@/services/logging/distinctId"
import type { McpHub } from "@/services/mcp/McpHub"
import { Logger } from "@/shared/services/Logger"
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
	askQuestion?: (question: string, options: string[], context: ToolContext) => Promise<string>
}

export class VscodeSessionHost implements SessionHost {
	readonly runtimeAddress: string | undefined
	private readonly inner: ClineCore

	private constructor(inner: ClineCore) {
		this.inner = inner
		this.runtimeAddress = inner.runtimeAddress
	}

	static async create(options: VscodeSessionHostOptions): Promise<VscodeSessionHost> {
		// Build defaultToolExecutors from options — only include keys that are provided
		const defaultToolExecutors: Partial<ToolExecutors> = {}
		if (options.askQuestion) {
			defaultToolExecutors.askQuestion = options.askQuestion
		}

		const inner = await ClineCore.create({
			backendMode: "local",
			requestToolApproval: options.requestToolApproval as
				| ((request: ToolApprovalRequest) => Promise<ToolApprovalResult>)
				| undefined,
			defaultToolExecutors: Object.keys(defaultToolExecutors).length > 0 ? defaultToolExecutors : undefined,
			distinctId: getDistinctId() || undefined,
			prepare: async () => ({
				applyToStartSessionInput: async (input: ClineCoreStartInput): Promise<ClineCoreStartInput> => {
					const extraTools = await createVscodeExtraTools(options.mcpHub)
					return {
						...input,
						source: input.source ?? "vscode",
						config: {
							...input.config,
							extraTools: [...(input.config.extraTools ?? []), ...extraTools],
						},
					}
				},
			}),
		})

		Logger.log("[VscodeSessionHost] Initialized with ClineCore + VSCode extra tools")
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
		return this.inner.getAccumulatedUsage(sessionId)
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

	async list(limit?: number): Promise<SessionRecord[]> {
		return this.inner.list(limit)
	}

	async delete(sessionId: string): Promise<boolean> {
		return this.inner.delete(sessionId)
	}

	async readMessages(sessionId: string) {
		return this.inner.readMessages(sessionId)
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
		return this.inner.handleHookEvent(payload)
	}

	subscribe(listener: (event: CoreSessionEvent) => void): () => void {
		return this.inner.subscribe(listener)
	}
}
