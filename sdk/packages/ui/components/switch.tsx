"use client";

import { clsx } from "clsx";
import { forwardRef, type InputHTMLAttributes } from "react";

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
	) => (
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
				ref={ref}
				// biome-ignore lint/a11y/useAriaPropsForRole: Native checkboxes expose checked state, including after form reset; aria-checked would duplicate it.
				role="switch"
				type="checkbox"
			/>
			<span aria-hidden="true" className="cline-ui-switch__track">
				<span className="cline-ui-switch__thumb" data-slot="switch-thumb" />
			</span>
		</span>
	),
);
Switch.displayName = "Switch";
