import { FoldVerticalIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const CompactTaskButton: React.FC<{
	className?: string
	disabled?: boolean
	onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
}> = ({ onClick, className, disabled }) => {
	return (
		<Tooltip>
			<TooltipContent side="left">Compact Task</TooltipContent>
			<TooltipTrigger className={cn("flex items-center", className)}>
				<Button
					aria-label="Compact Task"
					className="[&_svg]:size-3"
					disabled={disabled}
					onClick={(e) => {
						e.preventDefault()
						e.stopPropagation()
						onClick(e)
					}}
					size="icon"
					variant="icon">
					<FoldVerticalIcon />
				</Button>
			</TooltipTrigger>
		</Tooltip>
	)
}

export default CompactTaskButton
