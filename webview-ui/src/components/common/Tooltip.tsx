import { TooltipContent, Tooltip as TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface TooltipProps {
	visible?: boolean
	hintText?: string
	tipText: string
	children: React.ReactNode
	style?: React.CSSProperties
	className?: string
}

const Tooltip: React.FC<TooltipProps> = ({ tipText, hintText, children, className }) => {
	return (
		<TooltipProvider>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent>
				<p className={cn("bg-code-background", className)}>{tipText ?? hintText}</p>
			</TooltipContent>
		</TooltipProvider>
	)
}

export default Tooltip
