import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xs text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default:
					"border border-vscode-input-border bg-primary text-primary-foreground shadow hover:bg-primary/90 cursor-pointer",
				destructive:
					"bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 cursor-pointer",
				outline:
					"border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground cursor-pointer",
				secondary:
					"border border-vscode-input-border bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80 cursor-pointer",
				ghost: "hover:bg-accent hover:text-accent-foreground cursor-pointer",
				link: "text-primary underline-offset-4 hover:underline cursor-pointer",
				combobox:
					"text-vscode-font-size font-normal text-popover-foreground bg-vscode-input-background border border-vscode-dropdown-border hover:bg-vscode-input-background/80 cursor-pointer",
			},
			size: {
				default: "h-7 px-3",
				sm: "h-6 px-2 text-sm",
				lg: "h-8 px-4 text-lg",
				icon: "h-7 w-7",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
)

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, asChild = false, ...props }, ref) => {
		const Comp = asChild ? Slot : "button"
		return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
	},
)
Button.displayName = "Button"

export { Button, buttonVariants }
