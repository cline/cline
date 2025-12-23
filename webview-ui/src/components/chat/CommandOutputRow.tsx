import { StringRequest } from "@shared/proto/cline/common"
import { memo, useEffect, useRef } from "react"
import { FileServiceClient } from "@/services/grpc-client"
import CodeBlock, { TERMINAL_CODE_BLOCK_BG_COLOR } from "../common/CodeBlock"

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

		// Check if output contains a log file path indicator
		const logFilePathMatch = output.match(/📋 Output is being logged to: ([^\n]+)/)
		const logFilePath = logFilePathMatch ? logFilePathMatch[1].trim() : null

		// Render output with clickable log file path
		const renderOutput = () => {
			if (!logFilePath) {
				return <CodeBlock forceWrap={true} source={`${"```"}shell\n${output}\n${"```"}`} />
			}

			// Split output into parts: before log path, log path line, after log path
			const logPathLineStart = output.indexOf("📋 Output is being logged to:")
			const logPathLineEnd = output.indexOf("\n", logPathLineStart)
			const beforeLogPath = output.substring(0, logPathLineStart)
			const afterLogPath = logPathLineEnd !== -1 ? output.substring(logPathLineEnd) : ""

			// Extract just the filename from the full path for display
			const fileName = logFilePath.split("/").pop() || logFilePath

			return (
				<>
					{beforeLogPath && <CodeBlock forceWrap={true} source={`${"```"}shell\n${beforeLogPath}\n${"```"}`} />}
					<div
						className="flex flex-wrap items-center gap-1.5 px-3 py-2 mx-2 my-1.5 rounded bg-banner-background cursor-pointer hover:brightness-110 transition-colors"
						onClick={() => {
							FileServiceClient.openFile(StringRequest.create({ value: logFilePath })).catch((err) =>
								console.error("Failed to open log file:", err),
							)
						}}
						title={`Click to open: ${logFilePath}`}>
						<span className="shrink-0">📋 Output is being logged to:</span>
						<span className="text-vscode-textLink-foreground underline break-all">{fileName}</span>
					</div>
					{afterLogPath && <CodeBlock forceWrap={true} source={`${"```"}shell\n${afterLogPath}\n${"```"}`} />}
				</>
			)
		}

		return (
			<div
				style={{
					width: "100%",
					position: "relative",
					paddingBottom: lineCount > 5 ? "16px" : "0",
					overflow: "visible",
					borderTop: "1px solid rgba(255,255,255,.07)",
					backgroundColor: TERMINAL_CODE_BLOCK_BG_COLOR,
					borderBottomLeftRadius: "6px",
					borderBottomRightRadius: "6px",
				}}>
				<div
					ref={outputRef}
					style={{
						color: "#FFFFFF",
						maxHeight: shouldAutoShow ? "none" : isOutputFullyExpanded ? "200px" : "75px",
						overflowY: shouldAutoShow ? "visible" : "auto",
						scrollBehavior: "smooth",
						backgroundColor: TERMINAL_CODE_BLOCK_BG_COLOR,
					}}>
					<div style={{ backgroundColor: TERMINAL_CODE_BLOCK_BG_COLOR }}>{renderOutput()}</div>
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
