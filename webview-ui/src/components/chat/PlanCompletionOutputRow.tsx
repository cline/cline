import { NotepadTextIcon } from "lucide-react"
import { memo, useMemo } from "react"
import { CopyButton } from "@/components/common/CopyButton"
import MarkdownBlock from "@/components/common/MarkdownBlock"
import { cn } from "@/lib/utils"

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
	const { shouldAutoShow } = useMemo(() => {
		const lineCount = text?.split("\n")?.length || 0
		const shouldAutoShow = lineCount <= 5
		return { lineCount, shouldAutoShow }
	}, [text])

	return (
		<div className="rounded-sm border border-description/50 overflow-visible bg-code p-2 pt-3">
			{/* Header */}
			<div className={cn(headClassNames, "justify-between px-1")}>
				<div className="flex gap-2 items-center">
					<NotepadTextIcon className="size-2" />
					<span className="text-foreground font-bold">Plan Created</span>
				</div>
				<CopyButton textToCopy={text || ""} />
			</div>

			{/* Content */}
			<div className="w-full relative overflow-visible border-t-1 border-description/20 rounded-b-sm">
				<div
					className={cn(
						"plan-completion-content",
						"scroll-smooth p-2 pt-3 overflow-y-auto w-full [&_hr]:opacity-20 [&_p:last-child]:mb-0 max-h-[400px]",
						{
							"overflow-y-visible": shouldAutoShow,
						},
					)}>
					<div className="wrap-anywhere -mb-4 overflow-hidden [&_hr]:opacity-20">
						<MarkdownBlock markdown={text} />
					</div>
				</div>
			</div>
		</div>
	)
})

PlanCompletionOutputRow.displayName = "PlanCompletionOutputRow"

export default PlanCompletionOutputRow
