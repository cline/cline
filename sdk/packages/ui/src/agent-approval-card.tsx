import type { ReactNode } from "react";
import { useId } from "react";
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
	responding?: boolean;
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
	responding = false,
	title,
}: AgentApprovalCardProps) {
	const titleId = useId();
	const descriptionId = useId();

	return (
		<section
			aria-busy={responding || undefined}
			aria-describedby={description ? descriptionId : undefined}
			aria-labelledby={titleId}
			className={cx("cline-ui-approval", className)}
		>
			<div className="cline-ui-approval__header">
				<span aria-hidden="true" className="cline-ui-approval__mark">
					!
				</span>
				<div>
					<h3 id={titleId}>{title}</h3>
					{description ? <p id={descriptionId}>{description}</p> : null}
				</div>
			</div>
			{detail ? (
				<div className="cline-ui-approval__detail">{detail}</div>
			) : null}
			<div className="cline-ui-approval__actions">
				<Button
					disabled={responding}
					onClick={onReject}
					size="sm"
					variant="secondary"
				>
					{rejectLabel}
				</Button>
				<Button
					loading={responding}
					onClick={onApprove}
					size="sm"
					variant="primary"
				>
					{approveLabel}
				</Button>
			</div>
		</section>
	);
}
