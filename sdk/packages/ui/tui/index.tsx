// Presentation primitives host adapters compose into their own surfaces
// (provider pickers, account dialogs, onboarding flows, history browsers).
export {
	resolveSlashCommand,
	type SlashCommandRegistry,
	type SlashCommandRegistryEntry,
} from "./commands/slash-command-registry";
export type { TranscriptScrollHandle } from "./components/chat-message-list";
export type { CheckpointPickerItem } from "./components/dialogs/checkpoint-picker";
export {
	LoadingDialogContent,
	withLoadingDialog,
} from "./components/dialogs/loading-dialog";
export {
	type ModelOption,
	ModelSelectorContent,
} from "./components/model-selector/model-selector";
export { ProviderRow } from "./components/model-selector/provider-row";
export { SearchableList } from "./components/searchable-list";
export type { ToastState, ToastVariant } from "./components/toast";
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
export type {
	ProtocolTerminalUiProps,
	TerminalUiHandle,
} from "./protocol-terminal-ui";
export { runProtocolTerminalUi } from "./protocol-terminal-ui";
export { runInteractiveTerminalUi } from "./run-interactive-terminal-ui";
export { installTuiStdioCapture } from "./stdio-capture";
export type { DialogPalette, ResolvedTheme } from "./themes";
export { AUTO_THEME_ID, normalizeThemeId, resolveTheme } from "./themes";
export type * from "./types";
export {
	COMPLETION_DEBOUNCE_MS,
	DEFAULT_MAX_INPUT_TOKENS,
	HOME_VIEW_MAX_WIDTH,
	MAX_BUFFERED_LINES,
	MAX_COMPLETION_RESULTS,
} from "./types";
export { isSameRepoStatus } from "./utils/repo-status";
export { getMcpManagerEntryStatus } from "./views/config-view-helpers";
