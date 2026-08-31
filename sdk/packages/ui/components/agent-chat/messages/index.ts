/**
 * Chat transcript presentation for browser hosts: message bubbles, tool call
 * rows, run grouping/collapsing, approvals, and image viewers built on the
 * agent-chat primitives. Hosts own the runtime — transport, approval policy,
 * clipboard, confirmation dialogs, and the Markdown renderer (passed in via
 * the `markdown` component prop).
 *
 * Requires the optional `lucide-react` peer (tool/action icons) and, for
 * `ToolMessageBlock`, the optional `ansi-to-react` peer (command output).
 */
export type {
	ChatMarkdownComponent,
	ChatMarkdownProps,
	ChatMessage,
	ChatMessageCheckpoint,
	ChatMessageImage,
	ChatMessageImageMediaType,
	ChatMessageMedia,
	ChatMessageMeta,
	ChatMessageRole,
} from "./chat-message.js";
export { STREAMING_TITLE_CLASS } from "./chat-message.js";
export {
	appendCappedCommandOutput,
	MAX_LIVE_COMMAND_OUTPUT_CHARS,
} from "./command-output.js";
export type { ChatRenderItem, CollapseWorkOptions } from "./group-messages.js";
export {
	buildPreviousTimestampMap,
	buildUserRunCountMap,
	collapseCompletedWork,
	formatThoughtLabel,
	getThoughtDurationMilliseconds,
	groupChatMessages,
	hasMessageReasoning,
	isReasoningOnlyAssistantMessage,
	isSystemSteeringMessage,
} from "./group-messages.js";
export { MessageImageCarousel } from "./image-carousel.js";
export { ChatImageLightbox } from "./image-lightbox.js";
export { MessageBubble } from "./message-bubble.js";
export { formatChatMessageContent } from "./message-content.js";
export { ReasoningBlock } from "./reasoning-block.js";
export type { ToolApprovalRequestItem } from "./tool-approval-panel.js";
export {
	formatApprovalTimestamp,
	ToolApprovalPanel,
} from "./tool-approval-panel.js";
export {
	getToolNameIcon,
	TOOL_KIND_ICONS,
	TOOL_NAME_ICONS,
} from "./tool-icons.js";
export { ToolMessageBlock } from "./tool-message-block.js";
export type { ToolPayload, ToolPresentation } from "./tool-summaries.js";
export {
	buildToolPresentation,
	extractRunCommandOutput,
	extractSubmitSummaryText,
	formatToolValue,
	normalizeDisplayValue,
	parseJsonString,
	parseToolPayload,
} from "./tool-summaries.js";
export { WorkBlock } from "./work-block.js";
