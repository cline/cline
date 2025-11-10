import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
	"inline-flex items-center justify-center border text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 [&_svg]:size-2",
	{
		variants: {
			variant: {
				default: "border-transparent bg-badge-background text-badge-foreground shadow hover:bg-badge-background/80",
				info: "border-transparent bg-button-background/80 text-button-foreground hover:bg-button-hover",
				danger: "border-transparent bg-error text-error-foreground shadow hover:bg-error/80",
				outline: "text-foreground",
			},
			type: {
				default: "rounded-xs px-1 font-normal",
				round: "rounded-full h-5 w-auto",
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
