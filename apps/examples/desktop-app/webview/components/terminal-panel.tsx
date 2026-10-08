"use client";

import {
	ChevronDown,
	FolderGit2,
	House,
	Maximize2,
	Minimize2,
	Plus,
	SquareTerminal,
	X,
} from "lucide-react";
import {
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { WindowTitleBarContent } from "@/components/window-title-bar";
import {
	addTerminal,
	attachTerminal,
	closeTerminal,
	getTerminalState,
	setActiveTerminal,
	setTerminalAvailable,
	setTerminalPanelOpen,
	subscribeTerminalState,
	toggleTerminalPanel,
} from "@/lib/terminal-store";
import { cn } from "@/lib/utils";

const HEIGHT_STORAGE_KEY = "cline.code.terminal-panel-height.v1";
const DEFAULT_HEIGHT = 300;
const MIN_HEIGHT = 120;
// Keeps the composer usable above a tall panel.
const MIN_CONTENT_HEIGHT = 200;

export type TerminalScope = { key: string; cwd?: string };

function useTerminalState() {
	return useSyncExternalStore(
		subscribeTerminalState,
		getTerminalState,
		getTerminalState,
	);
}

function isWindows(): boolean {
	return (
		typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)
	);
}

function displayCwd(scope: TerminalScope): string {
	return scope.cwd?.replace(/^\/(?:Users|home)\/[^/]+/, "~") ?? "~";
}

function readStoredHeight(): number {
	try {
		const height = Number(localStorage.getItem(HEIGHT_STORAGE_KEY));
		return height >= MIN_HEIGHT ? height : DEFAULT_HEIGHT;
	} catch {
		return DEFAULT_HEIGHT;
	}
}

function PanelButton({
	label,
	onClick,
	active,
	children,
}: {
	label: string;
	onClick: () => void;
	active?: boolean;
	children: ReactNode;
}) {
	return (
		<button
			aria-label={label}
			aria-pressed={active}
			className={cn(
				"flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground [&_svg]:size-3.5",
				active && "bg-secondary text-foreground",
			)}
			onClick={onClick}
			title={label}
			type="button"
		>
			{children}
		</button>
	);
}

/** Header/title-bar control that shows and hides the terminal panel. */
export function TerminalToggleButton() {
	const { available, open } = useTerminalState();
	if (!available) return null;
	return (
		<PanelButton
			active={open}
			label={open ? "Hide terminal (Ctrl+`)" : "Show terminal (Ctrl+`)"}
			onClick={toggleTerminalPanel}
		>
			<SquareTerminal />
		</PanelButton>
	);
}

/**
 * Bottom terminal panel. Home opens shells in the user's home directory; a
 * local session opens them in its workspace. `scope` is null where a local
 * shell makes no sense (cloud and SSH sessions).
 */
export function TerminalPanel({
	scope,
	visible,
	home,
}: {
	scope: TerminalScope | null;
	visible: boolean;
	home: boolean;
}) {
	const { tabs, active, open } = useTerminalState();
	const available = scope !== null && !isWindows();
	const scopeTabs = scope ? tabs.filter((tab) => tab.scope === scope.key) : [];
	const activeTab = scopeTabs.find(
		(tab) => tab.id === active[scope?.key ?? ""],
	);
	const shown = available && visible && open;
	const containerRef = useRef<HTMLDivElement>(null);
	const sectionRef = useRef<HTMLElement>(null);
	const [height, setHeight] = useState(DEFAULT_HEIGHT);
	const [maximized, setMaximized] = useState(false);
	const lastCount = useRef({ scope: scope?.key, count: scopeTabs.length });

	useEffect(() => setHeight(readStoredHeight()), []);

	useEffect(() => {
		setTerminalAvailable(available);
		if (!available) setTerminalPanelOpen(false);
	}, [available]);

	useEffect(() => {
		if (!available) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.ctrlKey &&
				!event.metaKey &&
				!event.altKey &&
				event.code === "Backquote"
			) {
				event.preventDefault();
				event.stopPropagation();
				toggleTerminalPanel();
			}
		};
		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () =>
			window.removeEventListener("keydown", handleKeyDown, { capture: true });
	}, [available]);

	// Opening the panel (or moving to a scope without shells) starts one.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only on open or scope change, so closing the last shell doesn't respawn it
	useEffect(() => {
		if (shown && scope && scopeTabs.length === 0) {
			addTerminal(scope.key, scope.cwd);
		}
	}, [shown, scope?.key]);

	// Closing the last shell in a scope (`exit` or the tab's X) hides the panel.
	useEffect(() => {
		const last = lastCount.current;
		if (last.scope === scope?.key && last.count > 0 && scopeTabs.length === 0) {
			setTerminalPanelOpen(false);
			setMaximized(false);
		}
		lastCount.current = { scope: scope?.key, count: scopeTabs.length };
	}, [scope?.key, scopeTabs.length]);

	useEffect(() => {
		if (shown && activeTab && containerRef.current) {
			attachTerminal(activeTab, containerRef.current);
		}
	}, [shown, activeTab]);

	useEffect(() => {
		const container = containerRef.current;
		if (!shown || !activeTab || !container) return;
		const observer = new ResizeObserver(() => activeTab.fit?.fit());
		observer.observe(container);
		return () => observer.disconnect();
	}, [shown, activeTab]);

	const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
		const parent = sectionRef.current?.parentElement;
		if (!parent || maximized) return;
		event.preventDefault();
		const handle = event.currentTarget;
		handle.setPointerCapture(event.pointerId);
		const startY = event.clientY;
		const startHeight = height;
		const maxHeight = parent.clientHeight - MIN_CONTENT_HEIGHT;
		let next = startHeight;
		const onMove = (moveEvent: PointerEvent) => {
			next = Math.round(
				Math.min(
					Math.max(startHeight + startY - moveEvent.clientY, MIN_HEIGHT),
					Math.max(maxHeight, MIN_HEIGHT),
				),
			);
			setHeight(next);
		};
		const onUp = () => {
			handle.removeEventListener("pointermove", onMove);
			handle.removeEventListener("pointerup", onUp);
			try {
				localStorage.setItem(HEIGHT_STORAGE_KEY, String(next));
			} catch {}
		};
		handle.addEventListener("pointermove", onMove);
		handle.addEventListener("pointerup", onUp);
	};

	const homeToggle =
		home && available && visible ? (
			<WindowTitleBarContent>
				<div className="flex h-full items-center justify-end px-3">
					<TerminalToggleButton />
				</div>
			</WindowTitleBarContent>
		) : null;

	if (!shown || !scope) return homeToggle;

	return (
		<>
			{homeToggle}
			<section
				aria-label="Terminal"
				className="relative flex shrink-0 flex-col border-t border-border bg-sidebar text-sidebar-foreground"
				data-slot="terminal-panel"
				ref={sectionRef}
				style={{
					height: maximized
						? "calc(100% - var(--window-title-bar-height))"
						: `min(${height}px, calc(100% - var(--window-title-bar-height) - ${MIN_CONTENT_HEIGHT}px))`,
				}}
			>
				<div
					aria-hidden="true"
					className={cn(
						"group absolute inset-x-0 -top-1 z-10 flex h-2 justify-center",
						!maximized && "cursor-row-resize",
					)}
					onPointerDown={startResize}
				>
					<span className="mt-[3px] h-[3px] w-10 rounded-full bg-border opacity-0 transition-opacity group-hover:opacity-100" />
				</div>
				<header className="flex h-10 shrink-0 items-center gap-1 border-b border-border/60 px-2">
					<div className="flex min-w-0 items-center gap-1 overflow-x-auto">
						{scopeTabs.map((tab) => {
							const isActive = tab.id === activeTab?.id;
							return (
								<div
									className={cn(
										"group flex h-7 shrink-0 items-center gap-1.5 rounded-md pr-1 pl-2.5 text-xs",
										isActive
											? "bg-background text-foreground shadow-[inset_0_0_0_1px] shadow-border/70"
											: "text-muted-foreground hover:bg-surface-hover",
									)}
									key={tab.id}
								>
									<button
										className="flex items-center gap-1.5"
										onClick={() => setActiveTerminal(scope.key, tab.id)}
										type="button"
									>
										<SquareTerminal className="size-3.5" />
										{tab.title}
									</button>
									<button
										aria-label={`Close ${tab.title}`}
										className={cn(
											"flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground",
											!isActive && "opacity-0 group-hover:opacity-100",
										)}
										onClick={() => closeTerminal(tab)}
										type="button"
									>
										<X className="size-3" />
									</button>
								</div>
							);
						})}
					</div>
					<PanelButton
						label="New terminal"
						onClick={() => addTerminal(scope.key, scope.cwd)}
					>
						<Plus />
					</PanelButton>
					<div className="ml-auto flex shrink-0 items-center gap-1">
						<span
							className="mr-1 flex max-w-72 items-center gap-1.5 truncate rounded-md border border-border/70 px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
							title={scope.cwd ?? "Home directory"}
						>
							{scope.cwd ? (
								<FolderGit2 className="size-3 shrink-0" />
							) : (
								<House className="size-3 shrink-0" />
							)}
							<span className="truncate">{displayCwd(scope)}</span>
						</span>
						<PanelButton
							label={maximized ? "Restore panel size" : "Maximize panel"}
							onClick={() => setMaximized((current) => !current)}
						>
							{maximized ? <Minimize2 /> : <Maximize2 />}
						</PanelButton>
						<PanelButton
							label="Hide terminal (Ctrl+`)"
							onClick={() => setTerminalPanelOpen(false)}
						>
							<ChevronDown />
						</PanelButton>
					</div>
				</header>
				<div
					className="min-h-0 flex-1 bg-sidebar py-2 pl-3"
					ref={containerRef}
				/>
			</section>
		</>
	);
}
