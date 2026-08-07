import type { ClineMessage } from "@shared/ExtensionMessage"
import { CircleCheckIcon, CrosshairIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Compact divider row for /goal replies (goal set, verified complete,
 * status, cleared) — same quiet styling as the compaction dividers, with a
 * subtle success accent when the goal was verified complete. Renders the
 * controller's plain reply text verbatim.
 */
export const GoalRow = ({ message }: { message: ClineMessage }) => {
	const text = message.text?.trim()
	if (!text) {
		// Virtuoso cannot handle zero-height items; render a spacer instead of null.
		return <div aria-hidden className="h-px" />
	}

	const isCompleted = text.startsWith("Goal verified complete")
	return (
		<div className={cn("flex items-center gap-2 py-1.5", isCompleted ? "text-success" : "text-description")}>
			{isCompleted ? <CircleCheckIcon className="size-2 shrink-0" /> : <CrosshairIcon className="size-2 shrink-0" />}
			<span className="min-w-0 whitespace-pre-wrap">{text}</span>
			<div className="flex-1 min-w-4 border-t border-description/30" />
		</div>
	)
}

export default GoalRow
