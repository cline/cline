import type {
	AlertOptions,
	ChoiceOptions,
	ConfirmOptions,
	DialogId,
	DialogRecord,
	DialogShowOptions,
	PromptOptions,
} from "./types";

interface Focusable {
	blur(): void;
	focus(): void;
	readonly isDestroyed: boolean;
}

/** The slice of the OpenTUI renderer the manager needs for focus handling. */
export interface FocusHost {
	currentFocusedRenderable?: Focusable | null;
}

/**
 * Holds the stack of open dialogs and resolves the async dialog flavors
 * (prompt/confirm/alert/choice). Rendering is done by DialogProvider, which
 * subscribes to this manager.
 */
export class DialogManager {
	private dialogs: readonly DialogRecord[] = [];
	private subscribers = new Set<() => void>();
	private idCounter = 1;
	private savedFocus: Focusable | null = null;
	private focusRestoreTimeout: ReturnType<typeof setTimeout> | undefined;
	private destroyed = false;

	constructor(private readonly host: FocusHost) {}

	/** Subscribe to dialog stack changes. Returns an unsubscribe function. */
	subscribe(subscriber: () => void): () => void {
		this.subscribers.add(subscriber);
		return () => {
			this.subscribers.delete(subscriber);
		};
	}

	private publish(): void {
		for (const subscriber of this.subscribers) {
			try {
				subscriber();
			} catch (error) {
				console.error("[cline dialog] subscriber threw:", error);
			}
		}
	}

	private saveFocus(): void {
		this.cancelPendingFocusRestore();
		this.savedFocus = this.host.currentFocusedRenderable ?? null;
		this.savedFocus?.blur();
	}

	private cancelPendingFocusRestore(): void {
		if (this.focusRestoreTimeout) {
			clearTimeout(this.focusRestoreTimeout);
			this.focusRestoreTimeout = undefined;
		}
	}

	private restoreFocus(): void {
		this.cancelPendingFocusRestore();
		const saved = this.savedFocus;
		if (saved && !saved.isDestroyed) {
			// Deferred so the closing dialog's focused input releases focus first.
			this.focusRestoreTimeout = setTimeout(() => {
				if (!this.destroyed && !saved.isDestroyed) {
					saved.focus();
				}
				this.savedFocus = null;
				this.focusRestoreTimeout = undefined;
			}, 1);
		} else {
			this.savedFocus = null;
		}
	}

	show(options: DialogShowOptions): DialogId {
		if (this.destroyed) {
			throw new Error("[cline dialog] Cannot show dialog: manager destroyed.");
		}
		const { content, id: requestedId, ...rest } = options;
		const id = requestedId ?? this.idCounter++;
		const element = content();
		const existingIndex = this.dialogs.findIndex((d) => d.id === id);
		if (existingIndex !== -1) {
			const existing = this.dialogs[existingIndex] as DialogRecord;
			const updated: DialogRecord = { ...existing, ...rest, id, element };
			this.dialogs = [
				...this.dialogs.slice(0, existingIndex),
				updated,
				...this.dialogs.slice(existingIndex + 1),
			];
			this.publish();
			return id;
		}
		if (this.dialogs.length === 0) {
			this.saveFocus();
		}
		const record: DialogRecord = { ...rest, id, element };
		this.dialogs = [...this.dialogs, record];
		this.publish();
		record.onOpen?.();
		return id;
	}

	/** Close a dialog by ID, or the top-most dialog if no ID provided. */
	close(id?: DialogId): DialogId | undefined {
		const targetId = id ?? this.dialogs[this.dialogs.length - 1]?.id;
		if (targetId === undefined) {
			return undefined;
		}
		const index = this.dialogs.findIndex((d) => d.id === targetId);
		if (index === -1) {
			return undefined;
		}
		const dialog = this.dialogs[index];
		this.dialogs = [
			...this.dialogs.slice(0, index),
			...this.dialogs.slice(index + 1),
		];
		this.publish();
		dialog?.onClose?.();
		if (this.dialogs.length === 0) {
			this.restoreFocus();
		}
		return targetId;
	}

	closeAll(): void {
		for (const dialog of [...this.dialogs].reverse()) {
			this.close(dialog.id);
		}
	}

	replace(options: DialogShowOptions): DialogId {
		this.closeAll();
		return this.show(options);
	}

	getDialogs(): readonly DialogRecord[] {
		return this.dialogs;
	}

	getTopDialog(): DialogRecord | undefined {
		return this.dialogs[this.dialogs.length - 1];
	}

	isOpen(): boolean {
		return this.dialogs.length > 0;
	}

	/**
	 * Shared machinery for the async dialog flavors: creates the Promise,
	 * guards against double-resolution, and resolves the fallback value when
	 * the dialog closes without an explicit resolve (ESC, backdrop, closeAll).
	 */
	private showAsyncDialog<T>(
		create: (
			safeResolve: (value: T) => void,
			dialogId: DialogId,
		) => { showOptions: DialogShowOptions; fallback: T },
	): Promise<T> {
		return new Promise<T>((resolve) => {
			let resolved = false;
			const dialogId = this.idCounter++;
			const safeResolve = (value: T) => {
				if (resolved) {
					return;
				}
				resolved = true;
				resolve(value);
				this.close(dialogId);
			};
			const { showOptions, fallback } = create(safeResolve, dialogId);
			this.show({
				...showOptions,
				id: dialogId,
				onClose: () => {
					showOptions.onClose?.();
					safeResolve(fallback);
				},
			});
		});
	}

	prompt<T>(options: PromptOptions<T>): Promise<T | undefined> {
		const { content, fallback, ...rest } = options;
		return this.showAsyncDialog<T | undefined>((safeResolve, dialogId) => ({
			showOptions: {
				...rest,
				content: () =>
					content({
						resolve: safeResolve,
						dismiss: () => safeResolve(undefined),
						dialogId,
					}),
			},
			fallback,
		}));
	}

	confirm(options: ConfirmOptions): Promise<boolean> {
		const { content, fallback, ...rest } = options;
		return this.showAsyncDialog<boolean>((safeResolve, dialogId) => ({
			showOptions: {
				...rest,
				content: () =>
					content({
						resolve: safeResolve,
						dismiss: () => safeResolve(false),
						dialogId,
					}),
			},
			fallback: fallback ?? false,
		}));
	}

	alert(options: AlertOptions): Promise<void> {
		const { content, ...rest } = options;
		return this.showAsyncDialog<void>((safeResolve, dialogId) => ({
			showOptions: {
				...rest,
				content: () => content({ dismiss: () => safeResolve(), dialogId }),
			},
			fallback: undefined,
		}));
	}

	choice<K>(options: ChoiceOptions<K>): Promise<K | undefined> {
		const { content, fallback, ...rest } = options;
		return this.showAsyncDialog<K | undefined>((safeResolve, dialogId) => ({
			showOptions: {
				...rest,
				content: () =>
					content({
						resolve: safeResolve,
						dismiss: () => safeResolve(undefined),
						dialogId,
					}),
			},
			fallback,
		}));
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		this.cancelPendingFocusRestore();
		this.savedFocus = null;
		this.subscribers.clear();
		this.dialogs = [];
	}
}
