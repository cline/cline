"use client";

import { type ReactNode, type SVGProps, useId } from "react";
import { Badge } from "./badge.js";
import { Button } from "./button.js";

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

function Spinner({ className, ...props }: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className={`cline-ui-agent-approval-card__spinner fill-none stroke-2 stroke-current [stroke-linecap:round] [stroke-linejoin:round] ${className ?? ""}`}
			viewBox="0 0 24 24"
			{...props}
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
			className="cline-ui-agent-approval-card rounded-cline-ui-lg border border-cline-ui-border/80 bg-cline-ui-background/70 p-3"
		>
			<div className="cline-ui-agent-approval-card__header flex items-center justify-between gap-3">
				<div
					className="cline-ui-agent-approval-card__title font-cline-ui-medium text-cline-ui-foreground text-cline-ui-sm"
					id={titleId}
				>
					{title}
				</div>
				{meta ? (
					<Badge
						className="cline-ui-agent-approval-card__meta"
						size="xxs"
						variant="ghost"
					>
						{meta}
					</Badge>
				) : null}
			</div>
			{description ? (
				<div className="cline-ui-agent-approval-card__description mt-1 mb-3 text-cline-ui-muted-foreground text-cline-ui-xxs">
					{description}
				</div>
			) : null}
			{detail != null ? (
				<pre className="cline-ui-agent-approval-card__detail max-h-44 max-w-full">
					{detail}
				</pre>
			) : null}
			{error ? (
				<div className="cline-ui-agent-approval-card__error">{error}</div>
			) : null}
			<div className="cline-ui-agent-approval-card__actions">
				<Button
					className="cline-ui-agent-approval-card__button cline-ui-agent-approval-card__button--reject"
					disabled={isPending}
					leadingIcon={responding === "reject" ? Spinner : undefined}
					onClick={onReject}
					size="sm"
					tone="neutral"
					type="button"
					variant="secondary"
				>
					{responding === "reject" ? "Rejecting..." : "Reject"}
				</Button>
				<Button
					tone="neutral"
					className="cline-ui-agent-approval-card__button cline-ui-agent-approval-card__button--approve"
					disabled={isPending}
					leadingIcon={responding === "approve" ? Spinner : undefined}
					onClick={onApprove}
					size="sm"
					type="button"
					variant="primary"
				>
					{responding === "approve" ? "Approving..." : "Approve"}
				</Button>
			</div>
		</section>
	);
}
