import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
	"inline-flex items-center border text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 [&_svg]:size-2 text-badge-foreground shadow-xs",
	{
		variants: {
			variant: {
				default: "border-transparent bg-badge-background",
				info: "border-transparent bg-button-background/80",
				danger: "border-transparent bg-error-icon",
				outline: "text-foreground border border-accent/20",
				cline: "bg-cline border-cline",
				success: "bg-success/80 border-success",
				warning: "bg-warning/80 border-warning/50",
			},
			type: {
				default: "rounded px-1.5 py-0.5",
				round: "rounded-full h-5 w-5 justify-center p-0 border-none",
				icon: "rounded px-1.5 py-0.5 gap-1 ring-0",
			},
		},
		defaultVariants: {
			variant: "default",
			type: "default",
		},
	},
)

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, type, ...props }: BadgeProps) {
	return <div className={cn(badgeVariants({ variant, type }), className)} {...props} />
}

export { Badge, badgeVariants }
