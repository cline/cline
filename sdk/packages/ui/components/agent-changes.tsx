"use client";

import { Check, ChevronDown, ChevronRight, Copy, X } from "lucide-react";
import { type HTMLAttributes, type ReactNode, type Ref, useState } from "react";
import { Badge } from "./badge.js";
import { Button, IconButton } from "./button.js";

export interface AgentChangesPanelProps extends HTMLAttributes<HTMLDivElement> {
	title: string;
	fileCount: number | string;
	onClose: () => void;
	closeButtonRef?: Ref<HTMLButtonElement>;
	notice?: ReactNode;
	emptyMessage?: ReactNode;
	renderScroll?: (content: ReactNode) => ReactNode;
}

/** Presentation only: hosts own the source of changes and conversation focus. */
export function AgentChangesPanel({
	title,
	fileCount,
	onClose,
	closeButtonRef,
	notice,
	emptyMessage,
	renderScroll,
	children,
	className = "",
	...props
}: AgentChangesPanelProps) {
	const content = (
		<>
			{notice && (
				<div className="cline-ui-agent-changes__notice px-4 py-3 text-cline-ui-xs text-cline-ui-muted-foreground">
					{notice}
				</div>
			)}
			{emptyMessage ? (
				<div className="cline-ui-agent-changes__empty flex h-full items-center justify-center px-4 py-16 text-cline-ui-sm text-cline-ui-muted-foreground">
					{emptyMessage}
				</div>
			) : (
				children
			)}
		</>
	);
	return (
		<div
			{...props}
			className={`cline-ui-agent-changes flex h-full min-h-0 flex-col overflow-hidden ${className}`}
		>
			<div className="cline-ui-agent-changes__header flex h-10 shrink-0 items-center justify-between border-b border-cline-ui-border bg-cline-ui-card px-4">
				<div className="cline-ui-agent-changes__heading flex items-center gap-3">
					<span className="text-cline-ui-xs font-medium text-cline-ui-foreground">
						{title}
					</span>
					<Badge
						className="cline-ui-agent-changes__count font-cline-ui-mono"
						size="xxs"
						tone="neutral"
					>
						Files: {fileCount}
					</Badge>
				</div>
				<div className="flex items-center gap-2 text-cline-ui-xs font-cline-ui-mono">
					<IconButton
						ref={closeButtonRef}
						className="cline-ui-agent-changes__action"
						aria-label="Close diff view"
						icon={X}
						type="button"
						onClick={onClose}
					/>
				</div>
			</div>
			{renderScroll ? (
				renderScroll(content)
			) : (
				<div className="cline-ui-agent-changes__scroll min-h-0 flex-1 overflow-auto">
					{content}
				</div>
			)}
		</div>
	);
}

export interface AgentChangedFileProps {
	path: string;
	additions: number;
	deletions: number;
	onCopyPath: () => void;
	copied?: boolean;
	expanded?: boolean;
	onExpandedChange?: (expanded: boolean) => void;
	/** Host-specific actions, such as a native editor menu. */
	actions?: ReactNode;
	children: ReactNode;
}

export function AgentChangedFile({
	path,
	additions,
	deletions,
	onCopyPath,
	copied = false,
	expanded: controlledExpanded,
	onExpandedChange,
	actions,
	children,
}: AgentChangedFileProps) {
	const [localExpanded, setLocalExpanded] = useState(true);
	const expanded = controlledExpanded ?? localExpanded;
	const toggle = () => {
		setLocalExpanded(!expanded);
		onExpandedChange?.(!expanded);
	};
	return (
		<div className="cline-ui-agent-changes__file border-b border-cline-ui-border">
			{/* group preserves hover reveal for host-provided native actions. */}
			<div className="cline-ui-agent-changes__file-header group flex w-full items-center gap-2 bg-cline-ui-card/80 px-4 py-2 hover:bg-cline-ui-surface-hover-lighter transition-colors">
				<Button
					aria-expanded={expanded}
					className="cline-ui-agent-changes__toggle h-auto min-w-0 shrink justify-start gap-2 px-0 text-left hover:bg-transparent"
					leadingIcon={expanded ? ChevronDown : ChevronRight}
					pressScale={false}
					size="sm"
					tone="neutral"
					variant="ghost"
					onClick={toggle}
					type="button"
				>
					<span className="min-w-0 truncate font-cline-ui-mono text-cline-ui-foreground text-cline-ui-xs">
						{path}
					</span>
				</Button>
				<IconButton
					className={`cline-ui-agent-changes__action cline-ui-agent-changes__copy shrink-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 ${copied ? "opacity-100 text-cline-ui-success-text" : "opacity-0"}`}
					data-copied={copied || undefined}
					aria-label={`Copy file path for ${path}`}
					icon={copied ? Check : Copy}
					size="xs"
					title="Copy file path"
					type="button"
					onClick={onCopyPath}
				/>
				<Button
					aria-hidden
					className="cline-ui-agent-changes__spacer h-6 min-w-0 flex-1 p-0 hover:bg-transparent"
					pressScale={false}
					size="xs"
					tone="neutral"
					variant="ghost"
					onClick={toggle}
					tabIndex={-1}
					type="button"
				/>
				{actions}
				<span className="cline-ui-agent-changes__additions shrink-0 font-cline-ui-mono text-cline-ui-success-text text-cline-ui-xxs">
					+{additions}
				</span>
				<span className="cline-ui-agent-changes__deletions shrink-0 font-cline-ui-mono text-cline-ui-error-text text-cline-ui-xxs">
					-{deletions}
				</span>
			</div>
			{expanded && (
				<div className="cline-ui-agent-changes__content space-y-2 border-t border-cline-ui-border bg-cline-ui-card/40 px-4 py-3">
					{children}
				</div>
			)}
		</div>
	);
}
