import { Slot } from "@radix-ui/react-slot";
import type {
	ButtonHTMLAttributes,
	HTMLAttributes,
	MouseEvent,
	MouseEventHandler,
	ReactElement,
	ReactNode,
	RefAttributes,
} from "react";
import { Children, cloneElement, forwardRef } from "react";
import { cx } from "./utils.js";

type ButtonSize = "sm" | "md";
type ButtonVariant = "primary" | "secondary" | "ghost";

interface ButtonStyleProps {
	disabled?: boolean;
	size?: ButtonSize;
	type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
	variant?: ButtonVariant;
}

type IconAccessibility =
	| {
			"aria-label": string;
			"aria-labelledby"?: string;
			iconOnly: true;
	  }
	| {
			"aria-label"?: string;
			"aria-labelledby": string;
			iconOnly: true;
	  }
	| {
			"aria-label"?: string;
			"aria-labelledby"?: string;
			iconOnly?: false;
	  };

export type NativeButtonProps = ButtonStyleProps &
	IconAccessibility &
	Omit<
		ButtonHTMLAttributes<HTMLButtonElement>,
		"aria-label" | "aria-labelledby"
	> & {
		asChild?: false;
	};

export type SlottedButtonProps = ButtonStyleProps &
	IconAccessibility &
	Omit<
		HTMLAttributes<HTMLElement>,
		"aria-label" | "aria-labelledby" | "children" | "onClick"
	> & {
		asChild: true;
		children: ReactElement;
		onClick?: MouseEventHandler<HTMLElement>;
	};

export type ButtonProps = NativeButtonProps | SlottedButtonProps;

interface InternalButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	asChild?: boolean;
	iconOnly?: boolean;
	size?: ButtonSize;
	variant?: ButtonVariant;
}

interface ButtonComponent {
	(props: SlottedButtonProps & RefAttributes<HTMLElement>): ReactElement | null;
	(
		props: NativeButtonProps & RefAttributes<HTMLButtonElement>,
	): ReactElement | null;
	displayName?: string;
}

const ButtonImpl = forwardRef<HTMLButtonElement, InternalButtonProps>(
	function Button(
		{
			asChild = false,
			children,
			className,
			disabled,
			iconOnly = false,
			onClick,
			size = "md",
			tabIndex,
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
			const child = Children.only(children) as ReactElement<{
				children?: ReactNode;
				onClick?: unknown;
				type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
			}>;
			const slottedChild = cloneElement(
				child,
				{
					...(disabled ? { onClick: undefined } : {}),
					...(child.type === "button" && child.props.type === undefined
						? { type }
						: {}),
				},
				child.props.children,
			);

			return (
				<Slot
					aria-disabled={disabled || undefined}
					className={classNames}
					onClick={(event: MouseEvent<HTMLElement>) => {
						if (disabled) {
							event.preventDefault();
							event.stopPropagation();
							return;
						}
						onClick?.(event as MouseEvent<HTMLButtonElement>);
					}}
					ref={ref}
					tabIndex={disabled ? -1 : tabIndex}
					{...props}
				>
					{slottedChild}
				</Slot>
			);
		}

		return (
			<button
				className={classNames}
				disabled={disabled}
				onClick={onClick}
				ref={ref}
				tabIndex={tabIndex}
				type={type}
				{...props}
			>
				{children}
			</button>
		);
	},
);

export const Button = ButtonImpl as ButtonComponent;
