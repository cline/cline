"use client";

import {
	type HTMLAttributes,
	type ReactNode,
	type Ref,
	useId,
	useState,
} from "react";

function Icon({
	name,
}: {
	name: "close" | "copy" | "check" | "down" | "right";
}) {
	return (
		<svg
			aria-hidden="true"
			className={`${name === "close" ? "h-4 w-4" : "h-3.5 w-3.5"} ${name === "down" || name === "right" ? "shrink-0 text-cline-ui-muted-foreground" : ""}`}
			width={name === "close" ? 16 : 14}
			height={name === "close" ? 16 : 14}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			{name === "close" ? (
				<>
					<path d="M18 6 6 18" />
					<path d="m6 6 12 12" />
				</>
			) : name === "check" ? (
				<path d="m5 12 4 4L19 6" />
			) : name === "down" ? (
				<path d="m6 9 6 6 6-6" />
			) : name === "right" ? (
				<path d="m9 6 6 6-6 6" />
			) : (
				<>
					<rect x="9" y="9" width="13" height="13" rx="2" />
					<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
				</>
			)}
		</svg>
	);
}

export interface AgentChangesPanelProps extends HTMLAttributes<HTMLElement> {
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
		<section
			{...props}
			className={`cline-ui-agent-changes flex h-full min-h-0 flex-col overflow-hidden ${className}`}
		>
			<div className="cline-ui-agent-changes__header flex h-10 shrink-0 items-center justify-between border-b border-cline-ui-border bg-cline-ui-card px-4">
				<div className="cline-ui-agent-changes__heading flex items-center gap-3">
					<h2 className="text-cline-ui-xs font-medium text-cline-ui-foreground">
						{title}
					</h2>
					<span className="cline-ui-agent-changes__count rounded bg-cline-ui-secondary px-1.5 py-0.5 text-[10px] font-cline-ui-mono text-cline-ui-muted-foreground">
						Files: {fileCount}
					</span>
				</div>
				<div className="flex items-center gap-2 text-cline-ui-xs font-cline-ui-mono">
					<button
						ref={closeButtonRef}
						className="cline-ui-agent-changes__action rounded-md p-1 text-cline-ui-muted-foreground hover:bg-cline-ui-surface-hover hover:text-cline-ui-foreground transition-colors"
						aria-label="Close diff view"
						type="button"
						onClick={onClose}
					>
						<Icon name="close" />
					</button>
				</div>
			</div>
			{renderScroll ? (
				renderScroll(content)
			) : (
				<div className="cline-ui-agent-changes__scroll min-h-0 flex-1 overflow-auto">
					{content}
				</div>
			)}
		</section>
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
	const contentId = useId();
	return (
		<div className="cline-ui-agent-changes__file border-b border-cline-ui-border">
			{/* group preserves hover reveal for host-provided native actions. */}
			<div className="cline-ui-agent-changes__file-header group flex w-full items-center gap-2 bg-cline-ui-card/80 px-4 py-2 hover:bg-cline-ui-surface-hover-lighter transition-colors">
				<button
					className="cline-ui-agent-changes__toggle flex min-w-0 shrink items-center gap-2 text-left"
					aria-expanded={expanded}
					aria-controls={contentId}
					onClick={toggle}
					type="button"
				>
					<Icon name={expanded ? "down" : "right"} />
					<span className="min-w-0 truncate font-cline-ui-mono text-cline-ui-xs text-cline-ui-foreground">
						{path}
					</span>
				</button>
				<button
					className={`cline-ui-agent-changes__action cline-ui-agent-changes__copy shrink-0 rounded-md p-1 transition-opacity hover:bg-cline-ui-surface-hover hover:text-cline-ui-foreground focus-visible:opacity-100 group-hover:opacity-100 ${copied ? "opacity-100 text-cline-ui-primary" : "opacity-0 text-cline-ui-muted-foreground"}`}
					data-copied={copied || undefined}
					aria-label={`Copy file path for ${path}`}
					title="Copy file path"
					type="button"
					onClick={onCopyPath}
				>
					<Icon name={copied ? "check" : "copy"} />
				</button>
				<button
					aria-hidden
					className="cline-ui-agent-changes__spacer h-6 min-w-0 flex-1 cursor-pointer"
					onClick={toggle}
					tabIndex={-1}
					type="button"
				/>
				{actions}
				<span className="cline-ui-agent-changes__additions shrink-0 font-cline-ui-mono text-[11px] text-cline-ui-primary">
					+{additions}
				</span>
				<span className="cline-ui-agent-changes__deletions shrink-0 font-cline-ui-mono text-[11px] text-cline-ui-destructive">
					-{deletions}
				</span>
			</div>
			{expanded && (
				<div
					id={contentId}
					className="cline-ui-agent-changes__content space-y-2 border-t border-cline-ui-border bg-cline-ui-card/40 px-4 py-3"
				>
					{children}
				</div>
			)}
		</div>
	);
}
