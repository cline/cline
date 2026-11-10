"use client";

import { clsx } from "clsx";
import {
	type ComponentPropsWithoutRef,
	forwardRef,
	type MouseEventHandler,
	type ReactNode,
	type Ref,
	useId,
} from "react";
import { ButtonControl } from "./button-control.js";
import { hasContent } from "./has-content.js";

export interface ItemCardPrimaryAction {
	/** Access the native primary button for focus restoration. */
	ref?: Ref<HTMLButtonElement>;
	onClick: MouseEventHandler<HTMLButtonElement>;
	label?: string;
	disabled?: boolean;
}

export interface ItemCardProps
	extends Omit<ComponentPropsWithoutRef<"div">, "title" | "children"> {
	/** Display content only: interactive elements belong in actions, footer or children. */
	title: ReactNode;
	/** Optional count beside the title. Omit when the count is not relevant. */
	count?: number;
	/** Optional leading image or icon. Omit or pass null to hide; display content only. */
	icon?: ReactNode;
	description?: ReactNode;
	badges?: ReactNode;
	/**
	 * Optional trailing content, such as a switch, button or status.
	 * Omit or pass null to hide.
	 */
	actions?: ReactNode;
	/** Metadata below the description, aligned with the title. May contain links. */
	footer?: ReactNode;
	/** Additional static content or errors. */
	children?: ReactNode;
	selected?: boolean;
	/** Activates the whole card, except independent controls and links. */
	primaryAction?: ItemCardPrimaryAction;
}

/**
 * Generic item presentation with optional leading and trailing content,
 * both absent by default. Consumers own actions and state.
 */
export const ItemCard = forwardRef<HTMLDivElement, ItemCardProps>(
	function ItemCard(
		{
			title,
			count,
			icon,
			description,
			badges,
			actions,
			footer,
			children,
			selected = false,
			primaryAction,
			className,
			...props
		},
		ref,
	) {
		const id = useId();
		const hasIcon = hasContent(icon);
		const hasDescription = hasContent(description);
		const hasActions = hasContent(actions);
		const titleId = `${id}-title`;
		const descriptionId = `${id}-description`;
		const content = (
			<>
				{hasIcon ? (
					<div className="cline-ui-item-card__icon" aria-hidden="true">
						{icon}
					</div>
				) : null}
				<div className="cline-ui-item-card__text">
					<div className="cline-ui-item-card__title-row">
						<div className="cline-ui-item-card__label">
							<div className="cline-ui-item-card__title" id={titleId}>
								{title}
							</div>
							{count !== undefined ? (
								<span
									className="cline-ui-item-card__count"
									data-slot="item-card-count"
								>
									{count}
								</span>
							) : null}
						</div>
						{hasContent(badges) ? (
							<div className="cline-ui-item-card__badges">{badges}</div>
						) : null}
					</div>
					{hasDescription ? (
						<div className="cline-ui-item-card__description" id={descriptionId}>
							{description}
						</div>
					) : null}
				</div>
			</>
		);
		return (
			<div
				{...props}
				ref={ref}
				className={clsx("cline-ui-item-card", className)}
				data-slot="item-card"
				data-selected={selected ? "true" : undefined}
				data-has-icon={hasIcon ? "true" : undefined}
				data-has-actions={hasActions ? "true" : undefined}
			>
				{primaryAction ? (
					<ButtonControl
						ref={primaryAction.ref}
						className="cline-ui-item-card__primary"
						data-slot="item-card-primary"
						onClick={primaryAction.onClick}
						disabled={primaryAction.disabled}
						aria-label={primaryAction.label}
						aria-labelledby={primaryAction.label ? undefined : titleId}
						aria-describedby={hasDescription ? descriptionId : undefined}
					/>
				) : null}
				<div className="cline-ui-item-card__layout">
					<div className="cline-ui-item-card__main">{content}</div>
					{hasActions ? (
						<div
							className="cline-ui-item-card__actions"
							data-slot="item-card-actions"
						>
							{actions}
						</div>
					) : null}
					{hasContent(footer) ? (
						<div
							className="cline-ui-item-card__footer"
							data-slot="item-card-footer"
						>
							{footer}
						</div>
					) : null}
					{hasContent(children) ? (
						<div
							className="cline-ui-item-card__content"
							data-slot="item-card-content"
						>
							{children}
						</div>
					) : null}
				</div>
			</div>
		);
	},
);
