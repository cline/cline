import { cva, type VariantProps } from "class-variance-authority"
import { XIcon } from "lucide-react"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const alertVariants = cva(
	"relative w-full rounded-sm border p-4 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground [&>svg~*]:pl-7 [&>svg]:size-3 flex flex-col gap-2 mb-1",
	{
		variants: {
			variant: {
				default: "bg-banner-background text-banner-foreground border-foreground/20",
				warning: "bg-warning/50 border-foreground/20 [&>svg]:text-warning-foreground",
				danger: "bg-input-error-background text-input-error-foreground border-foreground/20 [&>svg]:text-input-error-foreground",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
)

const Alert = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants> & { isDismissible?: boolean }
>(({ className, variant, children, isDismissible = true, ...props }, ref) => {
	const [dismissed, setDismissed] = React.useState(false)
	if (dismissed) {
		return null
	}

	return (
		<div className={cn(alertVariants({ variant }), className)} ref={ref} role="alert" {...props}>
			{children}
			{isDismissible && (
				<Button
					aria-label="Dismiss"
					className="absolute top-4 right-2 opacity-100 hover:opacity-100 mt-0.5"
					onClick={(e) => {
						e.preventDefault()
						e.stopPropagation()
						setDismissed(true)
					}}
					size="icon"
					variant="icon">
					<XIcon />
				</Button>
			)}
		</div>
	)
})
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
	({ className, ...props }, ref) => (
		<h5
			className={cn("font-medium leading-none tracking-tight text-base [&>svg]:size-3 flex gap-2 items-center", className)}
			ref={ref}
			{...props}
		/>
	),
)
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
	({ className, ...props }, ref) => <div className={cn("text-sm [&_p]:leading-relaxed", className)} ref={ref} {...props} />,
)
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }
