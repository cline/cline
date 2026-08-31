/**
 * Host-driven interactive terminal UI for Cline, built on OpenTUI. Hosts
 * (e.g. the CLI) supply runtime behavior through `InteractiveTerminalUiProps`
 * and compose their own runtime-owned dialogs from the primitives exported
 * here. Browser consumers must never import this entry point.
 */

// Presentation primitives host adapters compose into their own surfaces
// (provider pickers, account dialogs, onboarding flows, history browsers).
export * from "./commands/slash-command-registry";
export type { TranscriptScrollHandle } from "./components/chat-message-list";
export {
	type AccountDialogAction,
	AccountDialogContent,
	type AccountDialogOrganization,
	type AccountDialogSnapshot,
	isClineAccountAuthErrorMessage,
} from "./components/dialogs/account-dialog";
export type { CheckpointPickerItem } from "./components/dialogs/checkpoint-picker";
export type { HistoryExportFormat } from "./components/dialogs/history-export-picker";
export {
	HistoryDialogContent,
	type HistorySessionRow,
} from "./components/dialogs/history-view";
export {
	LoadingDialogContent,
	withLoadingDialog,
} from "./components/dialogs/loading-dialog";
export {
	getMcpManagerFooterText,
	type McpEntry,
	McpManagerContent,
	type McpServerToggleResult,
} from "./components/dialogs/mcp-manager";
export {
	buildFeaturedModelEntries,
	CLINE_MODEL_PICKER_TIER_LABELS,
	CLINE_PASS_FREE_SECTION_DESCRIPTION,
	type ClineFeaturedModel,
	type ClineFeaturedModelsData,
	ClineModelPicker,
	type ClineModelPickerBrowse,
	type ClineModelPickerEntry,
	type ClineModelPickerItem,
	type ClineModelPickerTier,
	type ClineModelSearchRow,
	freeTierDescriptionFor,
	searchFeaturedModels,
} from "./components/model-selector/cline-model-picker";
export {
	BROWSE_ALL_ACTION,
	ClineModelSelectorContent,
	ClineModelSelectorDialogContent,
} from "./components/model-selector/cline-model-selector";
export type { ModelSearchCandidate } from "./components/model-selector/model-search";
export * from "./components/model-selector/model-selector";
export { ProviderRow } from "./components/model-selector/provider-row";
export {
	getProviderSection,
	isPopularProvider,
	OTHER_PROVIDER_SECTION,
	POPULAR_PROVIDER_SECTION,
	type ProviderSection,
	type ProviderSectionItem,
} from "./components/model-selector/provider-sections";
export * from "./components/searchable-list";
export type { ToastState, ToastVariant } from "./components/toast";
export * from "./components/tracked-robot";
export type * from "./config-model";
export { isToggleableInteractiveConfigItem } from "./config-model";
export { useSession } from "./contexts/session-context";
export { getInitialThemeId, ThemeProvider } from "./hooks/theme-provider";
export {
	type TerminalColors,
	TerminalColorsContext,
	type ThemeController,
	useDialogPalette,
	useTerminalTheme,
	useTheme,
	useThemeController,
} from "./hooks/use-theme";
export { disableOpenTuiGraphicsProbe } from "./opentui-env";
export * from "./palette";
export type {
	ProtocolTerminalUiProps,
	TerminalUiHandle,
} from "./protocol-terminal-ui";
export { runProtocolTerminalUi } from "./protocol-terminal-ui";
export { runInteractiveTerminalUi } from "./run-interactive-terminal-ui";
export { installTuiStdioCapture } from "./stdio-capture";
export * from "./themes";
export type * from "./types";
export {
	COMPLETION_DEBOUNCE_MS,
	DEFAULT_MAX_INPUT_TOKENS,
	HOME_VIEW_MAX_WIDTH,
	MAX_BUFFERED_LINES,
	MAX_COMPLETION_RESULTS,
} from "./types";
export * from "./utils/dialog-keys";
export { isSameRepoStatus } from "./utils/repo-status";
export { getMcpManagerEntryStatus } from "./views/config-view-helpers";
