"use client";

import type { ReactNode } from "react";

export interface AgentSegmentedControlOption<T extends string> {
	value: T;
	label: ReactNode;
	/** Optional trailing count shown in a muted mono badge. */
	count?: number | string;
	disabled?: boolean;
	title?: string;
}

export interface AgentSegmentedControlProps<T extends string> {
	options: readonly AgentSegmentedControlOption<T>[];
	value: T;
	onValueChange: (value: T) => void;
	"aria-label": string;
	className?: string;
}

/**
 * Compact tab-style switcher for a small, fixed set of views or scopes.
 * Presentation only: the host owns the selected value.
 */
export function AgentSegmentedControl<T extends string>({
	options,
	value,
	onValueChange,
	"aria-label": ariaLabel,
	className = "",
}: AgentSegmentedControlProps<T>) {
	return (
		<div
			aria-label={ariaLabel}
			className={`cline-ui-segmented inline-flex shrink-0 items-center gap-0.5 rounded-md bg-cline-ui-secondary p-0.5 ${className}`}
			role="tablist"
		>
			{options.map((option) => {
				const selected = option.value === value;
				return (
					<button
						aria-selected={selected}
						className={`cline-ui-segmented__option inline-flex h-6 items-center gap-1.5 rounded-[5px] px-2 text-cline-ui-xs font-cline-ui-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
							selected
								? "bg-cline-ui-background text-cline-ui-foreground shadow-sm"
								: "text-cline-ui-muted-foreground hover:text-cline-ui-foreground"
						}`}
						disabled={option.disabled}
						key={option.value}
						onClick={() => {
							if (!selected) onValueChange(option.value);
						}}
						role="tab"
						title={option.title}
						type="button"
					>
						{option.label}
						{option.count !== undefined && (
							<span className="cline-ui-segmented__count font-cline-ui-mono text-[10px] text-cline-ui-muted-foreground">
								{option.count}
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
}
