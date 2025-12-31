import { NotepadTextIcon } from "lucide-react"
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
		<div className="rounded-sm border border-description/50 overflow-visible bg-code transition-border duration-300 ease-in-out hover:border-description p-2">
			{/* Header */}
			<div className={cn(headClassNames, "justify-between")}>
				<div className="flex gap-2 items-center">
					<NotepadTextIcon className="size-2" />
					<span className="text-foreground font-bold">Plan Created</span>
				</div>
				<CopyButton textToCopy={text || ""} />
			</div>

			{/* Content */}
			<div
				className={cn("w-full relative pb-0 overflow-visible border-t-1 border-description/20 rounded-b-sm", {
					"pb-2": !shouldAutoShow,
				})}>
				<div
					className={cn("plan-completion-content", "scroll-smooth p-2 overflow-y-auto w-full [&_hr]:opacity-20", {
						"overflow-y-visible": shouldAutoShow,
						"max-h-[400px]": isExpanded && !shouldAutoShow,
						"max-h-[150px]": !isExpanded && !shouldAutoShow,
					})}>
					<div className="wrap-anywhere -my-4 overflow-hidden [&_hr]:opacity-20">
						<MarkdownBlock markdown={text} />
					</div>
				</div>
				{/* Expand/collapse notch - only show if there's more than 5 lines */}
				{lineCount > 5 ? (
					<ExpandHandle
						className="bg-foreground -bottom-4"
						isExpanded={isExpanded}
						onToggle={() => setIsExpanded(!isExpanded)}
					/>
				) : null}
			</div>
		</div>
	)
})

PlanCompletionOutputRow.displayName = "PlanCompletionOutputRow"

export default PlanCompletionOutputRow
