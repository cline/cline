"use client";

import { useEffect, useState } from "react";

export type ElementSize = { width: number; height: number };

/**
 * An element's size, kept current with a ResizeObserver: pass the returned
 * callback as the element's `ref`. Both are 0 until it is measured, and
 * wherever layout is not available (jsdom measures 0).
 */
export function useElementSize(): [
	(element: HTMLElement | null) => void,
	ElementSize,
] {
	const [element, setElement] = useState<HTMLElement | null>(null);
	const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
	useEffect(() => {
		if (!element) return;
		const measure = () => {
			const rect = element.getBoundingClientRect();
			const width = Math.round(rect.width);
			const height = Math.round(rect.height);
			setSize((current) =>
				current.width === width && current.height === height
					? current
					: { width, height },
			);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [element]);
	return [setElement, size];
}
