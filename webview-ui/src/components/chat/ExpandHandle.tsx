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
const ExpandHandle = memo(({ isExpanded, onToggle, className = "bg-accent" }: ExpandHandleProps) => {
	return (
		<div
			className={cn(
				"absolute -bottom-2 left-1/2 z-10 transform -translate-x-1/2 flex justify-center items-center px-5 py-0.5 cursor-pointer bg-description transition-opacity border border-none rounded-b-sm shrink-0 pointer-events-auto",
				className,
			)}
			onClick={onToggle}>
			<TriangleIcon className={cn("text-black fill-black", isExpanded ? "rotate-0" : "rotate-180")} size={8} />
		</div>
	)
})

export default ExpandHandle
