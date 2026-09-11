// biome-ignore-all lint/a11y/useAriaPropsForRole: Native checkboxes expose checked state, including after form reset; aria-checked would duplicate it.
"use client";

import { clsx } from "clsx";
import { forwardRef, type InputHTMLAttributes } from "react";

export interface SwitchProps
	extends Omit<
		InputHTMLAttributes<HTMLInputElement>,
		"children" | "type" | "role" | "size" | "aria-checked"
	> {
	onCheckedChange?: (checked: boolean) => void;
}

/** A native checkbox with switch semantics; className and style apply to the wrapper. */
export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
	({ className, style, dir, onChange, onCheckedChange, ...props }, ref) => (
		<span
			className={clsx("cline-ui-switch", className)}
			data-slot="switch-root"
			dir={dir}
			style={style}
		>
			<input
				{...props}
				className="cline-ui-switch__input"
				data-slot="switch"
				dir={dir}
				onChange={(event) => {
					const checked = event.currentTarget.checked;
					onChange?.(event);
					onCheckedChange?.(checked);
				}}
				ref={ref}
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
