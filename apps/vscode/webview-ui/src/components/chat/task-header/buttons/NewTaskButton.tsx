import { XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const NewTaskButton: React.FC<{
	onClick: () => void
	className?: string
}> = ({ className, onClick }) => {
	return (
		<Tooltip>
			<TooltipContent side="left">Start a New Task</TooltipContent>
			<TooltipTrigger className={cn("flex items-center", className)}>
				<Button
					aria-label="New Task"
					onClick={(e) => {
						e.preventDefault()
						e.stopPropagation()
						onClick()
					}}
					size="icon"
					variant="icon">
					<XIcon />
				</Button>
			</TooltipTrigger>
		</Tooltip>
	)
}

export default NewTaskButton
