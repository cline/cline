/**
 * Messages Module - Exports for Cline message types and ATIF trajectory support
 */
// ATIF types
export type {
	ATIFAgentSchema,
	ATIFFinalMetricsSchema,
	ATIFMetricsSchema,
	ATIFObservationResultSchema,
	ATIFObservationSchema,
	ATIFSourceType,
	ATIFStepObject,
	ATIFSubagentTrajectoryRefSchema,
	ATIFToolCallSchema,
	ATIFTrajectory,
} from "./atif"
export { ATIF_AGENT_NAME, ATIF_SCHEMA_VERSION, CLINE_ROLE_TO_ATIF_SOURCE } from "./atif"
// ATIF conversion utilities
export type { ClineToATIFOptions } from "./atif-converter"
export {
	convertATIFStepToClineMessage,
	convertATIFToClineMessages,
	convertClineMessagesToATIF,
	convertClineMessageToATIFStep,
	parseATIFTrajectory,
	serializeATIFTrajectory,
	validateClineMessageForATIF,
} from "./atif-converter"
// Core content types
export type {
	ClineAssistantContent,
	ClineAssistantRedactedThinkingBlock,
	ClineAssistantThinkingBlock,
	ClineAssistantToolUseBlock,
	ClineContent,
	ClineDocumentContentBlock,
	ClineImageContentBlock,
	ClineMessageRole,
	ClinePromptInputContent,
	ClineReasoningDetailParam,
	ClineStorageMessage,
	ClineTextContentBlock,
	ClineToolResponseContent,
	ClineUserContent,
	ClineUserToolResultContentBlock,
} from "./content"
export { cleanContentBlock, convertClineStorageToAnthropicMessage, REASONING_DETAILS_PROVIDERS } from "./content"
export type { ClineMessageModelInfo, ClineTokenMetrics } from "./metrics"
// Trajectory management
export {
	createTrajectoryBuilder,
	readTrajectory,
	readTrajectoryFromJSON,
	TrajectoryBuilder,
	TrajectoryReader,
	TrajectoryUpdater,
	updateTrajectory,
} from "./trajectory-manager"
