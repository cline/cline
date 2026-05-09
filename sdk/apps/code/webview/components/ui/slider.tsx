"use client";

import * as SliderPrimitive from "@radix-ui/react-slider";
import * as React from "react";

import { cn } from "@/lib/utils";

function Slider({
	className,
	defaultValue,
	value,
	min = 0,
	max = 100,
	...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
	const _values = React.useMemo(
		() =>
			Array.isArray(value)
				? value
				: Array.isArray(defaultValue)
					? defaultValue
					: [min, max],
		[value, defaultValue, min, max],
	);
	const thumbKeyCounts = new Map<string, number>();

	return (
		<SliderPrimitive.Root
			data-slot="slider"
			defaultValue={defaultValue}
			value={value}
			min={min}
			max={max}
			className={cn(
				"relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
				className,
			)}
			{...props}
		>
			<SliderPrimitive.Track
				data-slot="slider-track"
				className={
					"bg-muted relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5"
				}
			>
				<SliderPrimitive.Range
					data-slot="slider-range"
					className={
						"bg-primary absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
					}
				/>
			</SliderPrimitive.Track>
			{_values.map((thumbValue) => {
				const valueKey = String(thumbValue);
				const occurrence = (thumbKeyCounts.get(valueKey) ?? 0) + 1;
				thumbKeyCounts.set(valueKey, occurrence);
				return (
					<SliderPrimitive.Thumb
						data-slot="slider-thumb"
						key={`${valueKey}-${occurrence}`}
						className="border-primary ring-ring/50 block size-4 shrink-0 rounded-full border bg-white shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
					/>
				);
			})}
		</SliderPrimitive.Root>
	);
}

export { Slider };
