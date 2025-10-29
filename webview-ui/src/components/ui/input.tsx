import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(({ className, type, ...props }, ref) => {
	return (
		<input
			className={cn(
				"flex h-9 w-full rounded-sm border border-input-border bg-input-background px-3 py-1 text-base text-input-foreground shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-input-placeholder focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
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
