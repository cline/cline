"use client";

import { createContext, type ReactNode, useContext, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type WindowTitleBarContextValue = {
	contentEnabled: boolean;
	portalTarget: HTMLDivElement | null;
};

const WindowTitleBarContext = createContext<WindowTitleBarContextValue | null>(
	null,
);

/**
 * Owns the main-pane portion of the native overlay title bar.
 *
 * The region stays mounted while routes and loading states change. Pages may
 * project controls into it, but they never control whether the draggable
 * surface itself exists.
 */
export function WindowTitleBarProvider({
	children,
	contentEnabled = true,
	fullWidth = false,
}: {
	children: ReactNode;
	contentEnabled?: boolean;
	fullWidth?: boolean;
}) {
	const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);

	return (
		<WindowTitleBarContext.Provider value={{ contentEnabled, portalTarget }}>
			<div
				className={cn(
					"fixed top-0 right-0 isolate h-12 transition-[left] duration-120 max-md:h-7",
					fullWidth
						? "left-0 z-[60]"
						: "left-0 z-40 md:left-(--sidebar-width) md:group-data-[state=collapsed]/sidebar-wrapper:left-(--sidebar-width-icon)",
				)}
				data-slot="window-title-bar"
				data-tauri-drag-region="deep"
			>
				<div className="h-full min-w-0" ref={setPortalTarget} />
			</div>
			{children}
		</WindowTitleBarContext.Provider>
	);
}

/**
 * Projects page-owned controls into the persistent title bar while leaving a
 * same-height spacer at the source so existing page geometry does not move.
 */
export function WindowTitleBarContent({ children }: { children: ReactNode }) {
	const context = useContext(WindowTitleBarContext);
	if (!context) {
		throw new Error(
			"WindowTitleBarContent must be used within WindowTitleBarProvider.",
		);
	}

	return (
		<>
			{context.contentEnabled && context.portalTarget
				? createPortal(children, context.portalTarget)
				: null}
			<div
				aria-hidden="true"
				className="h-12 shrink-0 max-md:h-7"
				data-slot="window-title-bar-spacer"
			/>
		</>
	);
}
