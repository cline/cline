"use client";

import { createContext, type ReactNode, useContext, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type WindowTitleBarContextValue = {
	contentEnabled: boolean;
	portalTarget: HTMLDivElement | null;
	setPortalTarget: (target: HTMLDivElement | null) => void;
};

const WindowTitleBarContext = createContext<WindowTitleBarContextValue | null>(
	null,
);

/**
 * Keeps title-bar content mounted while shell views change.
 */
export function WindowTitleBarProvider({
	children,
	contentEnabled = true,
}: {
	children: ReactNode;
	contentEnabled?: boolean;
}) {
	const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);

	return (
		<WindowTitleBarContext.Provider
			value={{ contentEnabled, portalTarget, setPortalTarget }}
		>
			{children}
		</WindowTitleBarContext.Provider>
	);
}

/**
 * Reserves the native title-bar row at the shell boundary. The normal app
 * shell hosts projected controls; full-screen shell overlays only need the
 * draggable surface.
 */
export function WindowTitleBar({
	className,
	hostContent = true,
}: {
	className?: string;
	hostContent?: boolean;
}) {
	const context = useContext(WindowTitleBarContext);
	if (!context) {
		throw new Error(
			"WindowTitleBar must be used within WindowTitleBarProvider.",
		);
	}

	return (
		<div
			className={cn("isolate h-12 shrink-0 max-md:h-7", className)}
			data-slot="window-title-bar"
			data-tauri-drag-region="deep"
		>
			{hostContent ? (
				<div
					aria-hidden={context.contentEnabled ? undefined : true}
					className="h-full min-w-0"
					data-slot="window-title-bar-content-host"
					hidden={!context.contentEnabled}
					inert={context.contentEnabled ? undefined : true}
					ref={context.setPortalTarget}
				/>
			) : null}
		</div>
	);
}

/** Projects page-owned controls into the persistent shell title bar. */
export function WindowTitleBarContent({ children }: { children: ReactNode }) {
	const context = useContext(WindowTitleBarContext);
	if (!context) {
		throw new Error(
			"WindowTitleBarContent must be used within WindowTitleBarProvider.",
		);
	}

	return context.portalTarget
		? createPortal(children, context.portalTarget)
		: null;
}
