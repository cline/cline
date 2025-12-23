import { memo, useMemo, useState } from "react"
import { CopyButton } from "@/components/common/CopyButton"
import MarkdownBlock from "@/components/common/MarkdownBlock"
import { cn } from "@/lib/utils"
import ExpandHandle from "./ExpandHandle"

interface PlanCompletionOutputProps {
	text: string
	onCopy?: () => void
}

/**
 * Styled completion output for Plan Mode responses
 * Uses grayscale colors to distinguish from Act Mode's green success theme
 */
const PlanCompletionOutputRow = memo(({ text, onCopy }: PlanCompletionOutputProps) => {
	const [isExpanded, setIsExpanded] = useState(true) // Auto-expand by default

	const { lineCount, shouldAutoShow } = useMemo(() => {
		const lineCount = text?.split("\n")?.length || 0
		const shouldAutoShow = lineCount <= 5
		return { lineCount, shouldAutoShow }
	}, [text])

	return (
		<div
			className="bg border rounded-sm overflow-visible border-[rgba(var(--vscode-editorGroup-border-rgb, 128, 128, 128), 0.5)] hover:border-[rgba(var(--vscode-descriptionForeground-rgb, 128, 128, 128), 0.5)]"
			style={{
				transition: "border-color 0.2s ease",
			}}>
			{/* Header */}
			<div
				className="flex items-center justify-between px-3 py-2 bg-code border-b border-border rounded-tl-md rounded-tr-md"
				style={{
					borderBottom: "1px solid rgba(var(--vscode-editorGroup-border-rgb, 128, 128, 128), 0.5)",
					borderTopLeftRadius: "6px",
					borderTopRightRadius: "6px",
					borderBottomLeftRadius: 0,
					borderBottomRightRadius: 0,
				}}>
				<div className="flex items-center gap-2 flex-1 min-w-0">
					<div className="w-2 h-2 rounded-full bg-description shrink-0" />
					<span className="text-foreground font-medium text-sm shrink-0">Plan Complete</span>
				</div>
				<CopyButton textToCopy={text || ""} />
			</div>

			{/* Content */}
			<div
				className={cn("w-full relative overflow-visible bg-code pb-0", {
					"pb-2": lineCount > 5,
				})}
				style={{
					borderTop: "1px solid rgba(255,255,255,.5)",
					borderBottomLeftRadius: "6px",
					borderBottomRightRadius: "6px",
				}}>
				<div
					className={cn("plan-completion-content scroll-smooth px-3 pt-4 pb-3 overflow-y-auto", {
						"overflow-y-visible": shouldAutoShow,
						"max-h-[400px]": isExpanded && !shouldAutoShow,
						"max-h-[150px]": !isExpanded && !shouldAutoShow,
					})}>
					<div className="wrap-anywhere -mb-4 -mt-4 overflow-hidden">
						<style>
							{`
								.plan-completion-content hr {
									opacity: 0.2;
								}
							`}
						</style>
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
