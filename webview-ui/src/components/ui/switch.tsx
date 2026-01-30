import * as SwitchPrimitives from "@radix-ui/react-switch"
import * as React from "react"

import { cn } from "@/lib/utils"

type SwitchSize = "default" | "lg"

const sizeStyles: Record<SwitchSize, { root: string; thumb: string }> = {
	default: {
		root: "h-3 w-6",
		thumb: "h-2 w-2 data-[state=checked]:translate-x-2.5",
	},
	lg: {
		root: "h-5 w-10",
		thumb: "h-4 w-4 data-[state=checked]:translate-x-[1.3rem]",
	},
}

interface SwitchProps extends React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> {
	size?: SwitchSize
}

const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitives.Root>, SwitchProps>(
	({ className, size = "default", ...props }, ref) => (
		<SwitchPrimitives.Root
			className={cn(
				"peer inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-button-background/60 data-[state=unchecked]:bg-[#8B8B8B]",
				sizeStyles[size].root,
				className,
			)}
			{...props}
			ref={ref}>
			<SwitchPrimitives.Thumb
				className={cn(
					"pointer-events-none block rounded-full bg-button-foreground/80 shadow-lg transition-transform data-[state=unchecked]:translate-x-0",
					sizeStyles[size].thumb,
				)}
			/>
		</SwitchPrimitives.Root>
	),
)
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
