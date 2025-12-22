import { TriangleIcon } from "lucide-react"
import { memo } from "react"
import { cn } from "@/lib/utils"

interface ExpandHandleProps {
	isExpanded: boolean
	onToggle: () => void
	className?: string
}

/**
 * Reusable expand/collapse handle component
 * Used by CompletionOutput, PlanCompletionOutput, CommandOutput, etc.
 */
const ExpandHandle = memo(({ isExpanded, onToggle, className = "bg-editor-group-border" }: ExpandHandleProps) => {
	return (
		<div
			className={cn("absolute -bottom-2 left-1/2 flex justify-between items-center cursor-pointer border-0", className)}
			onClick={onToggle}
			style={{
				transform: "translateX(-50%)",
				padding: "1px 14px",
				borderRadius: "2px",
			}}>
			<TriangleIcon className={cn("fill-black", isExpanded ? "rotate-0" : "rotate-180")} size={11} />
		</div>
	)
})

export default ExpandHandle
