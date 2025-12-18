import { memo, useState } from "react"
import { CHAT_ROW_EXPANDED_BG_COLOR } from "@/components/common/CodeBlock"
import { CopyButton } from "@/components/common/CopyButton"
import MarkdownBlock from "@/components/common/MarkdownBlock"
import ExpandHandle from "./ExpandHandle"

const neutralColor = "var(--vscode-descriptionForeground)"

interface PlanCompletionOutputProps {
	text: string
	onCopy?: () => void
}

/**
 * Styled completion output for Plan Mode responses
 * Uses grayscale colors to distinguish from Act Mode's green success theme
 */
const PlanCompletionOutput = memo(({ text, onCopy }: PlanCompletionOutputProps) => {
	const [isExpanded, setIsExpanded] = useState(true) // Auto-expand by default
	const [isHovered, setIsHovered] = useState(false)

	const outputLines = text.split("\n")
	const lineCount = outputLines.length
	const shouldAutoShow = lineCount <= 5

	return (
		<div
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
			style={{
				borderRadius: 6,
				border: `1px solid ${isHovered ? "rgba(var(--vscode-descriptionForeground-rgb, 128, 128, 128), 0.5)" : "rgba(var(--vscode-editorGroup-border-rgb, 128, 128, 128), 0.5)"}`,
				overflow: "visible",
				backgroundColor: CHAT_ROW_EXPANDED_BG_COLOR,
				transition: "border-color 0.2s ease",
			}}>
			{/* Header */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					padding: "8px 10px",
					backgroundColor: CHAT_ROW_EXPANDED_BG_COLOR,
					borderBottom: "1px solid rgba(var(--vscode-editorGroup-border-rgb, 128, 128, 128), 0.5)",
					borderTopLeftRadius: "6px",
					borderTopRightRadius: "6px",
					borderBottomLeftRadius: 0,
					borderBottomRightRadius: 0,
				}}>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "8px",
						flex: 1,
						minWidth: 0,
					}}>
					<div
						style={{
							width: "8px",
							height: "8px",
							borderRadius: "50%",
							backgroundColor: neutralColor,
							flexShrink: 0,
						}}
					/>
					<span
						style={{
							color: "var(--vscode-foreground)",
							fontWeight: 500,
							fontSize: "13px",
							flexShrink: 0,
						}}>
						Plan Complete
					</span>
				</div>
				<CopyButton textToCopy={text || ""} />
			</div>

			{/* Content */}
			<div
				style={{
					width: "100%",
					position: "relative",
					paddingBottom: lineCount > 5 ? "8px" : "0",
					overflow: "visible",
					borderTop: "1px solid rgba(255,255,255,.5)",
					borderBottomLeftRadius: "6px",
					borderBottomRightRadius: "6px",
					backgroundColor: CHAT_ROW_EXPANDED_BG_COLOR,
				}}>
				<div
					className="plan-completion-content"
					style={{
						maxHeight: shouldAutoShow ? "none" : isExpanded ? "400px" : "150px",
						overflowY: shouldAutoShow ? "visible" : "auto",
						scrollBehavior: "smooth",
						padding: "16px 12px 12px 12px",
					}}>
					<div
						style={{
							wordBreak: "break-word",
							overflowWrap: "anywhere",
							marginBottom: -15,
							marginTop: -15,
							overflow: "hidden",
						}}>
						<MarkdownBlock markdown={text} />
					</div>
				</div>
				{/* Expand/collapse notch - only show if there's more than 5 lines */}
				{lineCount > 5 && (
					<ExpandHandle
						backgroundColor={neutralColor}
						isExpanded={isExpanded}
						onToggle={() => setIsExpanded(!isExpanded)}
					/>
				)}
			</div>
		</div>
	)
})

export default PlanCompletionOutput
