import { cva, type VariantProps } from "class-variance-authority"
import { AlertTriangleIcon, XIcon } from "lucide-react"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const alertVariants = cva(
	"relative w-full rounded-sm border p-2 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:text-foreground [&>svg~*]:pl-7 flex flex-col gap-1 mb-1",
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
	React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants> & { isDismissible?: boolean; title?: string }
>(({ className, variant, children, isDismissible = true, title, ...props }, ref) => {
	const [dismissed, setDismissed] = React.useState(false)
	if (dismissed) {
		return null
	}

	return (
		<div className={cn(alertVariants({ variant }), className)} ref={ref} role="alert" {...props}>
			<div className="flex items-center justify-between w-full">
				<AlertTitle className="flex gap-1 w-full">
					<AlertTriangleIcon className="shrink-0 size-2 mr-1" />
					{title}
				</AlertTitle>
				{isDismissible && (
					<Button
						aria-label="Dismiss"
						className="opacity-100 hover:opacity-100 justify-center"
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
			{children}
		</div>
	)
})
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
	({ className, ...props }, ref) => (
		<h5
			className={cn("font-medium leading-none tracking-tight text-base flex gap-1 items-center grow", className)}
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
