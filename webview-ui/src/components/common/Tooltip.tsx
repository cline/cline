import { Tooltip as RadixTooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

interface TooltipProps {
	visible?: boolean
	hintText?: string
	tipText: string
	children: React.ReactNode
	style?: React.CSSProperties
}

const Tooltip: React.FC<TooltipProps> = ({ tipText, hintText, children }) => {
	return (
		<RadixTooltip>
			<TooltipTrigger>{children}</TooltipTrigger>
			<TooltipContent>
				<p className="bg-code-background">{tipText ?? hintText}</p>
			</TooltipContent>
		</RadixTooltip>
	)
}

export default Tooltip
