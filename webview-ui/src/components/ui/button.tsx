import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 cursor-pointer [&_svg]:size-2",
	{
		variants: {
			variant: {
				default: "bg-button-background text-primary-foreground shadow hover:bg-button-background-hover",
				destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
				outline: "text-foreground p-0 m-0",
				secondary:
					"bg-button-secondary-background text-button-secondary-foreground shadow-sm hover:bg-button-secondary-background-hover",
				ghost: "bg-transparent border border-foreground/20 shadow-sm hover:bg-accent/10",
				link: "text-link underline-offset-4 hover:underline",
				text: "text-foreground",
				icon: "bg-transparent hover:opacity-80 p-0 h-auto m-0 border-0 cursor-pointer hover:bg-transparent hover:shadow-none focus:ring-0 focus:ring-offset-0",
			},
			size: {
				default: "h-5 p-4 [&_svg]:size-3",
				sm: "h-3 rounded-md px-3 text-sm [&_svg]:size-2",
				xs: "h-1 rounded-xs px-1 text-xs [&_svg]:size-2",
				lg: "h-8 rounded-md px-8 [&_svg]:size-3",
				icon: "px-0.5 m-0 [&_svg]:size-2",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
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
