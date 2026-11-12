"use client";

import { useEffect, useState } from "react";

/**
 * An element's width, kept current with a ResizeObserver: pass the returned
 * callback as the element's `ref`. The width is 0 until it is measured, and
 * wherever layout is not available (jsdom).
 */
export function useElementWidth(): [
	(element: HTMLElement | null) => void,
	number,
] {
	const [element, setElement] = useState<HTMLElement | null>(null);
	const [width, setWidth] = useState(0);
	useEffect(() => {
		if (!element || typeof ResizeObserver === "undefined") return;
		const measure = () =>
			setWidth(Math.round(element.getBoundingClientRect().width));
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [element]);
	return [setElement, width];
}
