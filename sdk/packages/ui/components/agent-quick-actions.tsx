export interface AgentQuickAction {
	description: string;
	id: string;
	label: string;
	value: string;
}

export interface AgentQuickActionsProps {
	actions: AgentQuickAction[];
	className?: string;
	disabled?: boolean;
	onSelect: (action: AgentQuickAction) => void;
}

export function AgentQuickActions({
	actions,
	className,
	disabled = false,
	onSelect,
}: AgentQuickActionsProps) {
	if (actions.length === 0) return null;

	return (
		<div
			className={["cline-ui-agent-quick-actions", className]
				.filter(Boolean)
				.join(" ")}
		>
			{actions.map((action) => (
				<button
					className="cline-ui-agent-quick-actions__item"
					disabled={disabled}
					key={action.id}
					onClick={() => onSelect(action)}
					type="button"
				>
					<span className="cline-ui-agent-quick-actions__copy">
						<span className="cline-ui-agent-quick-actions__label">
							{action.label}
						</span>
						<span className="cline-ui-agent-quick-actions__description">
							{action.description}
						</span>
					</span>
					<span
						aria-hidden="true"
						className="cline-ui-agent-quick-actions__arrow"
					>
						<svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
							<path
								d="M5 12h14M12 5l7 7-7 7"
								stroke="currentColor"
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth="2"
							/>
						</svg>
					</span>
				</button>
			))}
		</div>
	);
}
