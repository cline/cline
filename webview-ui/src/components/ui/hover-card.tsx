import * as HoverCardPrimitive from "@radix-ui/react-hover-card"
import * as React from "react"

import { cn } from "@/lib/utils"

const HoverCard = HoverCardPrimitive.Root

const HoverCardTrigger = HoverCardPrimitive.Trigger

function HoverCardContent({
	className,
	align = "center",
	sideOffset = 4,
	children,
	...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
	return (
		<HoverCardPrimitive.Portal data-slot="hover-card-portal">
			<HoverCardPrimitive.Content
				align={align}
				className={cn(
					"bg-code text-code-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-64 origin-(--radix-hover-card-content-transform-origin) rounded-xs p-2 shadow-md outline-hidden border border-muted-foreground/30",
					className,
				)}
				data-slot="hover-card-content"
				sideOffset={sideOffset}
				{...props}>
				{children}
				<HoverCardPrimitive.Arrow className="bg-code fill-background z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] border-b border-r border-muted-foreground/30" />
			</HoverCardPrimitive.Content>
		</HoverCardPrimitive.Portal>
	)
}

HoverCardContent.displayName = HoverCardPrimitive.Content.displayName

export { HoverCard, HoverCardTrigger, HoverCardContent }
