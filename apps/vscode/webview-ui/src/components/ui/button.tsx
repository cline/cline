import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 cursor-pointer [&_svg]:size-2 overflow-hidden transition-colors",
	{
		variants: {
			variant: {
				default: "bg-[#eceef0] text-[#0e0f10] hover:bg-white font-medium",
				secondary:
					"bg-[#1e2024] text-[#e4e6e9] border border-white/[0.08] hover:bg-[#282b30]",
				error: "bg-[#c45c5c] text-[#ffffff] hover:bg-[#b24d4d]",
				outline: "hover:bg-white/[0.06] border border-white/[0.12]",
				"outline-primary":
					"!bg-transparent !border-white/25 !border-[1px] !border-solid !text-[#eceef0] hover:!bg-white/[0.08]",
				ghost: "hover:bg-white/[0.06]",
				link: "text-link underline-offset-4 hover:underline p-0 m-0 cursor-text select-text hover:text-link-hover",
				text: "text-foreground cursor-text select-text p-0 m-0",
				icon: "hover:opacity-80 p-0 m-0 border-0 cursor-pointer hover:shadow-none focus:ring-0 focus:ring-offset-0",
				cline: "bg-[#24262b] border border-white/[0.1] text-[#eceef0] hover:bg-[#2d3036]",
				success:
					"bg-[#1f3327] text-[#9ad1ae] border border-[#2f4d3b] hover:bg-[#284232] hover:text-[#b8e6c8]",
				danger: "bg-[#3a1f21] border border-[#592c30]! text-[#e69e9e]! hover:bg-[#4a2629]!",
			},
			size: {
				default: "py-1.5 px-4 [&_svg]:size-3",
				sm: "py-1 px-3 text-sm [&_svg]:size-2",
				xs: "p-1 text-xs [&_svg]:size-2",
				lg: "py-4 px-8 [&_svg]:size-4 font-medium",
				icon: "px-0.5 m-0 [&_svg]:size-2",
				header: "py-1 px-4 [&_svg]:size-2.5",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
)

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
	asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, asChild = false, ...props }, ref) => {
		const Comp = asChild ? Slot : "button"
		return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
	},
)
Button.displayName = "Button"

export { Button }
