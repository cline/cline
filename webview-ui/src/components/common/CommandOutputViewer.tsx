import { forwardRef, useEffect, useRef } from "react"
import { Virtuoso, VirtuosoHandle } from "react-virtuoso"
import { cn } from "@src/lib/utils"

interface CommandOutputViewerProps {
	output: string
}

const CommandOutputViewer = forwardRef<HTMLDivElement, CommandOutputViewerProps>(({ output }, ref) => {
	const virtuosoRef = useRef<VirtuosoHandle>(null)
	const lines = output.split("\n")

	useEffect(() => {
		// Scroll to the bottom when output changes
		if (virtuosoRef.current && typeof virtuosoRef.current.scrollToIndex === "function") {
			virtuosoRef.current.scrollToIndex({
				index: lines.length - 1,
				behavior: "auto",
			})
		}
	}, [output, lines.length])

	return (
		<div ref={ref} className="w-full rounded-b-md bg-[var(--vscode-editor-background)] h-[300px]">
			<Virtuoso
				ref={virtuosoRef}
				className="h-full"
				totalCount={lines.length}
				itemContent={(index) => (
					<div
						className={cn(
							"px-3 py-0.5",
							"font-mono text-vscode-editor-foreground",
							"text-[var(--vscode-editor-font-size,var(--vscode-font-size,12px))]",
							"font-[var(--vscode-editor-font-family)]",
							"whitespace-pre-wrap break-all anywhere",
						)}>
						{lines[index]}
					</div>
				)}
				increaseViewportBy={{ top: 300, bottom: 300 }}
				followOutput="auto"
			/>
		</div>
	)
})

CommandOutputViewer.displayName = "CommandOutputViewer"

export default CommandOutputViewer
