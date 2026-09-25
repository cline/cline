"use client";

import {
	Folder,
	GitBranch,
	Maximize2,
	Minimize2,
	Plus,
	SquareTerminal,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type TerminalTab = {
	id: string;
	title: string;
};

type TerminalPanelProps = {
	tabs: TerminalTab[];
	activeTabId: string | null;
	onSelectTab: (tabId: string) => void;
	onNewTab: () => void;
	onCloseTab: (tabId: string) => void;
	/** Folder new shells start in (the task's working directory). */
	cwdLabel: string;
	branch?: string | null;
	maximized?: boolean;
	onToggleMaximize?: () => void;
	onClose: () => void;
	className?: string;
	children: ReactNode;
};

/**
 * Chrome for the integrated terminal: a tab strip for the shells that belong
 * to this task, the folder/branch they run in, and window actions. The body
 * (the xterm surface) is passed as children.
 */
export function TerminalPanel({
	tabs,
	activeTabId,
	onSelectTab,
	onNewTab,
	onCloseTab,
	cwdLabel,
	branch,
	maximized = false,
	onToggleMaximize,
	onClose,
	className,
	children,
}: TerminalPanelProps) {
	return (
		<section
			aria-label="Terminal"
			className={cn(
				"flex min-h-0 min-w-0 flex-col bg-surface-1 text-foreground",
				className,
			)}
		>
			<header className="@container flex h-9 shrink-0 items-center gap-1 border-b border-border/70 pl-1.5 pr-1">
				<div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
					{tabs.map((tab) => {
						const active = tab.id === activeTabId;
						return (
							<div
								className={cn(
									"group relative flex h-7 shrink-0 items-center gap-1.5 rounded-md pl-2 pr-1 text-xs transition-colors",
									active
										? "bg-surface-2 text-foreground"
										: "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
								)}
								key={tab.id}
							>
								<button
									className="flex items-center gap-1.5"
									onClick={() => onSelectTab(tab.id)}
									type="button"
								>
									<SquareTerminal aria-hidden="true" className="size-3.5" />
									<span className="font-mono">{tab.title}</span>
								</button>
								<button
									aria-label={`Close ${tab.title}`}
									className={cn(
										"flex size-4 items-center justify-center rounded text-muted-foreground/70 hover:bg-surface-hover-darker hover:text-foreground",
										!active && "opacity-0 group-hover:opacity-100",
									)}
									onClick={() => onCloseTab(tab.id)}
									type="button"
								>
									<X aria-hidden="true" className="size-3" />
								</button>
							</div>
						);
					})}
					<Button
						aria-label="New terminal"
						className="size-7 text-muted-foreground hover:text-foreground"
						onClick={onNewTab}
						size="icon-sm"
						title="New terminal"
						type="button"
						variant="ghost"
					>
						<Plus aria-hidden="true" className="size-3.5" />
					</Button>
				</div>

				<div className="flex shrink-0 items-center gap-0.5">
					<span
						className="mr-1 hidden items-center gap-1.5 text-[11px] text-muted-foreground @md:inline-flex"
						title={branch ? `${cwdLabel} (${branch})` : cwdLabel}
					>
						<Folder aria-hidden="true" className="size-3 shrink-0" />
						<span className="max-w-32 truncate font-mono">{cwdLabel}</span>
						{branch ? (
							<>
								<GitBranch
									aria-hidden="true"
									className="ml-1 hidden size-3 shrink-0 @2xl:inline"
								/>
								<span className="hidden max-w-40 truncate font-mono @2xl:inline">
									{branch}
								</span>
							</>
						) : null}
					</span>
					{onToggleMaximize ? (
						<Button
							aria-label={maximized ? "Restore terminal" : "Maximize terminal"}
							className="size-7 text-muted-foreground hover:text-foreground"
							onClick={onToggleMaximize}
							size="icon-sm"
							title={maximized ? "Restore" : "Maximize"}
							type="button"
							variant="ghost"
						>
							{maximized ? (
								<Minimize2 aria-hidden="true" className="size-3.5" />
							) : (
								<Maximize2 aria-hidden="true" className="size-3.5" />
							)}
						</Button>
					) : null}
					<Button
						aria-label="Hide terminal"
						className="size-7 text-muted-foreground hover:text-foreground"
						onClick={onClose}
						size="icon-sm"
						title="Hide terminal (Ctrl+`)"
						type="button"
						variant="ghost"
					>
						<X aria-hidden="true" className="size-3.5" />
					</Button>
				</div>
			</header>
			<div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
		</section>
	);
}
