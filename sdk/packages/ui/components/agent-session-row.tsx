"use client";

import { clsx } from "clsx";
import {
	type ComponentPropsWithoutRef,
	forwardRef,
	type ReactNode,
} from "react";

interface AgentSessionRowSharedProps
	extends Omit<ComponentPropsWithoutRef<"div">, "children" | "onSelect"> {
	active?: boolean;
	/** Pending actions take precedence over runtime status; unread is idle-only. */
	status?: "idle" | "pending" | "provisioning" | "running";
	unread?: boolean;
	label: ReactNode;
	timestamp?: ReactNode;
	leading?: ReactNode;
	pinnedIndicator?: ReactNode;
	/** A sibling action, so interactive controls never nest inside the row button. */
	action?: ReactNode;
}

interface AgentSessionRowDefaultControlProps {
	disabled?: boolean;
	onSelect?: ComponentPropsWithoutRef<"button">["onClick"];
	renderControl?: undefined;
}

interface AgentSessionRowHostControlProps {
	/** Opt into host-owned URL/router semantics while reusing the row presentation. */
	renderControl: (props: {
		className: string;
		children: ReactNode;
	}) => ReactNode;
	disabled?: never;
	onSelect?: never;
}

export type AgentSessionRowProps = AgentSessionRowSharedProps &
	(AgentSessionRowDefaultControlProps | AgentSessionRowHostControlProps);

/** Presentation only. Root props/ref support host-owned hover/context triggers. */
export const AgentSessionRow = forwardRef<HTMLDivElement, AgentSessionRowProps>(
	function AgentSessionRow(
		{
			active = false,
			disabled = false,
			status = "idle",
			unread = false,
			label,
			timestamp,
			leading,
			pinnedIndicator,
			action,
			onSelect,
			renderControl,
			className,
			...props
		},
		ref,
	) {
		const statusDotClass =
			status === "pending"
				? "bg-yellow-400"
				: status === "provisioning"
					? "animate-pulse bg-yellow-400"
					: status === "running"
						? "bg-green-500"
						: unread
							? "bg-blue-500"
							: "";
		const navigationClassName = clsx(
			"group grid h-8 w-full max-w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 overflow-hidden rounded-cline-ui-md px-2 text-left text-cline-ui-sm font-cline-ui-normal",
			active
				? "bg-cline-ui-surface-hover text-cline-ui-sidebar-foreground"
				: "text-cline-ui-sidebar-foreground/80 group-hover/row:bg-cline-ui-surface-hover",
		);
		const navigationContent = (
			<>
				<span className="flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden">
					{leading}
					<span className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-cline-ui-sm font-cline-ui-normal leading-tight">
						{label}
					</span>
				</span>
				<span className="flex shrink-0 items-center gap-1.5 text-cline-ui-sm text-cline-ui-muted-foreground">
					{statusDotClass ? (
						<span
							aria-hidden="true"
							className={clsx("size-1.5 rounded-full", statusDotClass)}
						/>
					) : null}
					{pinnedIndicator}
					<span className={action ? "group-hover/row:invisible" : undefined}>
						{timestamp}
					</span>
				</span>
			</>
		);
		return (
			<div
				{...props}
				ref={ref}
				className={clsx("group/row relative min-w-0", className)}
			>
				{renderControl ? (
					renderControl({
						className: navigationClassName,
						children: navigationContent,
					})
				) : (
					<button
						className={navigationClassName}
						disabled={disabled}
						onClick={onSelect}
						type="button"
					>
						{navigationContent}
					</button>
				)}
				{action}
			</div>
		);
	},
);

export interface AgentSessionRowEditorProps {
	active?: boolean;
	/** Host-owned rename input and pending indicator, without additional wrappers. */
	children: ReactNode;
}

export function AgentSessionRowEditor({
	active = false,
	children,
}: AgentSessionRowEditorProps) {
	return (
		<div
			className={clsx(
				"grid h-8 w-full max-w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 overflow-hidden rounded-cline-ui-md px-2",
				active
					? "bg-cline-ui-surface-hover text-cline-ui-sidebar-foreground"
					: "text-cline-ui-sidebar-foreground/80",
			)}
		>
			{children}
		</div>
	);
}

export interface AgentSessionOverviewProps {
	title: ReactNode;
	/** Already formatted metadata: label, display value, optional full tooltip. */
	items: ReadonlyArray<readonly [string, ReactNode, string?]>;
}

/** Hover-card content only; positioning, open state and metadata belong to the host. */
export function AgentSessionOverview({
	title,
	items,
}: AgentSessionOverviewProps) {
	return (
		<div className="min-w-0 space-y-2">
			<div className="wrap-break-word text-cline-ui-sm font-cline-ui-medium">
				{title}
			</div>
			<div className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-cline-ui-xs">
				{items.map(([label, value, fullValue]) => (
					<div className="contents" key={label}>
						<span className="text-cline-ui-muted-foreground">{label}</span>
						<span
							className="min-w-0 truncate font-cline-ui-mono text-cline-ui-foreground"
							title={fullValue}
						>
							{value}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}
