import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
	"inline-flex items-center justify-center border text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 [&_svg]:size-2",
	{
		variants: {
			variant: {
				default: "border-transparent bg-badge-background text-badge-foreground shadow hover:bg-badge-background/80",
				info: "border-transparent bg-button-background text-button-foreground hover:bg-button-background/80",
				danger: "border-transparent bg-error text-error-foreground shadow hover:bg-error/80",
				outline: "text-foreground",
			},
			type: {
				default: "rounded-lg px-1",
				round: "rounded-full h-5 w-5",
			},
		},
		defaultVariants: {
			variant: "default",
			type: "default",
		},
	},
)

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
	return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
