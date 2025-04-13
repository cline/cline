"use client"

import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const checkboxVariants = cva(
	"peer h-4 w-4 shrink-0 rounded-sm border ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
	{
		variants: {
			variant: {
				default:
					"border-vscode-foreground data-[state=checked]:bg-vscode-foreground data-[state=checked]:text-primary-foreground",
				description:
					"border-vscode-descriptionForeground data-[state=checked]:bg-vscode-descriptionForeground data-[state=checked]:text-white",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
)

export interface CheckboxProps
	extends React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>,
		VariantProps<typeof checkboxVariants> {}

const Checkbox = React.forwardRef<React.ElementRef<typeof CheckboxPrimitive.Root>, CheckboxProps>(
	({ className, variant, ...props }, ref) => (
		<CheckboxPrimitive.Root ref={ref} className={cn(checkboxVariants({ variant, className }))} {...props}>
			<CheckboxPrimitive.Indicator className={cn("flex items-center justify-center text-current")}>
				<Check className="h-4 w-4 text-vscode-background" />
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	),
)
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox, checkboxVariants }
