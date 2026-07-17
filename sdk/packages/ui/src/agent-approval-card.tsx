import type { ReactNode } from "react";
import { Button } from "./button.js";
import { cx } from "./utils.js";

export interface AgentApprovalCardProps {
	approveLabel?: string;
	className?: string;
	description?: ReactNode;
	detail?: ReactNode;
	onApprove: () => void;
	onReject: () => void;
	rejectLabel?: string;
	title: ReactNode;
}

export function AgentApprovalCard({
	approveLabel = "Approve",
	className,
	description,
	detail,
	onApprove,
	onReject,
	rejectLabel = "Reject",
	title,
}: AgentApprovalCardProps) {
	return (
		<section className={cx("cline-ui-approval", className)}>
			<div className="cline-ui-approval__header">
				<span aria-hidden="true" className="cline-ui-approval__mark">
					!
				</span>
				<div>
					<h3>{title}</h3>
					{description ? <p>{description}</p> : null}
				</div>
			</div>
			{detail ? (
				<div className="cline-ui-approval__detail">{detail}</div>
			) : null}
			<div className="cline-ui-approval__actions">
				<Button onClick={onReject} size="sm" variant="secondary">
					{rejectLabel}
				</Button>
				<Button onClick={onApprove} size="sm" variant="primary">
					{approveLabel}
				</Button>
			</div>
		</section>
	);
}
