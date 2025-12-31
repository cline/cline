import { CheckIcon } from "lucide-react"
import { memo, useMemo, useState } from "react"
import { CopyButton } from "@/components/common/CopyButton"
import MarkdownBlock from "@/components/common/MarkdownBlock"
import { cn } from "@/lib/utils"
import ExpandHandle from "./ExpandHandle"

interface PlanCompletionOutputProps {
	text: string
	onCopy?: () => void
	headClassNames?: string
}

/**
 * Styled completion output for Plan Mode responses
 * Uses grayscale colors to distinguish from Act Mode's green success theme
 */
const PlanCompletionOutputRow = memo(({ text, headClassNames }: PlanCompletionOutputProps) => {
	const [isExpanded, setIsExpanded] = useState(true) // Auto-expand by default

	const { lineCount, shouldAutoShow } = useMemo(() => {
		const lineCount = text?.split("\n")?.length || 0
		const shouldAutoShow = lineCount <= 5
		return { lineCount, shouldAutoShow }
	}, [text])

	return (
		<div className="rounded-sm bg-code/80 border border-editor-group-border overflow-visible transition-border duration-300 ease-in-out hover:border-description">
			{/* Header */}
			<div
				className={cn(
					"flex items-center justify-between px-3 py-2 border-b-1 border-description/50 rounded-sm",
					headClassNames,
				)}>
				<div className="flex gap-2 items-center">
					<CheckIcon className="size-3" />
					<span className="text-foreground font-bold">Plan Created</span>
				</div>
				<CopyButton textToCopy={text || ""} />
			</div>

			{/* Content */}
			<div
				className={cn("w-full relative pb-0 overflow-visible rounded-sm", {
					"pb-2": !shouldAutoShow,
				})}>
				<div
					className={cn("plan-completion-content scroll-smooth px-3 pt-4 pb-3 overflow-y-auto", {
						"overflow-y-visible": shouldAutoShow,
						"max-h-[400px]": isExpanded && !shouldAutoShow,
						"max-h-[150px]": !isExpanded && !shouldAutoShow,
					})}>
					<div className="wrap-anywhere -mb-4 -mt-4 overflow-hidden [&_hr]:opacity-20">
						<MarkdownBlock markdown={text} />
					</div>
				</div>
				{/* Expand/collapse notch - only show if there's more than 5 lines */}
				{lineCount > 5 ? <ExpandHandle isExpanded={isExpanded} onToggle={() => setIsExpanded(!isExpanded)} /> : null}
			</div>
		</div>
	)
})

PlanCompletionOutputRow.displayName = "PlanCompletionOutputRow"

export default PlanCompletionOutputRow
