import { useCallback, useRef } from "react";

type ReturnPosition = {
	trigger: HTMLElement | null;
	viewport: HTMLElement | null;
	scrollTop: number;
};

/**
 * Remember where a list was left when a detail page replaces it, then put the
 * reader back: same scroll offset, focus on the control that opened the detail.
 */
export function useReturnPosition() {
	const position = useRef<ReturnPosition | null>(null);

	const remember = useCallback(
		(trigger: HTMLElement | null, viewport: HTMLElement | null) => {
			position.current = {
				trigger,
				viewport,
				scrollTop: viewport?.scrollTop ?? 0,
			};
		},
		[],
	);

	/** The opener no longer exists (its item was removed); keep only the scroll offset. */
	const forgetTrigger = useCallback(() => {
		if (position.current) position.current.trigger = null;
	}, []);

	const forget = useCallback(() => {
		position.current = null;
	}, []);

	/**
	 * Returns false when there was nothing to restore. The position remains
	 * available for repeated Back/Forward visits until replaced or forgotten.
	 */
	const restore = useCallback((focusFallback?: () => void): boolean => {
		const remembered = position.current;
		if (!remembered) return false;
		const { trigger, viewport, scrollTop } = remembered;
		if (viewport?.isConnected) viewport.scrollTop = scrollTop;
		if (trigger?.isConnected) {
			trigger.focus({ preventScroll: true });
		}
		if (document.activeElement !== trigger) focusFallback?.();
		return true;
	}, []);

	return { remember, forgetTrigger, forget, restore };
}
