"use client";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { isTauriAvailable } from "@/lib/desktop-client";
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
			<WindowControls />
		</WindowTitleBarContext.Provider>
	);
}

function isWindowsDesktop(): boolean {
	return (
		isTauriAvailable() &&
		typeof navigator !== "undefined" &&
		/Windows/i.test(navigator.userAgent)
	);
}

/** Native window actions for the borderless Windows frame. */
export function WindowControls() {
	const [isWindows, setIsWindows] = useState(false);
	const [isMaximized, setIsMaximized] = useState(false);

	useEffect(() => {
		if (!isWindowsDesktop()) {
			return;
		}
		setIsWindows(true);
		document.documentElement.dataset.windowsCustomTitlebar = "";
		const appWindow = getCurrentWindow();
		void appWindow.isMaximized().then(setIsMaximized);
		const unlisten = appWindow.onResized(() => {
			void appWindow.isMaximized().then(setIsMaximized);
		});
		return () => {
			delete document.documentElement.dataset.windowsCustomTitlebar;
			void unlisten.then((stopListening) => stopListening());
		};
	}, []);

	if (!isWindows) {
		return null;
	}

	const appWindow = getCurrentWindow();
	return (
		<div
			className="fixed top-0 right-0 z-50 flex h-12 bg-background"
			data-slot="window-controls"
		>
			<button
				aria-label="Minimize"
				className="flex w-12 items-center justify-center text-foreground hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
				onClick={() => void appWindow.minimize()}
				type="button"
			>
				<Minus aria-hidden="true" className="size-4" strokeWidth={1.5} />
			</button>
			<button
				aria-label={isMaximized ? "Restore" : "Maximize"}
				className="flex w-12 items-center justify-center text-foreground hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
				onClick={() => void appWindow.toggleMaximize()}
				type="button"
			>
				{isMaximized ? (
					<span aria-hidden="true" className="relative size-3.5">
						<span className="absolute top-0 right-0 size-2.5 border border-current" />
						<span className="absolute bottom-0 left-0 size-2.5 border border-current bg-background" />
					</span>
				) : (
					<Square aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
				)}
			</button>
			<button
				aria-label="Close"
				className="flex w-12 items-center justify-center text-foreground hover:bg-red-600 hover:text-white focus-visible:bg-red-600 focus-visible:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
				onClick={() => void appWindow.close()}
				type="button"
			>
				<X aria-hidden="true" className="size-4" strokeWidth={1.5} />
			</button>
		</div>
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
