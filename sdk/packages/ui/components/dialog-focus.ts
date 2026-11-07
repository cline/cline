"use client";

import { useRef } from "react";

interface DialogFocusOptions {
	/** Leave false when the Radix primitive owns initial focus, as with AlertDialog.Cancel. */
	focusContent: boolean;
	onOpenAutoFocus?: (event: Event) => void;
	onCloseAutoFocus?: (event: Event) => void;
}

/** Focus lifecycle for controlled dialogs that do not render a Radix Trigger. */
export function useDialogFocus({
	focusContent,
	onOpenAutoFocus,
	onCloseAutoFocus,
}: DialogFocusOptions) {
	const contentRef = useRef<HTMLDivElement>(null);
	const openerRef = useRef<HTMLElement | null>(null);

	return {
		contentRef,
		onOpenAutoFocus(event: Event) {
			const activeElement = contentRef.current?.ownerDocument.activeElement;
			openerRef.current =
				activeElement instanceof HTMLElement ? activeElement : null;
			onOpenAutoFocus?.(event);
			if (focusContent && !event.defaultPrevented) {
				event.preventDefault();
				contentRef.current?.focus({ preventScroll: true });
			}
		},
		onCloseAutoFocus(event: Event) {
			onCloseAutoFocus?.(event);
			// Keep the captured opener available even when the whole dialog unmounts.
			if (!event.defaultPrevented && openerRef.current?.isConnected) {
				event.preventDefault();
				openerRef.current.focus({ preventScroll: true });
			}
		},
	};
}
