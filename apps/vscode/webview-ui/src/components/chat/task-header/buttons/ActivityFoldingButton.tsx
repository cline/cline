import { ListCollapseIcon, ListTreeIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useActivityFoldingEnabled } from "@/hooks/useActivityFolding"
import { cn } from "@/lib/utils"

/**
 * Switches the chat between "every agent activity as its own block" and "activities folded into
 * collapsible groups". View-only preference, persisted in the webview (see `useActivityFolding`).
 */
const ActivityFoldingButton: React.FC<{ className?: string }> = ({ className }) => {
	const [foldingEnabled, setFoldingEnabled] = useActivityFoldingEnabled()

	return (
		<Tooltip>
			<TooltipContent side="left">{foldingEnabled ? "Unfold agent activities" : "Fold agent activities"}</TooltipContent>
			<TooltipTrigger className={cn("flex items-center", className)}>
				<Button
					aria-label="Fold agent activities"
					aria-pressed={foldingEnabled}
					className={cn("[&_svg]:size-3", foldingEnabled && "opacity-100")}
					onClick={(e) => {
						e.preventDefault()
						e.stopPropagation()
						setFoldingEnabled(!foldingEnabled)
					}}
					size="icon"
					variant="icon">
					{foldingEnabled ? <ListCollapseIcon /> : <ListTreeIcon />}
				</Button>
			</TooltipTrigger>
		</Tooltip>
	)
}

export default ActivityFoldingButton
