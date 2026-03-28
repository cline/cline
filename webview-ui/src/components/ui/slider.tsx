import * as SliderPrimitive from "@radix-ui/react-slider"
import * as React from "react"

import { cn } from "@/lib/utils"

const Slider = React.forwardRef<
	React.ElementRef<typeof SliderPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
	<SliderPrimitive.Root
		className={cn("relative flex w-full touch-none select-none items-center", className)}
		ref={ref}
		{...props}>
		<SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-primary">
			<SliderPrimitive.Range className="absolute h-full bg-foreground" />
		</SliderPrimitive.Track>
		<SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border border-foreground/50 bg-foreground shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" />
	</SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
