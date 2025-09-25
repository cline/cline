import { cn, Tooltip } from "@heroui/react"
import { FoldVerticalIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const CompactTaskButton: React.FC<{
	className?: string
	onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
}> = ({ onClick, className }) => {
	return (
		<Tooltip>
			<TooltipContent>
				<div className="flex flex-col gap-1.5 bg-menu rounded shadow-sm border border-menu-border z-100 max-w-xs ">
					<div className="text-sm font-medium">Compact Task</div>
					<div className="text-sm text-muted-foreground">
						Reduces the number of tokens used by summarizing the task. To enable automatic condensing, turn on{" "}
						<kbd>Auto Compact</kbd> in the settings and set the threshold by clicking on the context window usage bar.
					</div>
				</div>
			</TooltipContent>
			<TooltipTrigger className={cn("flex items-center", className)}>
				<Button aria-label="Delete Task" onClick={onClick} size="icon" variant="icon">
					<FoldVerticalIcon strokeWidth={1.5} />
				</Button>
			</TooltipTrigger>
		</Tooltip>
	)
}

export default CompactTaskButton
