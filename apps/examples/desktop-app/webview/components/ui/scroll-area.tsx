"use client";

import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import type * as React from "react";

import { cn } from "@/lib/utils";

function ScrollArea({
	className,
	viewportClassName,
	children,
	...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
	/** Extra classes for the scrolling viewport. */
	viewportClassName?: string;
}) {
	return (
		<ScrollAreaPrimitive.Root
			className={cn("relative", className)}
			data-slot="scroll-area"
			{...props}
		>
			<ScrollAreaPrimitive.Viewport
				className={cn(
					"focus-visible:ring-ring/50 size-full rounded-[inherit] scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1",
					viewportClassName,
				)}
				data-slot="scroll-area-viewport"
			>
				{children}
			</ScrollAreaPrimitive.Viewport>
			<ScrollBar className="opacity-0 pointer-events-none" />
			<ScrollAreaPrimitive.Corner className="hidden" />
		</ScrollAreaPrimitive.Root>
	);
}

function ScrollBar({
	className,
	orientation = "vertical",
	...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
	return (
		<ScrollAreaPrimitive.ScrollAreaScrollbar
			className={cn(
				"flex touch-none p-px transition-colors select-none",
				orientation === "vertical" &&
					"h-full w-2.5 border-l border-l-transparent",
				orientation === "horizontal" &&
					"h-2.5 flex-col border-t border-t-transparent",
				className,
			)}
			data-slot="scroll-area-scrollbar"
			orientation={orientation}
			{...props}
		>
			<ScrollAreaPrimitive.ScrollAreaThumb
				className="bg-border relative flex-1 rounded-full"
				data-slot="scroll-area-thumb"
			/>
		</ScrollAreaPrimitive.ScrollAreaScrollbar>
	);
}

export { ScrollArea, ScrollBar };
