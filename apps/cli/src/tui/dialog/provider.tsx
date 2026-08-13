import type { KeyEvent } from "@opentui/core";
import { parseColor } from "@opentui/core";
import {
	useKeyboard,
	useRenderer,
	useTerminalDimensions,
} from "@opentui/react";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";
import { DialogManager } from "./manager";
import type {
	DialogActions,
	DialogId,
	DialogSize,
	DialogState,
	DialogVariant,
} from "./types";
import {
	DEFAULT_DIALOG_VARIANT,
	DialogPanel,
	getVariantChrome,
	normalizeDialogVariant,
} from "./variants";

const DialogContext = createContext<DialogManager | null>(null);

function useDialogManager(): DialogManager {
	const manager = useContext(DialogContext);
	if (!manager) {
		throw new Error(
			"useDialog/useDialogState must be used within a DialogProvider.",
		);
	}
	return manager;
}

/** Access dialog actions (show/close/choice/...) within a DialogProvider. */
export function useDialog(): DialogActions {
	const manager = useDialogManager();
	return useMemo(
		() => ({
			show: (options) => manager.show(options),
			close: (id) => manager.close(id),
			closeAll: () => manager.closeAll(),
			replace: (options) => manager.replace(options),
			prompt: (options) => manager.prompt(options),
			confirm: (options) => manager.confirm(options),
			alert: (options) => manager.alert(options),
			choice: (options) => manager.choice(options),
		}),
		[manager],
	);
}

/**
 * Subscribe to reactive dialog state with a selector. Only re-renders when
 * the selected value changes (reference equality).
 */
export function useDialogState<T>(selector: (state: DialogState) => T): T {
	const manager = useDialogManager();
	const subscribe = useMemo(
		() => (onStoreChange: () => void) => manager.subscribe(onStoreChange),
		[manager],
	);
	const getSnapshot = useCallback(() => {
		const dialogs = manager.getDialogs();
		return selector({
			isOpen: dialogs.length > 0,
			dialogs,
			topDialog: dialogs[dialogs.length - 1],
			count: dialogs.length,
		});
	}, [manager, selector]);
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Keyboard hook for dialog content that only fires while the dialog is the
 * top-most one, so stacked dialogs don't steal each other's keys.
 */
export function useDialogKeyboard(
	handler: (key: KeyEvent) => void | Promise<void>,
	dialogId: DialogId,
): void {
	const isTopmost = useDialogState((s) => s.topDialog?.id === dialogId);
	useKeyboard((key) => {
		if (isTopmost) {
			void handler(key);
		}
	});
}

export interface DialogProviderProps {
	children: ReactNode;
	/** Default panel width preset; individual dialogs may override. */
	size?: DialogSize;
	/**
	 * Visual chrome for all dialogs. The CLINE_DIALOG_VARIANT environment
	 * variable overrides this, which makes comparing looks easy.
	 */
	variant?: DialogVariant;
}

/**
 * Cline's own dialog layer: renders a dimmed backdrop plus centered panels
 * for every open dialog, and provides useDialog()/useDialogState() to the
 * subtree. Replaces the previous @opentui-ui/dialog dependency.
 */
export function DialogProvider(props: DialogProviderProps) {
	const renderer = useRenderer();
	const { width, height } = useTerminalDimensions();
	const [manager] = useState(() => new DialogManager(renderer));
	const [variant] = useState<DialogVariant>(
		() =>
			normalizeDialogVariant(process.env.CLINE_DIALOG_VARIANT) ??
			props.variant ??
			DEFAULT_DIALOG_VARIANT,
	);

	useEffect(() => {
		return () => {
			manager.destroy();
		};
	}, [manager]);

	const dialogs = useSyncExternalStore(
		(onStoreChange) => manager.subscribe(onStoreChange),
		() => manager.getDialogs(),
		() => manager.getDialogs(),
	);
	const topDialog = dialogs[dialogs.length - 1];

	useKeyboard((key) => {
		if (key.name !== "escape") {
			return;
		}
		const top = manager.getTopDialog();
		if (!top || top.closeOnEscape === false) {
			return;
		}
		key.preventDefault?.();
		manager.close(top.id);
	});

	const backdropColor = useMemo(() => {
		const chrome = getVariantChrome(variant);
		const rgba = parseColor(topDialog?.backdropColor ?? chrome.backdropColor);
		rgba.a = topDialog?.backdropOpacity ?? chrome.backdropOpacity;
		return rgba;
	}, [variant, topDialog]);

	const handleBackdropClick = useCallback(() => {
		const top = manager.getTopDialog();
		if (!top) {
			return;
		}
		top.onBackdropClick?.();
		if (top.closeOnClickOutside === true) {
			manager.close(top.id);
		}
	}, [manager]);

	return (
		<DialogContext.Provider value={manager}>
			{props.children}
			{dialogs.length > 0 && (
				<box
					position="absolute"
					left={0}
					top={0}
					width={width}
					height={height}
					zIndex={9998}
					alignItems="center"
					justifyContent="center"
				>
					{/* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI boxes handle terminal mouse input. */}
					<box
						position="absolute"
						left={0}
						top={0}
						width={width}
						height={height}
						backgroundColor={backdropColor}
						onMouseUp={handleBackdropClick}
					/>
					{dialogs.map((record) => (
						<DialogPanel
							key={String(record.id)}
							record={record}
							variant={variant}
							defaultSize={props.size}
							terminalWidth={width}
						/>
					))}
				</box>
			)}
		</DialogContext.Provider>
	);
}
