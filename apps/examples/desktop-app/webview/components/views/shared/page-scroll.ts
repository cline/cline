/** The viewport marker owned by our ScrollArea wrapper. */
const SCROLL_VIEWPORT_SELECTOR = '[data-slot="scroll-area-viewport"]';

/** The scrolling ancestor of a page element, so callers need not know how pages scroll. */
export function findScrollViewport(
	element: Element | null | undefined,
): HTMLElement | null {
	return element?.closest<HTMLElement>(SCROLL_VIEWPORT_SELECTOR) ?? null;
}

/** Every scroll viewport rendered inside a container, e.g. a page and its panes. */
export function queryScrollViewports(
	container: ParentNode | null | undefined,
): HTMLElement[] {
	return Array.from(
		container?.querySelectorAll<HTMLElement>(SCROLL_VIEWPORT_SELECTOR) ?? [],
	);
}

/** Measures the page, then returns the change that follows from it, if any. */
type ScrollMeasurement = () => (() => void) | undefined;

type ScrollFollowers = {
	measurements: Set<ScrollMeasurement>;
	stopListening: () => void;
};

const followersByViewport = new WeakMap<HTMLElement, ScrollFollowers>();

function listenToScroll(viewport: HTMLElement): ScrollFollowers {
	const measurements = new Set<ScrollMeasurement>();
	const onScroll = () => {
		const changes = Array.from(measurements, (measure) => measure());
		for (const change of changes) change?.();
	};
	viewport.addEventListener("scroll", onScroll, { passive: true });
	return {
		measurements,
		stopListening: () => viewport.removeEventListener("scroll", onScroll),
	};
}

/**
 * Keep something in step with a viewport's scroll position.
 *
 * Everything following the same viewport shares one listener, and all of it is
 * measured before any of it changes the page. A page with many sticky headings
 * therefore lays out once per scroll instead of once per heading.
 */
export function followScroll(
	viewport: HTMLElement,
	measure: ScrollMeasurement,
): () => void {
	const followers =
		followersByViewport.get(viewport) ?? listenToScroll(viewport);
	followersByViewport.set(viewport, followers);
	followers.measurements.add(measure);
	return () => {
		followers.measurements.delete(measure);
		if (followers.measurements.size > 0) return;
		followers.stopListening();
		if (followersByViewport.get(viewport) === followers)
			followersByViewport.delete(viewport);
	};
}
