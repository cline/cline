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

interface ButtonStyleProps {
	disabled?: boolean;
	loading?: boolean;
	size?: "sm" | "md" | "lg";
	type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
	variant?: "primary" | "secondary" | "ghost" | "danger";
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
	loading?: boolean;
	size?: "sm" | "md" | "lg";
	variant?: "primary" | "secondary" | "ghost" | "danger";
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
			loading = false,
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
			const inactive = disabled || loading;
			const child = Children.only(children) as ReactElement<{
				children?: ReactNode;
				onClick?: unknown;
				type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
			}>;
			const slottedChild = cloneElement(
				child,
				{
					...(inactive ? { onClick: undefined } : {}),
					...(child.type === "button" && child.props.type === undefined
						? { type }
						: {}),
				},
				loading ? (
					<>
						<span aria-hidden="true" className="cline-ui-spinner" />
						{child.props.children}
					</>
				) : (
					child.props.children
				),
			);
			return (
				<Slot
					aria-busy={loading || undefined}
					aria-disabled={inactive || undefined}
					className={classNames}
					tabIndex={inactive ? -1 : tabIndex}
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
					{slottedChild}
				</Slot>
			);
		}
		return (
			<button
				aria-busy={loading || undefined}
				aria-disabled={loading || undefined}
				className={classNames}
				disabled={disabled}
				onClick={(event) => {
					if (loading) {
						event.preventDefault();
						event.stopPropagation();
						return;
					}
					onClick?.(event);
				}}
				ref={ref}
				tabIndex={tabIndex}
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

export const Button = ButtonImpl as ButtonComponent;
