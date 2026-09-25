"use client";

import { Loader2 } from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { TerminalPanel, type TerminalTab } from "./terminal-panel";
import { TerminalView } from "./terminal-view";
import { useTaskTerminals } from "./use-task-terminals";

const HEIGHT_STORAGE_KEY = "cline.code.terminal-dock-height";
const DEFAULT_HEIGHT = 280;
const MIN_HEIGHT = 140;
/** Leave room for the composer and a few lines of conversation above. */
const MAX_HEIGHT_RATIO = 0.75;

function readStoredHeight(): number {
	try {
		const value = Number(window.localStorage.getItem(HEIGHT_STORAGE_KEY));
		return Number.isFinite(value) && value >= MIN_HEIGHT
			? value
			: DEFAULT_HEIGHT;
	} catch {
		return DEFAULT_HEIGHT;
	}
}

function tabTitles(terminals: { id: string; title: string }[]): TerminalTab[] {
	const seen = new Map<string, number>();
	return terminals.map((terminal) => {
		const count = (seen.get(terminal.title) ?? 0) + 1;
		seen.set(terminal.title, count);
		return {
			id: terminal.id,
			title: count > 1 ? `${terminal.title} ${count}` : terminal.title,
		};
	});
}

/**
 * The task's terminal, docked under the composer. Shells persist in the
 * sidecar for as long as the app runs, so hiding the dock or switching tasks
 * never kills them; reopening a task with live shells brings the dock back.
 */
export function TerminalDock({
	scopeId,
	cwd,
	branch,
	open,
	onOpenChange,
	maximized = false,
	onToggleMaximize,
	className,
}: {
	scopeId: string;
	cwd: string;
	branch: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	maximized?: boolean;
	onToggleMaximize?: () => void;
	className?: string;
}) {
	const {
		terminals,
		activeId,
		setActiveId,
		loaded,
		openTerminal,
		closeTerminal,
	} = useTaskTerminals(scopeId);
	const [height, setHeight] = useState(DEFAULT_HEIGHT);
	const [starting, setStarting] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
	const restoredScopeRef = useRef<string | null>(null);

	useEffect(() => {
		setHeight(readStoredHeight());
	}, []);

	// A task that already has shells running comes back with its dock open.
	useEffect(() => {
		if (!loaded || restoredScopeRef.current === scopeId) return;
		restoredScopeRef.current = scopeId;
		if (terminals.length > 0 && !open) onOpenChange(true);
	}, [loaded, onOpenChange, open, scopeId, terminals.length]);

	const startTerminal = useCallback(async () => {
		if (!cwd) {
			toast({
				title: "No workspace selected",
				description: "Pick a folder for this task before opening a terminal.",
			});
			onOpenChange(false);
			return;
		}
		setStarting(true);
		try {
			await openTerminal(cwd);
		} catch (error) {
			toast({
				title: "Could not open a terminal",
				description: error instanceof Error ? error.message : String(error),
				variant: "destructive",
			});
			onOpenChange(false);
		} finally {
			setStarting(false);
		}
	}, [cwd, onOpenChange, openTerminal]);

	// Opening an empty dock starts the first shell; once the last shell is
	// gone (closed, or the user typed `exit`) the dock goes away with it.
	const hadTerminalsRef = useRef(false);
	useEffect(() => {
		if (!open) {
			hadTerminalsRef.current = false;
		} else if (terminals.length > 0) {
			hadTerminalsRef.current = true;
		}
	}, [open, terminals.length]);
	useEffect(() => {
		if (!open || !loaded || starting || terminals.length > 0) return;
		if (hadTerminalsRef.current) {
			onOpenChange(false);
			return;
		}
		void startTerminal();
	}, [loaded, onOpenChange, open, starting, startTerminal, terminals.length]);

	const handleResizeStart = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			event.preventDefault();
			dragRef.current = { startY: event.clientY, startHeight: height };
			const container = rootRef.current?.parentElement;
			const maxHeight = container
				? Math.max(
						MIN_HEIGHT,
						Math.floor(container.clientHeight * MAX_HEIGHT_RATIO),
					)
				: Number.POSITIVE_INFINITY;
			const previousCursor = document.body.style.cursor;
			const previousSelect = document.body.style.userSelect;
			document.body.style.cursor = "ns-resize";
			document.body.style.userSelect = "none";
			const onMove = (move: MouseEvent) => {
				const drag = dragRef.current;
				if (!drag) return;
				const next = drag.startHeight - (move.clientY - drag.startY);
				setHeight(Math.min(maxHeight, Math.max(MIN_HEIGHT, next)));
			};
			const onUp = () => {
				dragRef.current = null;
				document.body.style.cursor = previousCursor;
				document.body.style.userSelect = previousSelect;
				window.removeEventListener("mousemove", onMove);
				window.removeEventListener("mouseup", onUp);
				setHeight((current) => {
					try {
						window.localStorage.setItem(HEIGHT_STORAGE_KEY, String(current));
					} catch {
						// Falls back to the default height next launch.
					}
					return current;
				});
			};
			window.addEventListener("mousemove", onMove);
			window.addEventListener("mouseup", onUp);
		},
		[height],
	);

	const handleResizeKey = useCallback(
		(event: ReactKeyboardEvent<HTMLElement>) => {
			const step =
				event.key === "ArrowUp" ? 24 : event.key === "ArrowDown" ? -24 : 0;
			if (!step) return;
			event.preventDefault();
			setHeight((current) => Math.max(MIN_HEIGHT, current + step));
		},
		[],
	);

	if (!open) return null;

	const cwdLabel = cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;
	const body =
		activeId && !starting ? (
			<TerminalView autoFocus key={activeId} terminalId={activeId} />
		) : (
			<div className="flex h-full items-center gap-2 px-3 text-xs text-muted-foreground">
				<Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
				Starting shell...
			</div>
		);

	return (
		<div
			className={cn(
				"relative min-h-0 border-t border-border/70",
				maximized ? "h-full" : "shrink-0",
				className,
			)}
			ref={rootRef}
			style={maximized ? undefined : { height }}
		>
			{!maximized ? (
				<hr
					aria-label="Resize terminal"
					aria-orientation="horizontal"
					aria-valuemin={MIN_HEIGHT}
					aria-valuenow={height}
					className="absolute inset-x-0 -top-1 z-10 m-0 h-2 cursor-ns-resize border-0 bg-transparent"
					onKeyDown={handleResizeKey}
					onMouseDown={handleResizeStart}
					tabIndex={0}
				/>
			) : null}
			<TerminalPanel
				activeTabId={activeId}
				branch={branch && branch !== "no-git" ? branch : null}
				className="h-full"
				cwdLabel={cwdLabel}
				maximized={maximized}
				onClose={() => onOpenChange(false)}
				onCloseTab={(id) => void closeTerminal(id)}
				onNewTab={() => void startTerminal()}
				onSelectTab={setActiveId}
				onToggleMaximize={onToggleMaximize}
				tabs={tabTitles(terminals)}
			>
				{body}
			</TerminalPanel>
		</div>
	);
}
