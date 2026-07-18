import * as Collapsible from "@radix-ui/react-collapsible";
import type { ReactNode } from "react";
import { useState } from "react";
import { cx } from "./utils.js";

export type AgentActivityStatus = "idle" | "running" | "success" | "error";

export interface AgentActivityProps {
	children?: ReactNode;
	className?: string;
	defaultOpen?: boolean;
	detail?: ReactNode;
	icon?: ReactNode;
	label: string;
	status?: AgentActivityStatus;
}

export function AgentActivity({
	children,
	className,
	defaultOpen = false,
	detail,
	icon,
	label,
	status = "idle",
}: AgentActivityProps) {
	const [open, setOpen] = useState(defaultOpen);
	const content = detail ?? children;
	const activityContents = (
		<>
			<span aria-hidden="true" className="cline-ui-activity__icon">
				{status === "running" ? (
					<span aria-hidden="true" className="cline-ui-spinner" />
				) : (
					icon
				)}
			</span>
			<span className="cline-ui-activity__label">{label}</span>
			{content ? (
				<svg
					aria-hidden="true"
					className={cx(
						"cline-ui-activity__chevron",
						open && "cline-ui-activity__chevron--open",
					)}
					fill="none"
					viewBox="0 0 16 16"
				>
					<path
						d="m4 6 4 4 4-4"
						stroke="currentColor"
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth="1.5"
					/>
				</svg>
			) : null}
		</>
	);

	return (
		<Collapsible.Root
			className={cx(
				"cline-ui-activity",
				`cline-ui-activity--${status}`,
				className,
			)}
			onOpenChange={setOpen}
			open={open}
		>
			{content ? (
				<Collapsible.Trigger className="cline-ui-activity__trigger">
					{activityContents}
				</Collapsible.Trigger>
			) : (
				<div className="cline-ui-activity__trigger">{activityContents}</div>
			)}
			{content ? (
				<Collapsible.Content className="cline-ui-activity__content">
					{content}
				</Collapsible.Content>
			) : null}
		</Collapsible.Root>
	);
}
