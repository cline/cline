"use client";

import { clsx } from "clsx";
import {
	type ForwardedRef,
	forwardRef,
	type HTMLAttributes,
	type NamedExoticComponent,
	type RefAttributes,
} from "react";
import { ButtonControl, type ButtonControlProps } from "./button-control.js";

interface BadgeStyleProps {
	tone?: "neutral" | "accent" | "info" | "success" | "warning" | "error";
	/** Ghost badges are transparent; clickable badges gain a fill on hover. */
	variant?: "soft" | "ghost";
	size?: "sm" | "xs" | "xxs";
}

/** Default span props; remains extendable for existing consumer wrappers. */
export interface BadgeProps
	extends BadgeStyleProps,
		HTMLAttributes<HTMLSpanElement> {
	interactive?: false;
}

export interface InteractiveBadgeProps
	extends BadgeStyleProps,
		Omit<ButtonControlProps, "asChild"> {
	asChild?: never;
	/** Explicitly render a native button instead of the default span. */
	interactive: true;
}

const colorClasses = {
	neutral: "text-cline-ui-muted-foreground",
	accent: "text-cline-ui-accent-foreground",
	info: "text-cline-ui-info-text",
	success: "text-cline-ui-success-text",
	warning: "text-cline-ui-warning-text",
	error: "text-cline-ui-error-text",
};

const surfaceClasses = {
	neutral: "border-(--neutral-a4) bg-(--neutral-a2)",
	accent: "border-cline-ui-accent-border bg-cline-ui-accent",
	info: "border-cline-ui-info-border bg-cline-ui-info-surface",
	success: "border-cline-ui-success-border bg-cline-ui-success-surface",
	warning: "border-cline-ui-warning-border bg-cline-ui-warning-surface",
	error: "border-cline-ui-error-border bg-cline-ui-error-surface",
};

const sizeClasses = {
	sm: "px-1.5 py-0.5 text-cline-ui-sm gap-1.5",
	xs: "px-[0.3rem] py-[0.15rem] text-cline-ui-xs gap-1.5",
	xxs: "px-[0.3rem] py-[0.15rem] text-cline-ui-xxs gap-[0.3rem]",
};

// Match the soft surfaces used by secondary Buttons; Tailwind guards hover
// utilities behind the hover-capable media query.
const hoverClasses = {
	neutral: "hover:bg-(--neutral-3)",
	accent: "hover:bg-cline-ui-accent-hover",
	info: "hover:bg-[color-mix(in_srgb,var(--info-surface),var(--info-text)_6%)]",
	success:
		"hover:bg-[color-mix(in_srgb,var(--success-surface),var(--success-text)_6%)]",
	warning:
		"hover:bg-[color-mix(in_srgb,var(--warning-surface),var(--warning-text)_6%)]",
	error:
		"hover:bg-[color-mix(in_srgb,var(--error-surface),var(--error-text)_6%)]",
};

const ghostHoverClasses = {
	neutral: "hover:bg-(--surface-hover) hover:text-cline-ui-foreground",
	accent: "hover:bg-[color-mix(in_srgb,currentColor_6%,transparent)]",
	info: "hover:bg-[color-mix(in_srgb,currentColor_6%,transparent)]",
	success: "hover:bg-[color-mix(in_srgb,currentColor_6%,transparent)]",
	warning: "hover:bg-[color-mix(in_srgb,currentColor_6%,transparent)]",
	error: "hover:bg-[color-mix(in_srgb,currentColor_6%,transparent)]",
};

export const Badge = forwardRef<
	HTMLSpanElement | HTMLButtonElement,
	BadgeProps | InteractiveBadgeProps
>(
	(
		{ className, tone = "neutral", variant = "soft", size = "xs", ...props },
		ref,
	) => {
		const classes = clsx(
			"inline-flex shrink-0 items-center rounded-cline-ui-sm border font-cline-ui-medium [&>svg]:size-[1em] [&>svg]:shrink-0",
			colorClasses[tone],
			variant === "ghost"
				? "border-transparent bg-transparent"
				: surfaceClasses[tone],
			sizeClasses[size],
			className,
		);

		if (props.interactive) {
			const { interactive, ...buttonProps } = props;
			return (
				<ButtonControl
					{...buttonProps}
					asChild={false}
					className={clsx(
						"cline-ui-button",
						classes,
						variant === "ghost" ? ghostHoverClasses[tone] : hoverClasses[tone],
					)}
					data-slot="badge"
					ref={ref as ForwardedRef<HTMLButtonElement>}
				/>
			);
		}

		const { interactive, ...spanProps } = props;
		return (
			<span
				{...spanProps}
				className={classes}
				data-slot="badge"
				ref={ref as ForwardedRef<HTMLSpanElement>}
			/>
		);
	},
) as NamedExoticComponent<
	| (BadgeProps & RefAttributes<HTMLSpanElement>)
	| (InteractiveBadgeProps & RefAttributes<HTMLButtonElement>)
>;
Badge.displayName = "Badge";
