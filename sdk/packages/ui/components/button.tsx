"use client";

import { cva, type VariantProps } from "class-variance-authority";
import {
	type ComponentType,
	cloneElement,
	forwardRef,
	isValidElement,
	type ReactNode,
	type SVGProps,
} from "react";
import { ButtonControl, type ButtonControlProps } from "./button-control.js";

// Defaults live in the component CSS layer so host utilities can override them.
const VARIANTS = {
	variant: {
		primary: "cline-ui-button-primary",
		secondary: "cline-ui-button-secondary",
		ghost: "cline-ui-button-ghost",
		/** @deprecated Use primary. */
		fill: "cline-ui-button-primary",
		/** @deprecated Use secondary. */
		surface: "cline-ui-button-secondary",
	},
	tone: {
		accent: "cline-ui-button-accent",
		neutral: "cline-ui-button-neutral",
		destructive: "cline-ui-button-destructive",
	},
	size: {
		xs: "cline-ui-button-xs",
		sm: "cline-ui-button-sm",
		md: "cline-ui-button-md",
		lg: "cline-ui-button-lg",
	},
};

const BUTTON_CONFIG = {
	variants: VARIANTS,
	defaultVariants: {
		variant: "primary",
		tone: "accent",
		size: "md",
	},
} as const;

const ICON_BUTTON_CONFIG = {
	variants: VARIANTS,
	defaultVariants: {
		variant: "ghost",
		tone: "neutral",
		size: "sm",
	},
} as const;

const buttonClasses = cva("cline-ui-button", BUTTON_CONFIG);
const iconButtonClasses = cva(
	"cline-ui-button cline-ui-icon-button",
	ICON_BUTTON_CONFIG,
);

// Consumers of the helpers supply their own content, so retain the legacy SVG
// defaults. React components opt into managed icons without sizing unrelated SVGs.
export const buttonVariants = cva(
	"cline-ui-button cline-ui-button-legacy-icons",
	BUTTON_CONFIG,
);
export const iconButtonVariants = cva(
	"cline-ui-button cline-ui-icon-button cline-ui-button-legacy-icons",
	ICON_BUTTON_CONFIG,
);

export type ButtonVariant = NonNullable<
	VariantProps<typeof buttonVariants>["variant"]
>;
export type ButtonTone = NonNullable<
	VariantProps<typeof buttonVariants>["tone"]
>;
export type ButtonSize = NonNullable<
	VariantProps<typeof buttonVariants>["size"]
>;

/** An SVG icon component that forwards its props to the SVG element. */
export type ButtonIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface ButtonProps
	extends ButtonControlProps,
		VariantProps<typeof buttonVariants> {
	leadingIcon?: ButtonIcon;
	trailingIcon?: ButtonIcon;
}

function renderIcon(
	Icon: ButtonIcon | undefined,
	position: "leading" | "trailing" | "icon",
) {
	return Icon ? (
		<Icon
			aria-hidden="true"
			className="cline-ui-button__icon"
			data-icon={position}
			focusable="false"
		/>
	) : null;
}

function composeContent(
	children: ReactNode,
	asChild: boolean | undefined,
	renderContent: (children: ReactNode) => ReactNode,
) {
	if (!asChild) return renderContent(children);
	if (!isValidElement<{ children?: ReactNode }>(children)) return children;

	// Keep the actual target as Slot's only child so ButtonControl can preserve
	// its ref, native button type, and disabled event handling.
	return cloneElement(
		children,
		undefined,
		renderContent(children.props.children),
	);
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	(
		{
			asChild,
			children,
			className,
			leadingIcon,
			trailingIcon,
			size,
			tone,
			variant,
			...props
		},
		ref,
	) => (
		<ButtonControl
			{...props}
			asChild={asChild}
			className={buttonClasses({
				className: [
					!leadingIcon && !trailingIcon && "cline-ui-button-legacy-icons",
					className,
				],
				size,
				tone,
				variant,
			})}
			data-slot="button"
			ref={ref}
		>
			{leadingIcon || trailingIcon
				? composeContent(children, asChild, (label) => (
						<>
							{renderIcon(leadingIcon, "leading")}
							{label}
							{renderIcon(trailingIcon, "trailing")}
						</>
					))
				: children}
		</ButtonControl>
	),
);
Button.displayName = "Button";

export interface IconButtonProps
	extends Omit<ButtonProps, "leadingIcon" | "trailingIcon"> {
	"aria-label": string;
	/** Managed icon content. When omitted, existing children render unchanged. */
	icon?: ButtonIcon;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
	(
		{ asChild, children, className, icon, size, tone, variant, ...props },
		ref,
	) => (
		<ButtonControl
			{...props}
			asChild={asChild}
			className={iconButtonClasses({
				className: [!icon && "cline-ui-button-legacy-icons", className],
				size,
				tone,
				variant,
			})}
			data-slot="icon-button"
			ref={ref}
		>
			{icon
				? composeContent(children, asChild, () => renderIcon(icon, "icon"))
				: children}
		</ButtonControl>
	),
);
IconButton.displayName = "IconButton";
