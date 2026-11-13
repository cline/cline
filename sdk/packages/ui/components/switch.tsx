"use client";

import { clsx } from "clsx";
import {
	forwardRef,
	type InputHTMLAttributes,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
} from "react";

const useIsomorphicLayoutEffect =
	typeof document === "undefined" ? useEffect : useLayoutEffect;

export interface SwitchProps
	extends Omit<
		InputHTMLAttributes<HTMLInputElement>,
		"children" | "type" | "role" | "size" | "aria-checked"
	> {
	/** Color of the checked switch. Defaults to accent. */
	tone?: "accent" | "neutral";
	/** Visual size of the switch. Defaults to md. */
	size?: "sm" | "md";
	/** Temporarily lock the value while preserving its appearance. Explicit disabled wins. */
	pending?: boolean;
	onCheckedChange?: (checked: boolean) => void;
}

/**
 * Pending disables the input, and browsers take focus away from a control that
 * becomes disabled. Hand focus back when the lock lifts, unless the user has
 * moved on to something else in the meantime.
 */
function useFocusAcrossPending(pending: boolean) {
	const inputRef = useRef<HTMLInputElement>(null);
	const hadFocus = useRef(false);
	useIsomorphicLayoutEffect(() => {
		const input = inputRef.current;
		if (!input) return;
		const { activeElement } = input.getRootNode() as Document | ShadowRoot;
		if (pending) {
			// Runs as the lock is applied, before the browser moves focus away.
			hadFocus.current = activeElement === input;
			return;
		}
		if (!hadFocus.current) return;
		hadFocus.current = false;
		const focusIsUnclaimed =
			!activeElement ||
			activeElement === input ||
			activeElement === input.ownerDocument.body;
		if (focusIsUnclaimed) input.focus({ preventScroll: true });
	}, [pending]);
	return inputRef;
}

/** A native checkbox with switch semantics; className and style apply to the wrapper. */
export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
	(
		{
			className,
			style,
			dir,
			hidden,
			tone = "accent",
			size = "md",
			pending = false,
			disabled,
			onChange,
			onCheckedChange,
			...props
		},
		ref,
	) => {
		const inputRef = useFocusAcrossPending(pending);
		useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);
		return (
			<span
				className={clsx(
					"cline-ui-switch",
					`cline-ui-switch-${tone}`,
					`cline-ui-switch-${size}`,
					className,
				)}
				data-slot="switch-root"
				dir={dir}
				hidden={hidden}
				style={style}
			>
				<input
					{...props}
					aria-busy={pending || props["aria-busy"]}
					className="cline-ui-switch__input"
					data-slot="switch"
					data-pending={pending && !disabled ? "true" : undefined}
					disabled={disabled || pending}
					dir={dir}
					onChange={(event) => {
						const checked = event.currentTarget.checked;
						onChange?.(event);
						onCheckedChange?.(checked);
					}}
					ref={inputRef}
					// biome-ignore lint/a11y/useAriaPropsForRole: Native checkboxes expose checked state, including after form reset; aria-checked would duplicate it.
					role="switch"
					type="checkbox"
				/>
				<span aria-hidden="true" className="cline-ui-switch__track">
					<span className="cline-ui-switch__thumb" data-slot="switch-thumb" />
				</span>
			</span>
		);
	},
);
Switch.displayName = "Switch";
