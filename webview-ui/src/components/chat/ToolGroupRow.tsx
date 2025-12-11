import { ClineMessage, ClineSayTool } from "@shared/ExtensionMessage"
import deepEqual from "fast-deep-equal"
import { memo, useEffect, useMemo, useRef, useState } from "react"
import { useSize } from "react-use"
import styled from "styled-components"
import { CheckmarkControl } from "@/components/common/CheckmarkControl"
import { cleanPathPrefix } from "@/components/common/CodeAccordian"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient } from "@/services/grpc-client"
import { findApiReqInfoForCheckpoint } from "./chat-view/utils/messageUtils"

interface ToolGroupRowProps {
	messages: ClineMessage[] // includes tool messages and checkpoint messages
	isLast: boolean
	isFinalized: boolean // true when followed by non-low-stakes content (show collapsed)
	onHeightChange: (isTaller: boolean) => void
}

const Container = styled.div`
	padding: 8px 15px;
	position: relative;
`

const SummaryRow = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	font-size: 13px;
	color: var(--vscode-descriptionForeground);
	cursor: pointer;
	user-select: none;
	padding: 2px 0;

	&:hover {
		color: var(--vscode-foreground);
	}

	.chevron {
		opacity: 0.6;
		font-size: 12px;
		transition: opacity 0.15s ease;
	}

	&:hover .chevron {
		opacity: 1;
	}
`

const FileList = styled.div<{ $isAnimating?: boolean; $isIndented?: boolean }>`
	overflow: hidden;
	margin-left: ${(props) => (props.$isIndented ? "12px" : "0")};
	transition: ${(props) => (props.$isAnimating ? "max-height 0.2s ease-out, opacity 0.2s ease-out" : "none")};
`

const FileItem = styled.div`
	font-size: 12px;
	color: var(--vscode-descriptionForeground);
	padding: 3px 0;
	cursor: pointer;
	transition: color 0.1s ease;
	font-family: var(--vscode-editor-font-family);

	&:hover {
		color: var(--vscode-textLink-foreground);
	}

	/* Fade-in animation for streaming items */
	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	&.new-item {
		animation: fadeIn 0.15s ease-out;
	}
`

const InlineItem = styled.span`
	font-size: 12px;
	color: var(--vscode-descriptionForeground);
	cursor: pointer;
	transition: color 0.1s ease;

	&:hover {
		color: var(--vscode-textLink-foreground);
	}

	code {
		font-family: var(--vscode-editor-font-family);
	}
`

interface ToolInfo {
	tool: string
	path?: string
	regex?: string
	originalPath?: string // Keep original for opening
}

/**
 * Smart path truncation - keeps filename and parent directory visible
 */
function truncatePath(path: string, maxLength: number = 50): string {
	if (path.length <= maxLength) {
		return path
	}
	const parts = path.split("/")
	if (parts.length <= 2) {
		return path
	}

	const filename = parts[parts.length - 1]
	const parent = parts[parts.length - 2]
	const suffix = `${parent}/${filename}`

	if (suffix.length >= maxLength - 3) {
		return `.../${filename}`
	}

	return `.../${suffix}`
}

const ToolGroupRow = memo(({ messages, isLast, isFinalized, onHeightChange }: ToolGroupRowProps) => {
	const { clineMessages } = useExtensionState()
	const [isExpanded, setIsExpanded] = useState(false)
	const [isAnimating, setIsAnimating] = useState(false)
	const prevHeightRef = useRef(0)
	const prevCountRef = useRef(0)

	// Separate tool messages from checkpoint messages
	const { toolMessages, checkpointMessage } = useMemo(() => {
		const tools: ClineMessage[] = []
		let checkpoint: ClineMessage | undefined

		messages.forEach((msg) => {
			if (msg.say === "checkpoint_created") {
				checkpoint = msg
			} else if (msg.say === "tool" || msg.ask === "tool") {
				tools.push(msg)
			}
		})

		return { toolMessages: tools, checkpointMessage: checkpoint }
	}, [messages])

	// Parse tool info from tool messages
	const toolInfos = useMemo(() => {
		return toolMessages.map((msg) => {
			try {
				const tool = JSON.parse(msg.text || "{}") as ClineSayTool
				const originalPath = tool.path || ""
				return {
					tool: tool.tool,
					path: cleanPathPrefix(originalPath),
					regex: tool.regex,
					originalPath,
				} as ToolInfo
			} catch {
				return { tool: "unknown" } as ToolInfo
			}
		})
	}, [toolMessages])

	// Track new items for animation
	const newItemCount = toolInfos.length - prevCountRef.current
	useEffect(() => {
		prevCountRef.current = toolInfos.length
	}, [toolInfos.length])

	// Get display text for a single tool
	const getDisplayText = (info: ToolInfo): string => {
		const path = info.path || ""
		if (info.tool === "searchFiles" && info.regex) {
			return `Searched "${info.regex}" in ${truncatePath(path) || "."}`
		}
		if (info.tool === "listFilesTopLevel" || info.tool === "listFilesRecursive") {
			return `Listed ${truncatePath(path) || "."}`
		}
		if (info.tool === "listCodeDefinitionNames") {
			return `Listed definitions in ${truncatePath(path) || "."}`
		}
		// readFile
		return truncatePath(path)
	}

	// Generate summary for collapsed view
	const summaryText = useMemo(() => {
		const counts: Record<string, number> = {}
		toolInfos.forEach((info) => {
			counts[info.tool] = (counts[info.tool] || 0) + 1
		})

		const parts: string[] = []
		if (counts.readFile) {
			parts.push(`Read ${counts.readFile} file${counts.readFile > 1 ? "s" : ""}`)
		}
		if (counts.listFilesTopLevel || counts.listFilesRecursive) {
			const count = (counts.listFilesTopLevel || 0) + (counts.listFilesRecursive || 0)
			parts.push(`Listed ${count} dir${count > 1 ? "s" : ""}`)
		}
		if (counts.searchFiles) {
			parts.push(`${counts.searchFiles} search${counts.searchFiles > 1 ? "es" : ""}`)
		}
		if (counts.listCodeDefinitionNames) {
			parts.push(`${counts.listCodeDefinitionNames} definition list${counts.listCodeDefinitionNames > 1 ? "s" : ""}`)
		}

		return parts.join(", ")
	}, [toolInfos])

	// Get API req info for checkpoint
	const apiReqInfo = useMemo(() => {
		if (!checkpointMessage) {
			return undefined
		}
		return findApiReqInfoForCheckpoint(checkpointMessage.ts, clineMessages)
	}, [checkpointMessage, clineMessages])

	// Handle file click to open in editor
	const handleFileClick = (info: ToolInfo) => {
		if (info.originalPath) {
			FileServiceClient.openFileRelativePath({ value: info.originalPath }).catch((err) =>
				console.error("Failed to open file:", err),
			)
		}
	}

	// Handle expand/collapse with animation
	const handleToggle = () => {
		setIsAnimating(true)
		setIsExpanded(!isExpanded)
		setTimeout(() => setIsAnimating(false), 200)
	}

	const [content, { height }] = useSize(
		<Container>
			{/* Single item: inline clickable display */}
			{toolInfos.length === 1 && (
				<InlineItem onClick={() => handleFileClick(toolInfos[0])}>
					{toolInfos[0].tool === "readFile" ? "Read " : ""}
					<code>{getDisplayText(toolInfos[0])}</code>
				</InlineItem>
			)}

			{/* Multiple items */}
			{toolInfos.length > 1 && (
				<>
					{/* When finalized (high-stakes tool follows): show collapsible summary */}
					{isFinalized && (
						<SummaryRow onClick={handleToggle}>
							<span>{summaryText}</span>
							<span className={`codicon codicon-chevron-${isExpanded ? "up" : "down"} chevron`} />
						</SummaryRow>
					)}

					{/* Show file list when expanded OR still streaming (not finalized) */}
					{(isExpanded || !isFinalized) && (
						<FileList $isAnimating={isAnimating} $isIndented={isFinalized}>
							{toolInfos.map((info, idx) => (
								<FileItem
									className={!isFinalized && idx >= toolInfos.length - newItemCount ? "new-item" : ""}
									key={toolMessages[idx].ts}
									onClick={() => handleFileClick(info)}>
									{getDisplayText(info)}
								</FileItem>
							))}
						</FileList>
					)}
				</>
			)}

			{/* Checkpoint: only show when finalized (high-stakes tool follows) */}
			{isFinalized && checkpointMessage && (
				<div style={{ marginTop: toolInfos.length > 0 ? 8 : 0 }}>
					<CheckmarkControl
						apiReqInfo={apiReqInfo}
						isCheckpointCheckedOut={checkpointMessage.isCheckpointCheckedOut}
						messageTs={checkpointMessage.ts}
					/>
				</div>
			)}
		</Container>,
	)

	// Height change effect
	useEffect(() => {
		const isInitialRender = prevHeightRef.current === 0
		if (isLast && height !== 0 && height !== Infinity && height !== prevHeightRef.current) {
			if (!isInitialRender) {
				onHeightChange(height > prevHeightRef.current)
			}
			prevHeightRef.current = height
		}
	}, [height, isLast, onHeightChange])

	return content
}, deepEqual)

export default ToolGroupRow
