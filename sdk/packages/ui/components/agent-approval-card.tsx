"use client";

import { type ReactNode, useId } from "react";

export type AgentApprovalAction = "approve" | "reject";

export interface AgentApprovalCardProps {
	description?: ReactNode;
	detail?: ReactNode;
	error?: ReactNode;
	meta?: ReactNode;
	onApprove: () => void;
	onReject: () => void;
	responding?: AgentApprovalAction;
	title: ReactNode;
}

function Spinner() {
	return (
		<svg
			aria-hidden="true"
			className="cline-ui-agent-approval-card__spinner mr-1 size-3.5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2]"
			viewBox="0 0 24 24"
		>
			<path d="M21 12a9 9 0 1 1-6.219-8.56" />
		</svg>
	);
}

export function AgentApprovalCard({
	description,
	detail,
	error,
	meta,
	onApprove,
	onReject,
	responding,
	title,
}: AgentApprovalCardProps) {
	const titleId = useId();
	const isPending = responding !== undefined;

	return (
		<section
			aria-busy={isPending || undefined}
			aria-labelledby={titleId}
			className="cline-ui-agent-approval-card rounded-lg border border-border/80 bg-background/70 p-3"
		>
			<div className="cline-ui-agent-approval-card__header flex items-center justify-between gap-2">
				<div
					className="cline-ui-agent-approval-card__title text-sm font-medium text-foreground"
					id={titleId}
				>
					{title}
				</div>
				{meta ? (
					<div className="cline-ui-agent-approval-card__meta inline-flex items-center gap-1 text-[11px] text-muted-foreground">
						{meta}
					</div>
				) : null}
			</div>
			{description ? (
				<div className="cline-ui-agent-approval-card__description mt-1 text-[11px] text-muted-foreground">
					{description}
				</div>
			) : null}
			{detail != null ? (
				<pre className="cline-ui-agent-approval-card__detail mt-2 max-h-44 max-w-full overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-background p-2 font-mono text-xs text-muted-foreground">
					{detail}
				</pre>
			) : null}
			{error ? (
				<div className="cline-ui-agent-approval-card__error mt-2 text-xs text-destructive">
					{error}
				</div>
			) : null}
			<div className="cline-ui-agent-approval-card__actions mt-2 flex items-center gap-2">
				<button
					className="cline-ui-agent-approval-card__button cline-ui-agent-approval-card__button--approve inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border-0 bg-primary px-3 font-medium text-primary-foreground transition-[color,background-color,border-color,box-shadow] duration-150 ease-[ease] [&:hover]:bg-primary/90 focus-visible:outline-3 focus-visible:outline-offset-0 focus-visible:outline-ring/50 disabled:pointer-events-none disabled:opacity-50"
					disabled={isPending}
					onClick={onApprove}
					type="button"
				>
					{responding === "approve" ? (
						<>
							<Spinner />
							Approving...
						</>
					) : (
						"Approve"
					)}
				</button>
				<button
					className="cline-ui-agent-approval-card__button cline-ui-agent-approval-card__button--reject inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-background px-3 font-medium text-foreground shadow-xs transition-[color,background-color,border-color,box-shadow] duration-150 ease-[ease] [&:hover]:bg-accent [&:hover]:text-accent-foreground focus-visible:outline-3 focus-visible:outline-offset-0 focus-visible:outline-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:border-input dark:bg-input/30 dark:[&:hover]:bg-input/50"
					disabled={isPending}
					onClick={onReject}
					type="button"
				>
					{responding === "reject" ? (
						<>
							<Spinner />
							Rejecting...
						</>
					) : (
						"Reject"
					)}
				</button>
			</div>
		</section>
	);
}
