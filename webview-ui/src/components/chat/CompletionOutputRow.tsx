import { memo } from "react"
import { cn } from "@/lib/utils"
import { MarkdownRow } from "./MarkdownRow"
import "./CompletionOutputRow.css"
import ExpandHandle from "./ExpandHandle"

export const CompletionOutputRow = memo(
	({ text, isOutputFullyExpanded, onToggle }: { text: string; isOutputFullyExpanded: boolean; onToggle: () => void }) => {
		const outputLines = text.split("\n")
		const lineCount = outputLines.length
		const shouldAutoShow = lineCount <= 5

		return (
			<div
				className={cn("bg-code w-full relative pb-0 overflow-visible rounded-b-sm ", {
					"pb-2": lineCount > 5,
				})}>
				<div
					className={cn("completion-output-content scroll-smooth p-3")}
					style={{
						maxHeight: shouldAutoShow ? "none" : isOutputFullyExpanded ? "400px" : "150px",
						overflowY: shouldAutoShow ? "visible" : "auto",
					}}>
					<MarkdownRow markdown={text} />
				</div>
				{/* Show notch only if there's more than 5 lines */}
				{lineCount > 5 ? (
					<ExpandHandle className="bg-success" isExpanded={isOutputFullyExpanded} onToggle={onToggle} />
				) : null}
			</div>
		)
	},
)

CompletionOutputRow.displayName = "CompletionOutputRow"
