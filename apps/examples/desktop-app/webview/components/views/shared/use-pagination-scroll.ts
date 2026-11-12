import { useCallback, useLayoutEffect, useRef } from "react";
import { findScrollViewport } from "./page-scroll";

/** Keep the results and footer in place while a different page replaces their rows. */
export function usePaginationScroll({
	page,
	resetKey,
	onPageChange,
}: {
	page: number;
	resetKey: string | number;
	/** Return false when the page change is rejected. */
	onPageChange: (page: number) => false | void;
}) {
	const content = useRef<HTMLDivElement | null>(null);
	const observer = useRef<ResizeObserver | null>(null);
	const previousResetKey = useRef(resetKey);
	const reservation = useRef<{
		content: HTMLDivElement;
		minHeight: string;
		priority: string;
	} | null>(null);
	const pending = useRef<{
		page: number;
		content: HTMLDivElement;
		viewport: HTMLElement;
		top: number;
		left: number;
	} | null>(null);

	const clearReservation = useCallback((node?: HTMLDivElement | null) => {
		const current = reservation.current;
		if (!current || (node && current.content !== node)) return;
		if (current.minHeight) {
			current.content.style.setProperty(
				"min-height",
				current.minHeight,
				current.priority,
			);
		} else {
			current.content.style.removeProperty("min-height");
		}
		reservation.current = null;
	}, []);

	const contentRef = useCallback(
		(node: HTMLDivElement | null) => {
			observer.current?.disconnect();
			observer.current = null;
			clearReservation(content.current);
			content.current = node;
			pending.current = null;
			if (!node) return;

			let width = node.getBoundingClientRect().width;
			observer.current = new ResizeObserver(() => {
				const nextWidth = node.getBoundingClientRect().width;
				// Detail pages temporarily hide their list; preserve its return position.
				if (nextWidth === 0 || nextWidth === width) return;
				width = nextWidth;
				clearReservation(node);
				pending.current = null;
			});
			observer.current.observe(node);
		},
		[clearReservation],
	);

	useLayoutEffect(() => {
		// A new result set must size itself independently of the previous page.
		if (previousResetKey.current !== resetKey) {
			previousResetKey.current = resetKey;
			clearReservation();
			pending.current = null;
		}
		const position = pending.current;
		if (!position || position.page !== page) return;
		pending.current = null;
		if (
			content.current !== position.content ||
			!position.viewport.isConnected
		) {
			clearReservation(position.content);
			return;
		}
		const { viewport, top, left } = position;
		const scrollBehavior = viewport.style.scrollBehavior;
		viewport.style.scrollBehavior = "auto";
		viewport.scrollTop = top;
		viewport.scrollLeft = left;
		viewport.style.scrollBehavior = scrollBehavior;
	});

	const handlePageChange = (nextPage: number) => {
		if (nextPage === page) return;
		pending.current = null;
		const node = content.current;
		const viewport = findScrollViewport(node);
		if (node && viewport) {
			pending.current = {
				page: nextPage,
				content: node,
				viewport,
				top: viewport.scrollTop,
				left: viewport.scrollLeft,
			};
			// Reserve the current height before a shorter page can clamp scrollTop.
			if (reservation.current?.content !== node) {
				clearReservation();
				reservation.current = {
					content: node,
					minHeight: node.style.getPropertyValue("min-height"),
					priority: node.style.getPropertyPriority("min-height"),
				};
			}
			node.style.minHeight = `${node.getBoundingClientRect().height}px`;
		}
		try {
			if (onPageChange(nextPage) === false) {
				pending.current = null;
				clearReservation(node);
			}
		} catch (cause) {
			pending.current = null;
			clearReservation(node);
			throw cause;
		}
	};

	return { contentRef, onPageChange: handlePageChange };
}
