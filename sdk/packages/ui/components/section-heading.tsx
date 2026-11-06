"use client";

import { clsx } from "clsx";
import {
	type ComponentPropsWithoutRef,
	forwardRef,
	type ReactNode,
} from "react";
import { hasContent } from "./has-content.js";

export interface SectionHeadingProps
	extends Omit<ComponentPropsWithoutRef<"div">, "title" | "children"> {
	title: ReactNode;
	/** Optional supporting content below the title and actions. */
	description?: ReactNode;
	/** An optional result count. Zero remains visible. */
	count?: number;
	/** Independent controls or links; the host owns their behavior. */
	actions?: ReactNode;
	size?: "sm" | "md" | "base" | "lg" | "xl" | "2xl";
	/** Semantic hierarchy is independent of the visual size. */
	headingLevel?: 2 | 3 | 4 | 5 | 6;
}

/** A section title with an optional description, count, and trailing actions. */
export const SectionHeading = forwardRef<HTMLDivElement, SectionHeadingProps>(
	function SectionHeading(
		{
			title,
			description,
			count,
			actions,
			size = "lg",
			headingLevel = 2,
			className,
			...props
		},
		ref,
	) {
		const Heading = `h${headingLevel}` as "h2" | "h3" | "h4" | "h5" | "h6";
		return (
			<div
				{...props}
				ref={ref}
				className={clsx("cline-ui-section-heading", className)}
				data-slot="section-heading"
				data-size={size}
			>
				<div className="cline-ui-section-heading__label">
					<Heading
						className="cline-ui-section-heading__title"
						data-slot="section-heading-title"
					>
						{title}
					</Heading>
					{count !== undefined ? (
						<span
							className="cline-ui-section-heading__count"
							data-slot="section-heading-count"
						>
							{count}
						</span>
					) : null}
				</div>
				{hasContent(actions) ? (
					<div
						className="cline-ui-section-heading__actions"
						data-slot="section-heading-actions"
					>
						{actions}
					</div>
				) : null}
				{hasContent(description) ? (
					<div
						className="cline-ui-section-heading__description"
						data-slot="section-heading-description"
					>
						{description}
					</div>
				) : null}
			</div>
		);
	},
);
