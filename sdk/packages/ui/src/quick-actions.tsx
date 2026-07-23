import type { ReactNode } from "react";
import { cx } from "./utils.js";

export interface AgentQuickAction {
	description: string;
	disabled?: boolean;
	id: string;
	label: string;
	value: string;
}

export interface AgentQuickActionsProps {
	actions: AgentQuickAction[];
	className?: string;
	disabled?: boolean;
	onSelect: (action: AgentQuickAction) => void;
	trailingIcon?: ReactNode;
}

export function AgentQuickActions({
	actions,
	className,
	disabled = false,
	onSelect,
	trailingIcon,
}: AgentQuickActionsProps) {
	if (actions.length === 0) return null;

	return (
		<div className={cx("cline-ui-quick-actions", className)}>
			{actions.map((action) => (
				<button
					className="cline-ui-quick-actions__item"
					disabled={disabled || action.disabled}
					key={action.id}
					onClick={() => onSelect(action)}
					type="button"
				>
					<span className="cline-ui-quick-actions__copy">
						<strong>{action.label}</strong>
						<small>{action.description}</small>
					</span>
					<span aria-hidden="true" className="cline-ui-quick-actions__arrow">
						{trailingIcon ?? "→"}
					</span>
				</button>
			))}
		</div>
	);
}
