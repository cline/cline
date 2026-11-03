"use client";

import { Slot } from "@radix-ui/react-slot";
import {
	type ButtonHTMLAttributes,
	type CSSProperties,
	cloneElement,
	forwardRef,
	isValidElement,
	type KeyboardEventHandler,
	type ReactNode,
	type SyntheticEvent,
} from "react";

export interface ButtonControlProps
	extends ButtonHTMLAttributes<HTMLButtonElement> {
	asChild?: boolean;
	/** Scale while pressed. Defaults to 0.98; false disables press feedback. */
	pressScale?: number | false;
	"data-slot"?: string;
}

function preventDisabledActivation(event: SyntheticEvent) {
	event.preventDefault();
	event.stopPropagation();
}

function guardDisabledKeyHandler(
	handler: KeyboardEventHandler<HTMLButtonElement> | undefined,
): KeyboardEventHandler<HTMLButtonElement> {
	return (event) => {
		if (event.key === "Enter" || event.key === " ") {
			preventDisabledActivation(event);
			return;
		}
		handler?.(event);
	};
}

function disabledCompositionProps(
	props: ButtonHTMLAttributes<HTMLButtonElement>,
) {
	return {
		"aria-disabled": true as const,
		"data-disabled": "",
		tabIndex: -1,
		onClick: preventDisabledActivation,
		onClickCapture: preventDisabledActivation,
		onKeyDown: guardDisabledKeyHandler(props.onKeyDown),
		onKeyDownCapture: guardDisabledKeyHandler(props.onKeyDownCapture),
		onKeyUp: guardDisabledKeyHandler(props.onKeyUp),
		onKeyUpCapture: guardDisabledKeyHandler(props.onKeyUpCapture),
	};
}

function composeChild(
	children: ReactNode,
	disabled: boolean | undefined,
	type: ButtonControlProps["type"],
) {
	if (!isValidElement<ButtonHTMLAttributes<HTMLButtonElement>>(children)) {
		return children;
	}

	const nativeButton = children.type === "button";
	if (!nativeButton && !disabled) return children;

	// Slot gives child props precedence. Apply the disabled contract directly
	// to the child before it merges attributes and composes event handlers.
	return cloneElement(children, {
		...(nativeButton
			? {
					type: children.props.type ?? type,
					...(disabled ? { disabled: true } : {}),
				}
			: {}),
		...(disabled ? disabledCompositionProps(children.props) : {}),
	});
}

/** Shared DOM behavior; public components supply appearance classes. */
export const ButtonControl = forwardRef<HTMLButtonElement, ButtonControlProps>(
	(
		{ asChild = false, children, disabled, pressScale, style, type, ...props },
		ref,
	) => {
		const Comp = asChild ? Slot : "button";
		const pressStyle =
			typeof pressScale === "number"
				? ({
						"--cline-ui-button-press-scale": pressScale,
						...style,
					} as CSSProperties)
				: style;

		return (
			<Comp
				{...props}
				data-press-scale={pressScale === false ? "false" : undefined}
				disabled={asChild ? undefined : disabled}
				ref={ref}
				style={pressStyle}
				type={asChild ? type : (type ?? "button")}
				{...(asChild && disabled ? disabledCompositionProps(props) : {})}
			>
				{asChild ? composeChild(children, disabled, type) : children}
			</Comp>
		);
	},
);
ButtonControl.displayName = "ButtonControl";
