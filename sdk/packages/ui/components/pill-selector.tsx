"use client";

import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { clsx } from "clsx";
import { forwardRef } from "react";

export interface PillSelectorProps
	extends Omit<
		ToggleGroupPrimitive.ToggleGroupSingleProps,
		"type" | "orientation" | "rovingFocus"
	> {}

/** A single-selection group. Clicking the selected item emits an empty string. */
export const PillSelector = forwardRef<HTMLDivElement, PillSelectorProps>(
	({ className, ...props }, ref) => (
		<ToggleGroupPrimitive.Root
			{...props}
			className={clsx("cline-ui-pill-selector", className)}
			data-slot="pill-selector"
			orientation="horizontal"
			ref={ref}
			rovingFocus
			type="single"
		/>
	),
);
PillSelector.displayName = "PillSelector";

export interface PillSelectorItemProps
	extends ToggleGroupPrimitive.ToggleGroupItemProps {}

export const PillSelectorItem = forwardRef<
	HTMLButtonElement,
	PillSelectorItemProps
>(({ className, onFocus, ...props }, ref) => (
	<ToggleGroupPrimitive.Item
		{...props}
		className={clsx("cline-ui-pill-selector__item", className)}
		data-slot="pill-selector-item"
		onFocus={(event) => {
			onFocus?.(event);
			if (!event.defaultPrevented) {
				event.currentTarget.scrollIntoView?.({
					block: "nearest",
					inline: "nearest",
				});
			}
		}}
		ref={ref}
	/>
));
PillSelectorItem.displayName = "PillSelectorItem";
