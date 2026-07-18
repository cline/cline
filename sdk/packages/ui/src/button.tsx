import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes, MouseEvent, ReactElement } from "react";
import { Children, cloneElement, forwardRef } from "react";
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
			onClick,
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
			const inactive = disabled || loading;
			const child = Children.only(children) as ReactElement<{
				onClick?: unknown;
			}>;
			return (
				<Slot
					aria-busy={loading || undefined}
					aria-disabled={inactive || undefined}
					className={classNames}
					onClick={(event: MouseEvent<HTMLElement>) => {
						if (inactive) {
							event.preventDefault();
							event.stopPropagation();
							return;
						}
						onClick?.(event as MouseEvent<HTMLButtonElement>);
					}}
					ref={ref}
					{...props}
				>
					{inactive ? cloneElement(child, { onClick: undefined }) : child}
				</Slot>
			);
		}
		return (
			<button
				aria-busy={loading || undefined}
				className={classNames}
				disabled={disabled || loading}
				onClick={onClick}
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
