import { memo } from "react"
import MarkdownBlock from "@/components/common/MarkdownBlock"

interface PlanCompletionOutputProps {
	text: string
}

/**
 * Quiet visual cue that the agent's plan-mode turn ended on this response:
 * a container tinted with the yellow plan accent (matching the plan/act
 * toggle and the CLI's plan-mode color) with no header or label. The
 * response might be a question rather than a finished plan, so the box
 * deliberately makes no "Plan Created" claim.
 */
const PlanCompletionOutputRow = memo(({ text }: PlanCompletionOutputProps) => {
	return (
		<div className="rounded-sm border border-warning/20 overflow-visible bg-warning/10">
			<div className="plan-completion-content p-2 w-full [&_hr]:opacity-20 [&_p:last-child]:mb-0">
				<div className="wrap-anywhere [&_hr]:opacity-20">
					<MarkdownBlock markdown={text} />
				</div>
			</div>
		</div>
	)
})

PlanCompletionOutputRow.displayName = "PlanCompletionOutputRow"

export default PlanCompletionOutputRow
