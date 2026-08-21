"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { forwardRef, type HTMLAttributes } from "react";

export const badgeVariants = cva(
	"inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-cline-ui-sm border font-cline-ui-medium transition-colors [&_svg]:pointer-events-none [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				solid: "border-transparent",
				surface: "",
				outline: "bg-transparent",
			},
			tone: {
				neutral: "",
				accent: "",
				success: "",
				warning: "",
				info: "",
				destructive: "",
			},
			size: {
				xs: "px-1.5 py-0 text-[10px]/4 [&_svg:not([class*='size-'])]:size-2.5",
				sm: "px-1.5 pt-[0.3rem] pb-[0.2rem] text-cline-ui-xs [&_svg:not([class*='size-'])]:size-3",
				md: "px-2 py-1 text-cline-ui-sm [&_svg:not([class*='size-'])]:size-3.5",
			},
		},
		compoundVariants: [
			{
				variant: "solid",
				tone: "neutral",
				className: "bg-cline-ui-secondary text-cline-ui-secondary-foreground",
			},
			{
				variant: "surface",
				tone: "neutral",
				className:
					"border-cline-ui-border bg-cline-ui-surface-hover-lighter text-cline-ui-muted-foreground",
			},
			{
				variant: "outline",
				tone: "neutral",
				className: "border-cline-ui-border text-cline-ui-muted-foreground",
			},
			{
				variant: "solid",
				tone: "accent",
				className: "bg-cline-ui-primary text-cline-ui-primary-foreground",
			},
			{
				variant: "surface",
				tone: "accent",
				className:
					"border-cline-ui-primary/30 bg-cline-ui-primary/10 text-cline-ui-primary-emphasis",
			},
			{
				variant: "outline",
				tone: "accent",
				className: "border-cline-ui-primary/30 text-cline-ui-primary-emphasis",
			},
			{
				variant: "solid",
				tone: "success",
				className: "bg-cline-ui-success-solid text-cline-ui-success-contrast",
			},
			{
				variant: "surface",
				tone: "success",
				className:
					"border-cline-ui-success-border bg-cline-ui-success-surface text-cline-ui-success-text",
			},
			{
				variant: "outline",
				tone: "success",
				className: "border-cline-ui-success-border text-cline-ui-success-text",
			},
			{
				variant: "solid",
				tone: "warning",
				className: "bg-cline-ui-warning-solid text-cline-ui-warning-contrast",
			},
			{
				variant: "surface",
				tone: "warning",
				className:
					"border-cline-ui-warning-border bg-cline-ui-warning-surface text-cline-ui-warning-text",
			},
			{
				variant: "outline",
				tone: "warning",
				className: "border-cline-ui-warning-border text-cline-ui-warning-text",
			},
			{
				variant: "solid",
				tone: "info",
				className: "bg-cline-ui-info-solid text-cline-ui-info-contrast",
			},
			{
				variant: "surface",
				tone: "info",
				className:
					"border-cline-ui-info-border bg-cline-ui-info-surface text-cline-ui-info-text",
			},
			{
				variant: "outline",
				tone: "info",
				className: "border-cline-ui-info-border text-cline-ui-info-text",
			},
			{
				variant: "solid",
				tone: "destructive",
				className: "bg-cline-ui-error-solid text-cline-ui-error-contrast",
			},
			{
				variant: "surface",
				tone: "destructive",
				className:
					"border-cline-ui-error-border bg-cline-ui-error-surface text-cline-ui-error-text",
			},
			{
				variant: "outline",
				tone: "destructive",
				className: "border-cline-ui-error-border text-cline-ui-error-text",
			},
		],
		defaultVariants: {
			variant: "surface",
			tone: "neutral",
			size: "sm",
		},
	},
);

export type BadgeVariant = NonNullable<
	VariantProps<typeof badgeVariants>["variant"]
>;
export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;
export type BadgeSize = NonNullable<VariantProps<typeof badgeVariants>["size"]>;

export interface BadgeProps
	extends HTMLAttributes<HTMLSpanElement>,
		VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
	({ className, size, tone, variant, ...props }, ref) => (
		<span
			{...props}
			className={clsx(badgeVariants({ size, tone, variant }), className)}
			data-slot="badge"
			ref={ref}
		/>
	),
);
Badge.displayName = "Badge";
