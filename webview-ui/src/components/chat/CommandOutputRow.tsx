import { memo, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import CodeBlock from "../common/CodeBlock"

export const CommandOutputRow = memo(
	({
		output,
		isOutputFullyExpanded,
		onToggle,
		isContainerExpanded,
	}: {
		output: string
		isOutputFullyExpanded: boolean
		onToggle: () => void
		isContainerExpanded: boolean
	}) => {
		const outputLines = output.split("\n")
		const lineCount = outputLines.length
		const shouldAutoShow = lineCount <= 5
		const outputRef = useRef<HTMLDivElement>(null)

		// Auto-scroll to bottom when output changes (only when showing limited output)
		useEffect(() => {
			if (!isOutputFullyExpanded && outputRef.current) {
				// Direct scrollTop manipulation
				outputRef.current.scrollTop = outputRef.current.scrollHeight

				// Another attempt with more delay (for slower renders) to ensure scrolling works
				setTimeout(() => {
					if (outputRef.current) {
						outputRef.current.scrollTop = outputRef.current.scrollHeight
					}
				}, 50)
			}
		}, [output, isOutputFullyExpanded])

		// Don't render anything if container is collapsed
		if (!isContainerExpanded) {
			return null
		}

		return (
			<div
				className={cn("bg-code w-full relative overflow-visible border-t-1 rounded-b-md pb-0", {
					"pb-4": lineCount > 5,
				})}>
				<div
					className="bg-code"
					ref={outputRef}
					style={{
						color: "#FFFFFF",
						maxHeight: shouldAutoShow ? "none" : isOutputFullyExpanded ? "200px" : "75px",
						overflowY: shouldAutoShow ? "visible" : "auto",
						scrollBehavior: "smooth",
					}}>
					<div className="bg-code">
						<CodeBlock forceWrap={true} source={`${"```"}shell\n${output}\n${"```"}`} />
					</div>
				</div>
				{/* Show notch only if there's more than 5 lines */}
				{lineCount > 5 && (
					<div
						onClick={onToggle}
						onMouseEnter={(e) => {
							e.currentTarget.style.opacity = "0.8"
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.opacity = "1"
						}}
						style={{
							position: "absolute",
							bottom: "-10px",
							left: "50%",
							transform: "translateX(-50%)",
							display: "flex",
							justifyContent: "center",
							alignItems: "center",
							padding: "1px 14px",
							cursor: "pointer",
							backgroundColor: "var(--vscode-descriptionForeground)",
							borderRadius: "3px 3px 6px 6px",
							transition: "opacity 0.1s ease",
							border: "1px solid rgba(0, 0, 0, 0.1)",
						}}>
						<span
							className={`codicon codicon-triangle-${isOutputFullyExpanded ? "up" : "down"}`}
							style={{
								fontSize: "11px",
								color: "var(--vscode-editor-background)",
							}}
						/>
					</div>
				)}
			</div>
		)
	},
)
