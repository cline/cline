import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes } from "react";
import { forwardRef } from "react";
import { cx } from "./utils.js";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	asChild?: boolean;
	iconOnly?: boolean;
	loading?: boolean;
	size?: "sm" | "md" | "lg";
	variant?: "primary" | "secondary" | "ghost" | "danger";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	function Button(
		{
			asChild = false,
			children,
			className,
			disabled,
			iconOnly = false,
			loading = false,
			size = "md",
			type = "button",
			variant = "secondary",
			...props
		},
		ref,
	) {
		const classNames = cx(
			"cline-ui-button",
			`cline-ui-button--${variant}`,
			`cline-ui-button--${size}`,
			iconOnly && "cline-ui-button--icon",
			className,
		);
		if (asChild) {
			return (
				<Slot
					aria-busy={loading || undefined}
					className={classNames}
					ref={ref}
					{...props}
				>
					{children}
				</Slot>
			);
		}
		return (
			<button
				aria-busy={loading || undefined}
				className={classNames}
				disabled={disabled || loading}
				ref={ref}
				type={type}
				{...props}
			>
				{loading ? (
					<span aria-hidden="true" className="cline-ui-spinner" />
				) : null}
				{children}
			</button>
		);
	},
);
