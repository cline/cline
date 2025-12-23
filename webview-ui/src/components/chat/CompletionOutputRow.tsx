import { memo } from "react"
import { cn } from "@/lib/utils"
import { MarkdownRow } from "./MarkdownRow"
import "./CompletionOutputRow.css"
import { TriangleIcon } from "lucide-react"

export const CompletionOutputRow = memo(
	({ text, isOutputFullyExpanded, onToggle }: { text: string; isOutputFullyExpanded: boolean; onToggle: () => void }) => {
		const outputLines = text.split("\n")
		const lineCount = outputLines.length
		const shouldAutoShow = lineCount <= 5

		return (
			<div
				className={cn("bg-code w-full relative pb-0 overflow-visible", {
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
				{lineCount > 5 && (
					<div
						className="bg-success absolute -bottom-2 left-1/2 transform -translate-x-1/2 p-1 cursor-pointer rounded-xs border-0 flex justify-center items-center px-[14px] py-[1px]"
						onClick={onToggle}>
						<TriangleIcon className={cn("fill-black", isOutputFullyExpanded ? "rotate-0" : "rotate-180")} size={11} />
					</div>
				)}
			</div>
		)
	},
)

CompletionOutputRow.displayName = "CompletionOutputRow"
