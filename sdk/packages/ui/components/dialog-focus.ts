"use client";

import { type FocusEvent, useRef } from "react";

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
	const capturedContentRef = useRef<HTMLDivElement | null>(null);

	function captureOpener(
		content: HTMLDivElement,
		candidate: EventTarget | null,
	) {
		if (capturedContentRef.current === content) return;
		capturedContentRef.current = content;
		openerRef.current =
			candidate instanceof HTMLElement && !content.contains(candidate)
				? candidate
				: null;
	}

	return {
		contentRef,
		onFocusCapture(event: FocusEvent<HTMLDivElement>) {
			// Native autoFocus runs before Radix's autofocus event and can suppress it.
			// Its first focus event still identifies the element that lost focus.
			captureOpener(event.currentTarget, event.relatedTarget);
		},
		onOpenAutoFocus(event: Event) {
			const content = contentRef.current;
			if (content) captureOpener(content, content.ownerDocument.activeElement);
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
