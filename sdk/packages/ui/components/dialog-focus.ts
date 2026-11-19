"use client";

import { useCallback, useRef } from "react";

interface DialogFocusOptions {
	open: boolean;
	/** Leave false when the Radix primitive owns initial focus, as with AlertDialog.Cancel. */
	focusContent: boolean;
	onOpenAutoFocus?: (event: Event) => void;
	onCloseAutoFocus?: (event: Event) => void;
}

/** Focus lifecycle for controlled dialogs that do not render a Radix Trigger. */
export function useDialogFocus({
	open,
	focusContent,
	onOpenAutoFocus,
	onCloseAutoFocus,
}: DialogFocusOptions) {
	const contentRef = useRef<HTMLDivElement | null>(null);
	const openerRef = useRef<HTMLElement | null>(null);
	const focusedElementRef = useRef<Element | null>(null);
	const cleanupRef = useRef<(() => void) | null>(null);
	const setContentRef = useCallback(
		(content: HTMLDivElement | null) => {
			cleanupRef.current?.();
			cleanupRef.current = null;
			contentRef.current = content;
			if (!content || !open) return;

			const ownerDocument = content.ownerDocument;
			const activeElement = ownerDocument.activeElement;
			if (activeElement !== ownerDocument.body) {
				focusedElementRef.current = content.contains(activeElement)
					? activeElement
					: null;
			}
			const trackFocus = (event: FocusEvent) => {
				const target = event.target as Element | null;
				// Native blur may move focus to body without another control taking it.
				if (target === ownerDocument.body) return;
				focusedElementRef.current =
					target && content.contains(target) ? target : null;
			};
			const recoverFocus = () => {
				const focusedElement = focusedElementRef.current;
				if (
					!content.isConnected ||
					!focusedElement?.matches(":disabled") ||
					!content.contains(focusedElement)
				)
					return;
				const activeElement = ownerDocument.activeElement;
				if (
					activeElement === focusedElement ||
					activeElement === ownerDocument.body
				)
					content.focus({ preventScroll: true });
			};
			const observer = new MutationObserver(recoverFocus);
			// Footer components can update their own state without rerendering Dialog.
			observer.observe(content, {
				attributes: true,
				attributeFilter: ["disabled"],
				subtree: true,
			});
			ownerDocument.addEventListener("focusin", trackFocus, true);
			cleanupRef.current = () => {
				observer.disconnect();
				ownerDocument.removeEventListener("focusin", trackFocus, true);
			};
			// Radix can reattach refs after updating disabled, before observation resumes.
			recoverFocus();
		},
		[open],
	);

	return {
		contentRef: setContentRef,
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
