"use client";

import { type ReactNode, useId } from "react";

export type AgentApprovalAction = "approve" | "reject";

export interface AgentApprovalCardProps {
	approveLabel?: string;
	description?: ReactNode;
	detail?: ReactNode;
	error?: ReactNode;
	meta?: ReactNode;
	onApprove: () => void;
	onReject: () => void;
	rejectLabel?: string;
	responding?: AgentApprovalAction;
	title: ReactNode;
}

function Spinner() {
	return (
		<svg
			aria-hidden="true"
			className="cline-ui-agent-approval-card__spinner"
			viewBox="0 0 24 24"
		>
			<path d="M21 12a9 9 0 1 1-6.219-8.56" />
		</svg>
	);
}

export function AgentApprovalCard({
	approveLabel = "Approve",
	description,
	detail,
	error,
	meta,
	onApprove,
	onReject,
	rejectLabel = "Reject",
	responding,
	title,
}: AgentApprovalCardProps) {
	const titleId = useId();
	const isPending = responding !== undefined;

	return (
		<section
			aria-busy={isPending || undefined}
			aria-labelledby={titleId}
			className="cline-ui-agent-approval-card"
		>
			<div className="cline-ui-agent-approval-card__header">
				<h3 className="cline-ui-agent-approval-card__title" id={titleId}>
					{title}
				</h3>
				{meta ? (
					<div className="cline-ui-agent-approval-card__meta">{meta}</div>
				) : null}
			</div>
			{description ? (
				<div className="cline-ui-agent-approval-card__description">
					{description}
				</div>
			) : null}
			{detail ? (
				<pre className="cline-ui-agent-approval-card__detail">{detail}</pre>
			) : null}
			{error ? (
				<div className="cline-ui-agent-approval-card__error">{error}</div>
			) : null}
			<div className="cline-ui-agent-approval-card__actions">
				<button
					className="cline-ui-agent-approval-card__button cline-ui-agent-approval-card__button--approve"
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
						approveLabel
					)}
				</button>
				<button
					className="cline-ui-agent-approval-card__button cline-ui-agent-approval-card__button--reject"
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
						rejectLabel
					)}
				</button>
			</div>
		</section>
	);
}
