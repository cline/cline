import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(({ className, type, ...props }, ref) => {
	return (
		<input
			className={cn(
				"flex w-full rounded-sm border border-input-foreground/20 bg-input-background px-3 py-2 text-base text-input-foreground shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-input-placeholder focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-input-border disabled:cursor-not-allowed disabled:opacity-50 md:text-sm text-pretty text-ellipsis",
				className,
			)}
			ref={ref}
			type={type}
			{...props}
		/>
	)
})
Input.displayName = "Input"

export { Input }
