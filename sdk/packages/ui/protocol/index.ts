/**
 * Shared UI protocol surface for `@cline/ui` consumers. The canonical
 * message contracts live in `@cline/shared` (single source of truth for
 * hosts and SDK packages); this entry re-exports them alongside the
 * renderer-independent transcript accumulator that browser and terminal
 * clients share.
 */

export type {
	ClineSubscriptionPlan,
	TeamUiEvent,
	UiChatAttachments,
	UiChatMessage,
	UiChatMessageBlock,
	UiChatToolCall,
	UiCheckpointInfo,
	UiConnection,
	UiDefaults,
	UiInboundMessage,
	UiModelInfo,
	UiOutboundMessage,
	UiPendingPrompt,
	UiPendingPromptSubmitted,
	UiPendingPromptsState,
	UiPromptDelivery,
	UiProviderInfo,
	UiReasonLevel,
	UiSessionConfig,
	UiSessionSummary,
	UiToolApprovalRequest,
	UiToolEvent,
	UiUsage,
} from "@cline/shared";
export {
	appendUserPrompt,
	createUiTranscriptState,
	reduceUiMessage,
	type UiTranscriptBlock,
	type UiTranscriptState,
} from "./transcript";
