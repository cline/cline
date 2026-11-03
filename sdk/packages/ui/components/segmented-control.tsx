"use client";

import { clsx } from "clsx";
import {
	type CSSProperties,
	type FieldsetHTMLAttributes,
	forwardRef,
	type ReactNode,
	useEffect,
	useId,
	useImperativeHandle,
	useRef,
	useState,
} from "react";

export interface SegmentedControlOption {
	/** A unique value within this control. */
	value: string;
	/** Visible text and the accessible name of the option. */
	label: string;
	/** Decorative, non-interactive content, such as an icon. */
	icon?: ReactNode;
	disabled?: boolean;
}

export type SegmentedControlSize = "xs" | "sm" | "md" | "lg";

export interface SegmentedControlProps
	extends Omit<
		FieldsetHTMLAttributes<HTMLFieldSetElement>,
		"children" | "defaultValue"
	> {
	options: readonly SegmentedControlOption[];
	value?: string;
	defaultValue?: string;
	onValueChange?: (value: string) => void;
	required?: boolean;
	/** Heights: xs 2rem, sm 2.25rem, md/lg 2.5rem. lg enlarges text/icons. Defaults to md. */
	size?: SegmentedControlSize;
	/** Visually hide option labels. Supply an icon for each option. */
	iconOnly?: boolean;
}

/** A native radio group with the sliding selection from the Cline website footer. */
export const SegmentedControl = forwardRef<
	HTMLFieldSetElement,
	SegmentedControlProps
>(
	(
		{
			options,
			value,
			defaultValue,
			onValueChange,
			name,
			required,
			size = "md",
			iconOnly = false,
			className,
			style,
			form,
			...props
		},
		ref,
	) => {
		const id = useId();
		const fieldsetRef = useRef<HTMLFieldSetElement>(null);
		const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
		const controlled = value !== undefined;
		const selectedValue = controlled ? value : uncontrolledValue;
		const selectedIndex = options.findIndex(
			(option) => option.value === selectedValue,
		);
		const groupName = name ?? `cline-segmented-${id}`;
		// The fieldset is always mounted before this layout effect runs.
		useImperativeHandle(
			ref,
			() => fieldsetRef.current as HTMLFieldSetElement,
			[],
		);

		// The form prop can move this fieldset between external form owners.
		// biome-ignore lint/correctness/useExhaustiveDependencies: Rebind when the native form association changes.
		useEffect(() => {
			const ownerForm = fieldsetRef.current?.form;
			if (!ownerForm) return;
			const handleReset = (event: Event) => {
				// Wait for the native reset, including a host's preventDefault().
				queueMicrotask(() => {
					if (event.defaultPrevented) return;
					const resetValue = controlled ? value : defaultValue;
					if (!controlled) setUncontrolledValue(defaultValue);
					// Native reset restores the original defaultChecked, even for
					// controlled radios. Keep the DOM aligned when state is unchanged.
					for (const input of fieldsetRef.current?.querySelectorAll<HTMLInputElement>(
						'input[type="radio"]',
					) ?? []) {
						input.checked = input.value === resetValue;
					}
				});
			};
			ownerForm.addEventListener("reset", handleReset);
			return () => ownerForm.removeEventListener("reset", handleReset);
		}, [controlled, defaultValue, form, value]);

		const content = (option: SegmentedControlOption) => (
			<span className="cline-ui-segmented-control__segment">
				{option.icon ? (
					<span aria-hidden="true" className="cline-ui-segmented-control__icon">
						{option.icon}
					</span>
				) : null}
				<span
					className={
						iconOnly ? "cline-ui-segmented-control__sr-only" : undefined
					}
				>
					{option.label}
				</span>
			</span>
		);

		return (
			<fieldset
				{...props}
				className={clsx("cline-ui-segmented-control", className)}
				data-icon-only={iconOnly || undefined}
				data-size={size}
				data-slot="segmented-control"
				form={form}
				ref={fieldsetRef}
				style={
					{
						"--cline-ui-segmented-count": Math.max(1, options.length),
						"--cline-ui-segmented-index": selectedIndex,
						...style,
					} as CSSProperties
				}
			>
				{options.map((option) => (
					<label
						className="cline-ui-segmented-control__option"
						data-disabled={option.disabled || undefined}
						key={option.value}
						title={iconOnly ? option.label : undefined}
					>
						<input
							checked={selectedValue === option.value}
							className="cline-ui-segmented-control__input"
							data-slot="segmented-control-input"
							disabled={option.disabled}
							form={form}
							name={groupName}
							onChange={(event) => {
								if (!event.currentTarget.checked) return;
								if (!controlled) setUncontrolledValue(option.value);
								onValueChange?.(option.value);
							}}
							required={required}
							type="radio"
							value={option.value}
						/>
						{content(option)}
					</label>
				))}
				{selectedIndex >= 0 ? (
					<span
						aria-hidden="true"
						className="cline-ui-segmented-control__active"
						data-slot="segmented-control-active"
					>
						<span className="cline-ui-segmented-control__active-row">
							{options.map((option) => (
								<span
									data-disabled={option.disabled || undefined}
									key={option.value}
								>
									{content(option)}
								</span>
							))}
						</span>
					</span>
				) : null}
			</fieldset>
		);
	},
);
SegmentedControl.displayName = "SegmentedControl";
