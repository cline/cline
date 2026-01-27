import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"
import { cva } from "class-variance-authority"
import React from "react"
import { cn } from "@/lib/utils"

const labelVariants = cva("bg-transparent outline-none")

const Collapsible = CollapsiblePrimitive.Root

const CollapsibleTrigger = React.forwardRef<
	React.ElementRef<typeof CollapsiblePrimitive.CollapsibleTrigger>,
	React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.CollapsibleTrigger>
>(({ className, ...props }, ref) => (
	<CollapsiblePrimitive.CollapsibleTrigger className={cn("cursor-pointer", className)} ref={ref} {...props} />
))
Collapsible.displayName = CollapsiblePrimitive.CollapsibleTrigger.displayName

const CollapsibleContent = React.forwardRef<
	React.ElementRef<typeof CollapsiblePrimitive.CollapsibleContent>,
	React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.CollapsibleContent>
>(({ className, ...props }, ref) => (
	<CollapsiblePrimitive.CollapsibleContent className={cn(labelVariants(), className)} ref={ref} {...props} />
))
Collapsible.displayName = CollapsiblePrimitive.CollapsibleContent.displayName

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
