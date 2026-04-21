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
	type RuntimeHost,
	type SendSessionInput,
	type SessionAccumulatedUsage,
	type SessionRecord,
	type StartSessionInput,
	type StartSessionResult,
} from "@clinebot/core"
import { type ToolApprovalRequest, type ToolApprovalResult } from "@clinebot/shared"
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
}

export class VscodeSessionHost implements RuntimeHost {
	readonly runtimeAddress: string | undefined
	private readonly inner: ClineCore

	private constructor(inner: ClineCore) {
		this.inner = inner
		this.runtimeAddress = inner.runtimeAddress
	}

	static async create(options: VscodeSessionHostOptions): Promise<VscodeSessionHost> {
		const inner = await ClineCore.create({
			backendMode: "local",
			requestToolApproval: options.requestToolApproval as
				| ((request: ToolApprovalRequest) => Promise<ToolApprovalResult>)
				| undefined,
			distinctId: getDistinctId() || undefined,
			prepare: () => ({
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
		return this.inner.start(input)
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
		return this.inner.abort(sessionId, reason)
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
