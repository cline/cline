// Cline's custom dialog system for the TUI: a drop-in replacement for the
// former @opentui-ui/dialog dependency. Dialogs render as full-width bottom
// sheets over a lightly dimmed conversation.
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
	PromptContext,
	PromptOptions,
} from "./types";
