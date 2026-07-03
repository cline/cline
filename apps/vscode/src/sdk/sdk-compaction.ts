// Replaces classic manual-condense handling from src/core/task (see origin/main)
//
// Manual context compaction for the VSCode SDK adapter. This mirrors the CLI's
// apps/cli/src/runtime/interactive/compaction.ts (`compactInteractiveMessages`):
// it builds a manual-mode compaction `prepareTurn` via the SDK's
// `createContextCompactionPrepareTurn` and runs it against the current session
// transcript, returning the compacted messages.
//
// The CLI then restarts the session with the compacted messages; the VSCode
// adapter does the same in SdkCompactionCoordinator. Keeping the actual
// compaction effect in the SDK (rather than asking the model to "summarize the
// conversation") is what makes the compact button real instead of improvised.

import { type CoreSessionConfig, createContextCompactionPrepareTurn } from "@cline/core"
import type { Message as SdkMessage, ModelInfo as SdkModelInfo } from "@cline/llms"
import { Logger } from "@/shared/services/Logger"

// When the active model does not declare a context window, fall back to a
// conservative input budget so manual compaction still has a target to shrink
// toward. Matches the CLI's FALLBACK_MANUAL_COMPACTION_MAX_INPUT_TOKENS.
const FALLBACK_MANUAL_COMPACTION_MAX_INPUT_TOKENS = 64_000

export interface CompactSessionMessagesInput {
	/** Provider/model/compaction config for the active session. */
	config: Pick<
		CoreSessionConfig,
		"providerConfig" | "providerId" | "modelId" | "knownModels" | "compaction" | "logger" | "telemetry"
	>
	/** The active session id (used for telemetry keying). */
	sessionId: string
	/** The conversation transcript to compact (SDK message shape). */
	messages: SdkMessage[]
}

export interface CompactSessionMessagesResult {
	compacted: boolean
	messages: SdkMessage[]
}

/**
 * Run a manual context compaction over the supplied messages.
 *
 * Returns `{ compacted: false }` (with the original messages) when there is
 * nothing to compact or the configured strategy declines to compact.
 */
export async function compactSessionMessages(input: CompactSessionMessagesInput): Promise<CompactSessionMessagesResult> {
	if (input.messages.length === 0) {
		return { compacted: false, messages: input.messages }
	}

	const modelInfo: SdkModelInfo | undefined = input.config.knownModels?.[input.config.modelId]
	const maxInputTokens =
		input.config.compaction?.maxInputTokens ??
		modelInfo?.maxInputTokens ??
		modelInfo?.contextWindow ??
		FALLBACK_MANUAL_COMPACTION_MAX_INPUT_TOKENS

	const compact = createContextCompactionPrepareTurn(
		{
			providerConfig: input.config.providerConfig,
			providerId: input.config.providerId,
			modelId: input.config.modelId,
			// Force-enable compaction for this manual request even when
			// auto-condense is off — the user explicitly asked for it.
			compaction: {
				...input.config.compaction,
				enabled: true,
				strategy: "agentic",
			},
			logger: input.config.logger,
			// Forward telemetry + sessionId so manual compactions emit
			// `task.compaction_executed` / `task.compaction_skipped` events,
			// matching the CLI and auto-compaction.
			telemetry: input.config.telemetry,
			sessionId: input.sessionId,
		},
		{ mode: "manual" },
	)
	if (!compact) {
		Logger.warn("[SdkCompaction] Compaction prepareTurn unavailable; skipping manual compaction")
		return { compacted: false, messages: input.messages }
	}

	const result = await compact({
		agentId: "cline-vscode",
		conversationId: input.sessionId,
		parentAgentId: null,
		iteration: 0,
		messages: input.messages,
		apiMessages: input.messages,
		abortSignal: new AbortController().signal,
		systemPrompt: "",
		tools: [],
		model: {
			id: input.config.modelId,
			provider: input.config.providerId,
			info: {
				...(modelInfo ?? {}),
				id: modelInfo?.id ?? input.config.modelId,
				maxInputTokens,
			},
		},
	})
	if (!result) {
		return { compacted: false, messages: input.messages }
	}
	return { compacted: true, messages: result.messages }
}
