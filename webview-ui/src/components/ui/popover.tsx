import * as PopoverPrimitive from "@radix-ui/react-popover"
import * as React from "react"

import { cn } from "@/lib/utils"

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverAnchor = PopoverPrimitive.Anchor

function PopoverContent({
	className,
	align = "center",
	sideOffset = 4,
	showArrow = true,
	children,
	...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & { showArrow?: boolean }) {
	// Get side prop for conditional arrow positioning
	const side = (props as any).side

	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Content
				align={align}
				className={cn(
					"bg-menu text-base text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 w-full origin-(--radix-popover-content-transform-origin) rounded-sm border p-2 shadow-md outline-hidden border-menu-foreground/10 z-1000",
					className,
				)}
				data-slot="popover-content"
				sideOffset={sideOffset}
				{...props}>
				{children}
				{showArrow && (
					<PopoverPrimitive.Arrow
						className={cn(
							"text-popover fill-menu z-50 size-2.5 rotate-45 rounded-sm border-b border-r border-menu-foreground/10",
							side === "left" || side === "right"
								? "translate-x-[calc(-50%_-_2px)]"
								: "translate-y-[calc(-50%_-_2px)]",
						)}
					/>
				)}
			</PopoverPrimitive.Content>
		</PopoverPrimitive.Portal>
	)
}

PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
