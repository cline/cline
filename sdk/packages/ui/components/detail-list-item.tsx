"use client";

import { clsx } from "clsx";
import {
	type ComponentPropsWithoutRef,
	forwardRef,
	type ReactNode,
} from "react";
import { hasContent } from "./has-content.js";

export interface DetailListItemProps
	extends Omit<ComponentPropsWithoutRef<"div">, "title" | "children"> {
	/** Primary label. Compose badges or other inline content here. */
	title: ReactNode;
	/** An optional count beside the title. Zero remains visible. */
	count?: number;
	/** Supporting text below the title. */
	description?: ReactNode;
	/** A value or secondary text, aligned to the end on wide containers. */
	trailingText?: ReactNode;
	/** Independent trailing controls or links; consumers own their behavior. */
	actions?: ReactNode;
}

/** A detail item with an optional count and four content slots. Render inside a DetailList. */
export const DetailListItem = forwardRef<HTMLDivElement, DetailListItemProps>(
	function DetailListItem(
		{ title, count, description, trailingText, actions, className, ...props },
		ref,
	) {
		const hasDescription = hasContent(description);
		const hasTrailingText = hasContent(trailingText);
		const hasActions = hasContent(actions);
		return (
			<div
				{...props}
				ref={ref}
				className={clsx("cline-ui-detail-list-item", className)}
				data-slot="detail-list-item"
				data-has-description={hasDescription ? "true" : undefined}
				data-has-trailing-text={hasTrailingText ? "true" : undefined}
				data-has-actions={hasActions ? "true" : undefined}
			>
				<dt className="cline-ui-detail-list-item__title">
					{title}
					{count !== undefined ? (
						<span
							className="cline-ui-detail-list-item__count"
							data-slot="detail-list-item-count"
						>
							{count}
						</span>
					) : null}
				</dt>
				{hasDescription ? (
					<dd className="cline-ui-detail-list-item__description">
						{description}
					</dd>
				) : null}
				{hasTrailingText || hasActions || !hasDescription ? (
					<dd className="cline-ui-detail-list-item__trailing">
						{hasTrailingText ? (
							<div className="cline-ui-detail-list-item__trailing-text">
								{trailingText}
							</div>
						) : null}
						{hasActions ? (
							<div className="cline-ui-detail-list-item__actions">
								{actions}
							</div>
						) : null}
					</dd>
				) : null}
			</div>
		);
	},
);
