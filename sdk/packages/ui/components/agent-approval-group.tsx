"use client";

import { type ReactNode, useId } from "react";

export interface AgentApprovalGroupProps {
	children: ReactNode;
	description?: string;
	icon?: ReactNode;
	title: string;
}

function ShieldIcon() {
	return (
		<svg
			aria-hidden="true"
			className="cline-ui-agent-approval-group__icon size-4 shrink-0 fill-none stroke-[var(--cline-ui-agent-approval-group-accent)] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2]"
			viewBox="0 0 24 24"
		>
			<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
			<path d="M12 8v4" />
			<path d="M12 16h.01" />
		</svg>
	);
}

export function AgentApprovalGroup({
	children,
	description,
	icon,
	title,
}: AgentApprovalGroupProps) {
	const headingId = useId();

	return (
		<section
			aria-labelledby={headingId}
			className="cline-ui-agent-approval-group rounded-cline-ui-xl border border-[color-mix(in_oklab,var(--cline-ui-agent-approval-group-accent-border)_40%,transparent)] bg-[color-mix(in_oklab,var(--cline-ui-agent-approval-group-accent)_5%,transparent)] p-3"
		>
			<div className="cline-ui-agent-approval-group__header flex items-center gap-2">
				{icon ?? <ShieldIcon />}
				<h2
					className="cline-ui-agent-approval-group__heading m-0 font-cline-ui-medium text-cline-ui-foreground text-cline-ui-sm"
					id={headingId}
				>
					{title}
				</h2>
			</div>
			{description ? (
				<p className="cline-ui-agent-approval-group__intro m-0 mt-1 text-cline-ui-muted-foreground text-cline-ui-xs">
					{description}
				</p>
			) : null}
			<div className="cline-ui-agent-approval-group__items mt-3 flex flex-col gap-2">
				{children}
			</div>
		</section>
	);
}
