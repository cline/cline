import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "@/lib/utils"

const alertVariants = cva(
	"relative w-full rounded-sm border px-1 py-3 text-sm grid has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] grid-cols-[0_1fr] has-[>svg]:gap-x-3 gap-y-0.5 items-start [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
	{
		variants: {
			variant: {
				default: "bg-code-background text-code-foreground",
				error: "text-foreground bg-error/70 [&>svg]:text-current *:data-[slot=alert-foreground]:text-foreground/90 border border-error",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
)

function Alert({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
	return <div className={cn(alertVariants({ variant }), className)} data-slot="alert" role="alert" {...props} />
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("pl-1 col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight", className)}
			data-slot="alert-title"
			{...props}
		/>
	)
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("text-foreground col-start-2 grid justify-items-start gap-1 text-sm [&_p]:leading-relaxed", className)}
			data-slot="alert-description"
			{...props}
		/>
	)
}

export { Alert, AlertTitle, AlertDescription }
