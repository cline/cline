"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	clampWorkspacePanelWidth,
	hasStoredWorkspacePanelWidth,
	readWorkspacePanelWidth,
	writeWorkspacePanelWidth,
} from "@/lib/workspace-panel";

/**
 * The right-hand column beside the conversation, with a drag handle on its
 * left edge. Placed explicitly in column 2 spanning both grid rows, so the
 * transcript and composer keep auto-flowing into column 1.
 */
export function WorkspacePanelFrame({
	id,
	children,
}: {
	id: string;
	children: ReactNode;
}) {
	const [width, setWidth] = useState(readWorkspacePanelWidth);
	const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(
		null,
	);

	// Until the user drags it, the panel tracks its share of the main content area as
	// the window resizes or the app sidebar collapses.
	useEffect(() => {
		const follow = () =>
			setWidth((current) =>
				hasStoredWorkspacePanelWidth()
					? clampWorkspacePanelWidth(current)
					: readWorkspacePanelWidth(),
			);
		window.addEventListener("resize", follow);
		const main = document.querySelector('[data-slot="sidebar-inset"]');
		const observer =
			main && typeof ResizeObserver !== "undefined"
				? new ResizeObserver(follow)
				: null;
		if (main) observer?.observe(main);
		return () => {
			window.removeEventListener("resize", follow);
			observer?.disconnect();
		};
	}, []);

	return (
		<aside
			className="relative col-start-2 row-span-2 row-start-1 flex min-h-0 border-l border-border bg-background"
			id={id}
			style={{ width }}
		>
			<div
				aria-hidden
				className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-primary/30"
				onPointerDown={(event) => {
					dragStateRef.current = { startX: event.clientX, startWidth: width };
					event.currentTarget.setPointerCapture(event.pointerId);
				}}
				onPointerMove={(event) => {
					const drag = dragStateRef.current;
					if (!drag) return;
					setWidth(
						clampWorkspacePanelWidth(
							drag.startWidth + (drag.startX - event.clientX),
						),
					);
				}}
				onPointerUp={() => {
					if (dragStateRef.current) writeWorkspacePanelWidth(width);
					dragStateRef.current = null;
				}}
			/>
			{children}
		</aside>
	);
}
