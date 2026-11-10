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
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Tooltip, type TooltipProps } from "./tooltip.js";

const useIsomorphicLayoutEffect =
	typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface SegmentedControlOption {
	/** A unique value within this control. */
	value: string;
	/** Visible text and the accessible name of the option. */
	label: string;
	/** Decorative, non-interactive content, such as an icon. */
	icon?: ReactNode;
	/** Optional tooltip shown on hover and keyboard focus. */
	tooltip?: string;
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
	/** Shared control sizing: xs 1.75rem, sm 2rem, md 2.25rem, lg 2.5rem at default spacing. Defaults to md. */
	size?: SegmentedControlSize;
	/** Visually hide option labels. Supply an icon for each option. */
	iconOnly?: boolean;
	/** Mount option tooltips inside a themed wrapper when using scoped tokens. */
	tooltipPortalContainer?: TooltipProps["portalContainer"];
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
			tooltipPortalContainer,
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
		const resetStateRef = useRef({ controlled, value, defaultValue });
		useIsomorphicLayoutEffect(() => {
			resetStateRef.current = { controlled, value, defaultValue };
		}, [controlled, value, defaultValue]);
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

		useEffect(() => {
			// The external form may mount later or be replaced without a render.
			const root = fieldsetRef.current?.getRootNode();
			if (!root) return;
			const handleReset = (event: Event) => {
				const ownerForm = fieldsetRef.current?.form;
				if (!ownerForm || event.target !== ownerForm) return;
				// Wait for the native reset, including a host's preventDefault().
				queueMicrotask(() => {
					if (event.defaultPrevented) return;
					// The host may have committed a new value in its reset handler.
					const { controlled, value, defaultValue } = resetStateRef.current;
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
			root.addEventListener("reset", handleReset, true);
			return () => root.removeEventListener("reset", handleReset, true);
		}, []);

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
				className={clsx(
					"cline-ui-segmented-control",
					`cline-ui-control-size-${size}`,
					className,
				)}
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
				{options.map((option, index) => {
					const inputId = `${id}-${index}`;
					const input = (
						<input
							id={inputId}
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
					);
					return (
						<label
							htmlFor={inputId}
							className="cline-ui-segmented-control__option"
							data-disabled={option.disabled || undefined}
							key={option.value}
							title={iconOnly && !option.tooltip ? option.label : undefined}
						>
							{option.tooltip ? (
								<Tooltip
									content={option.tooltip}
									portalContainer={tooltipPortalContainer}
								>
									{input}
								</Tooltip>
							) : (
								input
							)}
							{content(option)}
						</label>
					);
				})}
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
