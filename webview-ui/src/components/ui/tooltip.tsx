"use client"

import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import * as React from "react"

import { cn } from "@/lib/utils"

function TooltipProvider({ delayDuration = 0, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
	return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
	return (
		<TooltipProvider>
			<TooltipPrimitive.Root data-slot="tooltip" {...props} />
		</TooltipProvider>
	)
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
	return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
	className,
	sideOffset = 0,
	showArrow = true,
	children,
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & { showArrow?: boolean }) {
	const side = (props as any).side

	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Content
				className={cn(
					"bg-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 origin-(--radix-tooltip-content-transform-origin) rounded-xs px-1 py-1.5 text-xs text-balance border border-muted-foreground/30 shadow-2xs mx-1 wrap-break-word max-w-md p-2 overflow-visible",
					className,
				)}
				data-slot="tooltip-content"
				sideOffset={sideOffset}
				{...props}>
				<span className="text-xs leading-tight wrap-break-word">{children}</span>
				{showArrow && (
					<TooltipPrimitive.Arrow
						className={cn(
							"bg-background fill-background z-50 size-2.5 rotate-45 rounded-xs border-b border-r border-muted-foreground/30",
							side === "left" || side === "right"
								? "translate-y-[calc(-50%_-_4px)]" // Horizontal adjustment for side tooltips
								: "translate-y-[calc(-50%_-_0px)]", // Vertical adjustment for top/bottom tooltips
						)}
					/>
				)}
			</TooltipPrimitive.Content>
		</TooltipPrimitive.Portal>
	)
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
