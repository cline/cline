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
	children,
	...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Content
				align={align}
				className={cn(
					"bg-menu text-base text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-xs border p-2 shadow-md outline-hidden border-menu-foreground/10",
					className,
				)}
				data-slot="popover-content"
				sideOffset={sideOffset}
				{...props}>
				{children}
				<PopoverPrimitive.Arrow className="bg-menu fill-background z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-xs border-b border-r border-menu-foreground/10" />
			</PopoverPrimitive.Content>
		</PopoverPrimitive.Portal>
	)
}

PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
