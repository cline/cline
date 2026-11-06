"use client";

import { clsx } from "clsx";
import {
	type ComponentPropsWithoutRef,
	forwardRef,
	type MouseEventHandler,
	type ReactNode,
} from "react";
import { Button } from "./button.js";
import { hasContent } from "./has-content.js";

export interface EmptyStateAction {
	label: ReactNode;
	onClick: MouseEventHandler<HTMLButtonElement>;
	disabled?: boolean;
}

export interface EmptyStateProps
	extends Omit<ComponentPropsWithoutRef<"div">, "title" | "children"> {
	/** Align the message and optional actions together. Defaults to left. */
	align?: "left" | "center";
	title?: ReactNode;
	/** Semantic hierarchy is independent of the title's visual size. */
	headingLevel?: 2 | 3 | 4 | 5 | 6;
	description?: ReactNode;
	/** Description content when the description prop is omitted. */
	children?: ReactNode;
	/** An optional neutral secondary button. The host owns its behavior. */
	action?: EmptyStateAction;
	/** An optional alternative action, displayed alongside the first action. */
	secondaryAction?: EmptyStateAction;
}

/** A compact empty-state panel with an optional title and actions. */
export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(
	function EmptyState(
		{
			align = "left",
			title,
			headingLevel = 3,
			children,
			description = children,
			action,
			secondaryAction,
			className,
			...props
		},
		ref,
	) {
		const Heading = `h${headingLevel}` as "h2" | "h3" | "h4" | "h5" | "h6";
		const hasTitle = hasContent(title);
		const hasDescription = hasContent(description);
		return (
			<div
				{...props}
				ref={ref}
				className={clsx("cline-ui-empty-state", className)}
				data-slot="empty-state"
				data-align={align}
			>
				{hasTitle || hasDescription ? (
					<div className="cline-ui-empty-state__message">
						{hasTitle ? (
							<Heading
								className="cline-ui-empty-state__title"
								data-slot="empty-state-title"
							>
								{title}
							</Heading>
						) : null}
						{hasDescription ? (
							<div
								className="cline-ui-empty-state__description"
								data-slot="empty-state-description"
							>
								{description}
							</div>
						) : null}
					</div>
				) : null}
				{action || secondaryAction ? (
					<div className="cline-ui-empty-state__actions">
						{(
							[
								["action", action],
								["secondary-action", secondaryAction],
							] as const
						).map(([key, buttonAction]) =>
							buttonAction ? (
								<Button
									key={key}
									className="cline-ui-empty-state__action"
									disabled={buttonAction.disabled}
									onClick={buttonAction.onClick}
									size="sm"
									tone="neutral"
									type="button"
									variant="secondary"
								>
									{buttonAction.label}
								</Button>
							) : null,
						)}
					</div>
				) : null}
			</div>
		);
	},
);
