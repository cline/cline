import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 cursor-pointer [&_svg]:size-2",
	{
		variants: {
			variant: {
				default: "bg-button-background text-primary-foreground hover:bg-button-hover",
				secondary:
					"bg-button-secondary-background text-button-secondary-foreground hover:bg-button-secondary-background-hover shadow-sm shadow-button-secondary-background/50",
				error: "bg-error text-background hover:bg-error/90 shadow-sm shadow-error/50",
				outline: "hover:bg-accent/10 border border-accent/20 shadow-sm shadow-accent/50",
				"outline-primary":
					"!bg-transparent !border-[var(--vscode-button-background)] !border-[1px] !border-solid !text-[var(--vscode-button-background)] !hover:bg-[color-mix(in_srgb,var(--vscode-button-background)_15%,transparent)] !active:bg-[color-mix(in_srgb,var(--vscode-button-background)_25%,transparent)]",
				ghost: "hover:bg-accent/10",
				link: "text-link underline-offset-4 hover:underline p-0 m-0 cursor-text select-text",
				text: "text-foreground cursor-text select-text p-0 m-0",
				icon: "hover:opacity-80 p-0 m-0 border-0 cursor-pointer hover:shadow-none focus:ring-0 focus:ring-offset-0",
				cline: "bg-cline border-foreground/20 text-cline-foreground",
				danger: "bg-[#c42b2b] border-[#c42b2b]! text-white! hover:bg-[#a82424]! hover:border-[#a82424]! active:bg-[#8f1f1f]! active:border-[#8f1f1f]!",
			},
			size: {
				default: "py-1.5 px-4 [&_svg]:size-3",
				sm: "py-1 px-3 text-sm [&_svg]:size-2",
				xs: "p-1 text-xs [&_svg]:size-2",
				lg: "py-4 px-8 [&_svg]:size-4 font-medium",
				icon: "px-0.5 m-0 [&_svg]:size-2",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
)

// The variants name of buttonVariants
export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"]

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
