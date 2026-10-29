"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	clampWorkspacePanelWidth,
	readWorkspacePanelWidth,
	writeWorkspacePanelWidth,
	type WorkspacePanelKind,
} from "@/lib/workspace-panel";

export function WorkspacePanelFrame({
	children,
	visible,
	narrow,
	panel = "workspace",
}: {
	children: ReactNode;
	visible: boolean;
	narrow: boolean;
	panel?: WorkspacePanelKind;
}) {
	const [width, setWidth] = useState(() => readWorkspacePanelWidth(panel));
	const drag = useRef<{ x: number; width: number } | null>(null);
	useEffect(() => {
		const follow = () => setWidth(readWorkspacePanelWidth(panel));
		drag.current = null;
		follow();
		window.addEventListener("resize", follow);
		const main = document.querySelector('[data-slot="sidebar-inset"]');
		const observer =
			typeof ResizeObserver !== "undefined" ? new ResizeObserver(follow) : null;
		if (main) observer?.observe(main);
		return () => {
			window.removeEventListener("resize", follow);
			observer?.disconnect();
		};
	}, [panel]);
	const resize = (next: number) => {
		const clamped = clampWorkspacePanelWidth(next);
		setWidth(clamped);
		writeWorkspacePanelWidth(clamped, panel);
	};
	return (
		<aside
			className="relative flex min-h-0 min-w-0 shrink-0 border-l border-border bg-background"
			style={{
				display: visible ? "flex" : "none",
				width: narrow ? "100%" : width,
			}}
		>
			{!narrow && (
				// biome-ignore lint/a11y/useSemanticElements: This focusable separator resizes panes; it is not a thematic break.
				<div
					role="separator"
					aria-label="Resize workspace panel"
					aria-orientation="vertical"
					aria-valuenow={Math.round(width)}
					tabIndex={0}
					className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-primary/30 focus-visible:bg-primary/30"
					onKeyDown={(event) => {
						if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
							event.preventDefault();
							resize(width + (event.key === "ArrowLeft" ? 20 : -20));
						}
					}}
					onPointerDown={(event) => {
						drag.current = { x: event.clientX, width };
						event.currentTarget.setPointerCapture(event.pointerId);
					}}
					onPointerMove={(event) => {
						if (drag.current)
							setWidth(
								clampWorkspacePanelWidth(
									drag.current.width + drag.current.x - event.clientX,
								),
							);
					}}
					onPointerUp={() => {
						if (drag.current) writeWorkspacePanelWidth(width, panel);
						drag.current = null;
					}}
					onPointerCancel={() => {
						drag.current = null;
						setWidth(readWorkspacePanelWidth(panel));
					}}
				/>
			)}
			{children}
		</aside>
	);
}
