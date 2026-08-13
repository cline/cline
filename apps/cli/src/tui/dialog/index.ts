// Cline's custom dialog system for the TUI: a drop-in replacement for the
// former @opentui-ui/dialog dependency, with Cline-designed visual variants.
export { DialogManager, type FocusHost } from "./manager";
export {
	DialogProvider,
	type DialogProviderProps,
	useDialog,
	useDialogKeyboard,
	useDialogState,
} from "./provider";
export type {
	AlertContext,
	AlertOptions,
	ChoiceContext,
	ChoiceOptions,
	ConfirmContext,
	ConfirmOptions,
	DialogActions,
	DialogId,
	DialogRecord,
	DialogShowOptions,
	DialogSize,
	DialogState,
	DialogStyle,
	DialogVariant,
	PromptContext,
	PromptOptions,
} from "./types";
export {
	DEFAULT_DIALOG_VARIANT,
	DIALOG_VARIANTS,
	normalizeDialogVariant,
} from "./variants";
