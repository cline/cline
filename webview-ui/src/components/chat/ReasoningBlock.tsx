import React, { useEffect, useRef } from "react"
import { CODE_BLOCK_BG_COLOR } from "../common/CodeBlock"
import MarkdownBlock from "../common/MarkdownBlock"

interface ReasoningBlockProps {
	content: string
	isCollapsed?: boolean
	onToggleCollapse?: () => void
	autoHeight?: boolean
}

const ReasoningBlock: React.FC<ReasoningBlockProps> = ({
	content,
	isCollapsed = false,
	onToggleCollapse,
	autoHeight = false,
}) => {
	const contentRef = useRef<HTMLDivElement>(null)

	// Scroll to bottom when content updates
	useEffect(() => {
		if (contentRef.current && !isCollapsed) {
			contentRef.current.scrollTop = contentRef.current.scrollHeight
		}
	}, [content, isCollapsed])

	return (
		<div
			style={{
				backgroundColor: CODE_BLOCK_BG_COLOR,
				border: "1px solid var(--vscode-editorGroup-border)",
				borderRadius: "3px",
				overflow: "hidden",
			}}>
			<div
				onClick={onToggleCollapse}
				style={{
					padding: "8px 12px",
					cursor: "pointer",
					userSelect: "none",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					borderBottom: isCollapsed ? "none" : "1px solid var(--vscode-editorGroup-border)",
				}}>
				<span style={{ fontWeight: "bold" }}>Reasoning</span>
				<span className={`codicon codicon-chevron-${isCollapsed ? "right" : "down"}`}></span>
			</div>
			{!isCollapsed && (
				<div
					ref={contentRef}
					style={{
						padding: "8px 12px",
						maxHeight: autoHeight ? "none" : "160px",
						overflowY: "auto",
					}}>
					<div
						style={{
							fontSize: "13px",
							opacity: 0.9,
						}}>
						<MarkdownBlock markdown={content} />
					</div>
				</div>
			)}
		</div>
	)
}

export default ReasoningBlock
