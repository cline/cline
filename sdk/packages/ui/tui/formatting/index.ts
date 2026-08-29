/**
 * Renderer-independent terminal formatting helpers. This entry point stays
 * free of OpenTUI/React imports so headless hosts (e.g. the CLI's
 * non-interactive printers) can reuse transcript formatting without loading
 * the terminal renderer.
 */

export {
	formatCliErrorMessage,
	getCliClineFreeModelLimitMessage,
	getCliClineFreePromotionEndedMessage,
	getCliClinePassLimitMessage,
	getCliNotSubscribedMessage,
	getClineOrgIndividualInferenceSubscriptionMessage,
	getClinePassLimitDetailMessage,
	getCliSubscriptionUrl,
	getIndividualPlanFeatures,
	isClineFreeModelLimitErrorMessage,
	isClineFreePromotionEndedErrorMessage,
	isClineOrgIndividualInferenceSubscriptionErrorMessage,
	isClinePassLimitErrorMessage,
	isClinePassSubscriptionError,
} from "./cline-pass-errors";
export {
	applyCliCompactionMode,
	buildCliCompactionConfig,
	CLI_COMPACTION_MODE_EXPECTED_TEXT,
	CLI_COMPACTION_MODE_OPTION_DESCRIPTION,
	CLI_COMPACTION_MODES,
	type CliCompactionMode,
	type CompactionModeSettings,
	DEFAULT_CLI_COMPACTION_MODE,
	formatCliCompactionMode,
	getCliCompactionMode,
	getNextCliCompactionMode,
	parseCliCompactionMode,
} from "./compaction-mode";
export {
	cleanupMaterializedGeneratedMedia,
	type MaterializedGeneratedMedia,
	materializeGeneratedMedia,
} from "./generated-media";
export {
	bufferToImageDataUrl,
	getImageMimeType,
	isImagePath,
	loadImageAsDataUrl,
	resolveExistingImagePath,
} from "./image-attachments";
export { resolveNonCompactionStatusLabel } from "./status-labels";
export {
	formatStructuredCommand,
	formatToolInput,
	formatToolOutput,
	toDisplayString,
	truncate,
} from "./tool-format";
export {
	shouldShowCliUsageCost,
	shouldShowCliUsageCoveredBySubscription,
} from "./usage-cost-display";
