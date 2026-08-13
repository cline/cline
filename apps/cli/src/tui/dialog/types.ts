import type { ReactNode } from "react";

// Cline's own dialog system. Type surface intentionally mirrors what the CLI
// previously consumed from @opentui-ui/dialog so call sites stay unchanged.

export type DialogId = string | number;

export type DialogSize = "small" | "medium" | "large" | "full";

/**
 * Visual chrome applied to every dialog panel. "classic" reproduces the old
 * borderless third-party look and is kept for comparison; the others are
 * Cline-designed styles.
 */
export type DialogVariant = "frame" | "edge" | "topbar" | "shadow" | "classic";

export interface DialogStyle {
	backgroundColor?: string;
	width?: number;
	maxWidth?: number;
	minWidth?: number;
	maxHeight?: number;
	padding?: number;
	paddingX?: number;
	paddingY?: number;
	paddingTop?: number;
	paddingRight?: number;
	paddingBottom?: number;
	paddingLeft?: number;
}

export interface DialogShowOptions {
	/** Reusing an id updates the existing dialog in place. */
	id?: DialogId;
	/** Factory returning the dialog's JSX content. */
	content: () => ReactNode;
	size?: DialogSize;
	style?: DialogStyle;
	/** @default true */
	closeOnEscape?: boolean;
	/** @default false */
	closeOnClickOutside?: boolean;
	/** Per-dialog backdrop color override. */
	backdropColor?: string;
	/** Per-dialog backdrop opacity override, 0-1. */
	backdropOpacity?: number;
	onOpen?: () => void;
	onClose?: () => void;
	onBackdropClick?: () => void;
}

/** An open dialog tracked by the manager. */
export interface DialogRecord
	extends Omit<DialogShowOptions, "id" | "content"> {
	id: DialogId;
	/** Content evaluated once at show() time. */
	element: ReactNode;
}

export interface DialogState {
	isOpen: boolean;
	dialogs: readonly DialogRecord[];
	topDialog: DialogRecord | undefined;
	count: number;
}

export interface PromptContext<T> {
	resolve: (value: T) => void;
	dismiss: () => void;
	dialogId: DialogId;
}

export interface ConfirmContext {
	resolve: (confirmed: boolean) => void;
	dismiss: () => void;
	dialogId: DialogId;
}

export interface AlertContext {
	dismiss: () => void;
	dialogId: DialogId;
}

export interface ChoiceContext<K> {
	resolve: (key: K) => void;
	dismiss: () => void;
	dialogId: DialogId;
}

interface AsyncDialogOptions
	extends Omit<DialogShowOptions, "content" | "id"> {}

export interface PromptOptions<T> extends AsyncDialogOptions {
	content: (ctx: PromptContext<T>) => ReactNode;
	/** Value resolved when dismissed via ESC or backdrop click. */
	fallback?: T;
}

export interface ConfirmOptions extends AsyncDialogOptions {
	content: (ctx: ConfirmContext) => ReactNode;
	/** @default false */
	fallback?: boolean;
}

export interface AlertOptions extends AsyncDialogOptions {
	content: (ctx: AlertContext) => ReactNode;
}

export interface ChoiceOptions<K> extends AsyncDialogOptions {
	content: (ctx: ChoiceContext<K>) => ReactNode;
	/** @default undefined */
	fallback?: K;
}

export interface DialogActions {
	/** Show a new dialog and return its ID. */
	show: (options: DialogShowOptions) => DialogId;
	/** Close a specific dialog by ID, or the top-most dialog if no ID given. */
	close: (id?: DialogId) => DialogId | undefined;
	/** Close all open dialogs. */
	closeAll: () => void;
	/** Close all dialogs and show a new one. */
	replace: (options: DialogShowOptions) => DialogId;
	/** Show a prompt dialog and wait for a value. */
	prompt: <T>(options: PromptOptions<T>) => Promise<T | undefined>;
	/** Show a confirmation dialog and wait for confirm/cancel. */
	confirm: (options: ConfirmOptions) => Promise<boolean>;
	/** Show an alert dialog and wait for dismissal. */
	alert: (options: AlertOptions) => Promise<void>;
	/** Show a choice dialog and wait for a selection. */
	choice: <K>(options: ChoiceOptions<K>) => Promise<K | undefined>;
}
