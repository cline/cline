"use client";

import "@xterm/xterm/css/xterm.css";

import { Plus, SquareTerminal, X } from "lucide-react";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useSyncExternalStore,
} from "react";
import { clampTerminalPanelHeight } from "@/lib/terminal-panel-state";
import {
	activeTerminalTabId,
	applyTerminalTheme,
	createTerminalTab,
	killTerminalTab,
	listTerminalTabs,
	normalizeTerminalCwd,
	setActiveTerminalTab,
	spawnTerminalTab,
	subscribeTerminalTabs,
	type TerminalTab,
} from "@/lib/terminal-sessions";
import { cn } from "@/lib/utils";

type TerminalPanelProps = {
	/** Directory new shells start in; empty opens the home directory. */
	cwd: string;
	height: number;
	onHeightChange: (height: number) => void;
	onClose: () => void;
};

/**
 * Bottom terminal drawer. Shell tabs are owned by `terminal-sessions` and
 * keyed by directory, so this component only decides which tab is visible
 * and keeps xterm sized to the panel.
 */
export function TerminalPanel({ cwd, ...props }: TerminalPanelProps) {
	const key = normalizeTerminalCwd(cwd);
	// Remount per directory so "no tabs" means "fresh panel" and not "the
	// last shell exited" when the workspace changes under an open panel.
	return <TerminalPanelForCwd cwd={key} key={key} {...props} />;
}

const noTabs: TerminalTab[] = [];

function TerminalPanelForCwd({
	cwd,
	height,
	onHeightChange,
	onClose,
}: TerminalPanelProps) {
	const tabs = useSyncExternalStore(
		subscribeTerminalTabs,
		() => listTerminalTabs(cwd),
		() => noTabs,
	);
	const activeId = useSyncExternalStore(
		subscribeTerminalTabs,
		() => activeTerminalTabId(cwd),
		() => null,
	);
	const activeTab = tabs.find((tab) => tab.id === activeId) ?? null;
	const hostRef = useRef<HTMLDivElement>(null);
	const hadTabsRef = useRef(false);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	useEffect(() => {
		if (tabs.length > 0) {
			hadTabsRef.current = true;
			return;
		}
		if (hadTabsRef.current) {
			// The last shell exited: close like an editor would.
			onCloseRef.current();
			return;
		}
		// Re-check the store: StrictMode replays this effect before the
		// subscription has delivered the tab created by the first run.
		if (listTerminalTabs(cwd).length === 0) createTerminalTab(cwd);
	}, [cwd, tabs.length]);

	useEffect(() => {
		const host = hostRef.current;
		if (!host || !activeTab) return;
		host.replaceChildren(activeTab.element);
		if (!activeTab.opened) {
			activeTab.term.open(activeTab.element);
			activeTab.opened = true;
		}
		activeTab.fit.fit();
		void spawnTerminalTab(activeTab);
		activeTab.term.focus();
		// A tab coming back from a detached element has stale row layout
		// until xterm redraws it.
		const frame = window.requestAnimationFrame(() => {
			activeTab.fit.fit();
			activeTab.term.refresh(0, activeTab.term.rows - 1);
		});
		const observer = new ResizeObserver(() => {
			window.requestAnimationFrame(() => activeTab.fit.fit());
		});
		observer.observe(host);
		return () => {
			window.cancelAnimationFrame(frame);
			observer.disconnect();
			// Leave the element in the store, not in a stale host.
			activeTab.element.remove();
		};
	}, [activeTab]);

	useEffect(() => {
		const observer = new MutationObserver(applyTerminalTheme);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class", "data-cline-accent"],
		});
		return () => observer.disconnect();
	}, []);

	const handleResizeStart = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (event.button !== 0) return;
			event.preventDefault();
			const startY = event.clientY;
			const startHeight = height;
			const previousCursor = document.body.style.cursor;
			const previousUserSelect = document.body.style.userSelect;
			document.body.style.cursor = "row-resize";
			document.body.style.userSelect = "none";
			const handleMove = (move: PointerEvent) => {
				onHeightChange(
					clampTerminalPanelHeight(
						startHeight + (startY - move.clientY),
						window.innerHeight,
					),
				);
			};
			const handleUp = () => {
				document.body.style.cursor = previousCursor;
				document.body.style.userSelect = previousUserSelect;
				window.removeEventListener("pointermove", handleMove);
				window.removeEventListener("pointerup", handleUp);
				window.removeEventListener("pointercancel", handleUp);
			};
			window.addEventListener("pointermove", handleMove);
			window.addEventListener("pointerup", handleUp);
			window.addEventListener("pointercancel", handleUp);
		},
		[height, onHeightChange],
	);

	return (
		<section
			aria-label="Terminal"
			className="relative flex shrink-0 flex-col border-t border-border/70 bg-background"
			style={{ height }}
		>
			<div
				aria-hidden="true"
				className="group absolute inset-x-0 -top-1.5 z-10 h-3 cursor-row-resize"
				onPointerDown={handleResizeStart}
			>
				<div className="absolute left-1/2 top-1/2 h-[3px] w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border transition-colors group-hover:bg-primary/60" />
			</div>
			{/* Tabs sit on the strip's bottom border; the active one paints over
			    it so it reads as attached to the terminal below. */}
			<div className="flex h-9 shrink-0 items-end gap-1 border-b border-border/60 bg-sidebar/50 px-2">
				<div className="flex min-w-0 items-end gap-0.5">
					{tabs.map((tab) => (
						<TerminalTabButton
							active={tab.id === activeTab?.id}
							key={tab.id}
							onClose={() => void killTerminalTab(tab)}
							onSelect={() => setActiveTerminalTab(cwd, tab.id)}
							tab={tab}
						/>
					))}
					<button
						aria-label="New terminal"
						className="mb-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground"
						onClick={() => createTerminalTab(cwd)}
						title="New terminal"
						type="button"
					>
						<Plus className="size-3.5" />
					</button>
				</div>
				<div className="mb-0.5 ml-auto flex shrink-0 items-center">
					<button
						aria-label="Hide terminal"
						className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground"
						onClick={onClose}
						title="Hide terminal (Ctrl+`)"
						type="button"
					>
						<X className="size-3.5" />
					</button>
				</div>
			</div>
			<div
				className="cline-chat-selectable min-h-0 flex-1 overflow-hidden px-3 py-2"
				ref={hostRef}
			/>
		</section>
	);
}

function TerminalTabButton({
	tab,
	active,
	onSelect,
	onClose,
}: {
	tab: TerminalTab;
	active: boolean;
	onSelect: () => void;
	onClose: () => void;
}) {
	return (
		<div className={cn("group/tab relative shrink-0", active && "-mb-px")}>
			<button
				aria-current={active ? "true" : undefined}
				className={cn(
					"inline-flex h-8 items-center gap-1.5 rounded-t-md border border-b-0 pl-2.5 pr-7 text-xs",
					active
						? "border-border/60 bg-background text-foreground"
						: "border-transparent text-muted-foreground hover:bg-surface-hover/60 hover:text-foreground",
				)}
				onClick={onSelect}
				type="button"
			>
				<SquareTerminal className="size-3.5" />
				<span className="max-w-40 truncate">{tab.label}</span>
			</button>
			<button
				aria-label={`Close ${tab.label}`}
				className="absolute right-1.5 top-1/2 inline-flex size-4 -translate-y-1/2 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-surface-hover-lighter hover:text-foreground focus-visible:opacity-100 group-hover/tab:opacity-100"
				onClick={(event) => {
					event.stopPropagation();
					onClose();
				}}
				title="Kill terminal"
				type="button"
			>
				<X className="size-3" />
			</button>
		</div>
	);
}
