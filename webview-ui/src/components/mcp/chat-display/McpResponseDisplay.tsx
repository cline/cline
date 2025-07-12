import React, { useEffect, useState, useCallback } from "react"
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react" // Import ProgressRing
import { useExtensionState } from "../../../context/ExtensionStateContext"
import LinkPreview from "./LinkPreview"
import ImagePreview from "./ImagePreview"
import styled from "styled-components"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import ChatErrorBoundary from "@/components/chat/ChatErrorBoundary"
import { UrlMatch, processResponseUrls, DisplaySegment, buildDisplaySegments } from "./utils/mcpRichUtil"

// Maximum number of URLs to process in total, per response
export const MAX_URLS = 50

const ResponseHeader = styled.div`
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 9px 10px;
	color: var(--vscode-descriptionForeground);
	cursor: pointer;
	user-select: none;
	border-bottom: 1px dashed var(--vscode-editorGroup-border);
	margin-bottom: 8px;

	.header-title {
		display: flex;
		align-items: center;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		margin-right: 8px;
	}

	.header-icon {
		margin-right: 6px;
	}
`

const ToggleSwitch = styled.div`
	display: flex;
	align-items: center;
	font-size: 12px;
	color: var(--vscode-descriptionForeground);

	.toggle-label {
		margin-right: 8px;
	}

	.toggle-container {
		position: relative;
		width: 40px;
		height: 20px;
		background-color: var(--vscode-button-secondaryBackground);
		border-radius: 10px;
		cursor: pointer;
		transition: background-color 0.3s;
	}

	.toggle-container.active {
		background-color: var(--vscode-button-background);
	}

	.toggle-handle {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 16px;
		height: 16px;
		background-color: var(--vscode-button-foreground);
		border-radius: 50%;
		transition: transform 0.3s;
	}

	.toggle-container.active .toggle-handle {
		transform: translateX(20px);
	}
`

const ResponseContainer = styled.div`
	position: relative;
	font-family: var(--vscode-editor-font-family, monospace);
	font-size: var(--vscode-editor-font-size, 12px);
	background-color: ${CODE_BLOCK_BG_COLOR};
	color: var(--vscode-editor-foreground, #d4d4d4);
	border-radius: 3px;
	border: 1px solid var(--vscode-editorGroup-border);
	overflow: hidden;

	.response-content {
		overflow-x: auto;
		overflow-y: hidden;
		max-width: 100%;
		padding: 10px;
	}
`

// Style for URL text to ensure proper wrapping
const UrlText = styled.div`
	white-space: pre-wrap;
	word-break: break-all;
	overflow-wrap: break-word;
	font-family: var(--vscode-editor-font-family, monospace);
	font-size: var(--vscode-editor-font-size, 12px);
`

interface McpResponseDisplayProps {
	responseText: string
}

const McpResponseDisplay: React.FC<McpResponseDisplayProps> = ({ responseText }) => {
	const { mcpResponsesCollapsed, mcpRichDisplayEnabled } = useExtensionState() // Get setting from context
	const [isExpanded, setIsExpanded] = useState(!mcpResponsesCollapsed) // Initialize with context setting
	const [isLoading, setIsLoading] = useState(false) // Initial loading state for rich content
	const [displayMode, setDisplayMode] = useState<"rich" | "plain">(mcpRichDisplayEnabled ? "rich" : "plain")

	const [urlMatches, setUrlMatches] = useState<UrlMatch[]>([])
	const [error, setError] = useState<string | null>(null)

	const toggleDisplayMode = useCallback(() => {
		setDisplayMode((prevMode) => (prevMode === "rich" ? "plain" : "rich"))
	}, [])

	const toggleExpand = useCallback(() => {
		setIsExpanded((prev) => !prev)
	}, [])

	// Effect to update isExpanded if mcpResponsesCollapsed changes from context
	useEffect(() => {
		setIsExpanded(!mcpResponsesCollapsed)
	}, [mcpResponsesCollapsed])

	// Find all URLs in the text and determine if they're images
	useEffect(() => {
		// Skip all processing if in plain mode
		if (!isExpanded || displayMode === "plain") {
			setIsLoading(false)
			if (urlMatches.length > 0) {
				setUrlMatches([]) // Clear any existing matches when in plain mode
			}
			return
		}

		console.log("Processing MCP response for URL extraction")
		setIsLoading(true)
		setError(null)

		// Use the orchestrator function from mcpRichUtil
		const cleanup = processResponseUrls(
			responseText || "",
			MAX_URLS,
			(matches) => {
				setUrlMatches(matches)
				setIsLoading(false)
			},
			(updatedMatches) => {
				setUrlMatches(updatedMatches)
			},
			(errorMessage) => {
				setError(errorMessage)
				setIsLoading(false)
			},
		)

		return cleanup
	}, [responseText, displayMode, isExpanded])

	// Helper function to render a display segment
	const renderSegment = (segment: DisplaySegment): JSX.Element => {
		switch (segment.type) {
			case "text":
			case "url":
				return <UrlText key={segment.key}>{segment.content}</UrlText>

			case "image":
				return (
					<div key={segment.key}>
						<ImagePreview url={segment.url!} />
					</div>
				)

			case "link":
				return (
					<div key={segment.key} style={{ margin: "10px 0" }}>
						<LinkPreview url={segment.url!} />
					</div>
				)

			case "error":
				return (
					<div
						key={segment.key}
						style={{
							margin: "10px 0",
							padding: "8px",
							color: "var(--vscode-errorForeground)",
							border: "1px solid var(--vscode-editorError-foreground)",
							borderRadius: "4px",
							height: "128px",
							overflow: "auto",
						}}>
						{segment.content}
					</div>
				)

			default:
				return <React.Fragment key={segment.key} />
		}
	}

	// Function to render content based on display mode
	const renderContent = () => {
		if (!isExpanded) {
			return null
		}

		if (isLoading && displayMode === "rich") {
			return (
				<div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "50px" }}>
					<VSCodeProgressRing />
				</div>
			)
		}

		if (displayMode === "plain") {
			return <UrlText>{responseText}</UrlText>
		}

		if (error) {
			return (
				<>
					<div style={{ color: "var(--vscode-errorForeground)", marginBottom: "10px" }}>{error}</div>
					<UrlText>{responseText}</UrlText>
				</>
			)
		}

		if (displayMode === "rich") {
			const segments = buildDisplaySegments(responseText, urlMatches)
			return <>{segments.map(renderSegment)}</>
		}

		return null
	}

	try {
		return (
			<ResponseContainer>
				<ResponseHeader
					onClick={toggleExpand}
					style={{
						borderBottom: isExpanded ? "1px dashed var(--vscode-editorGroup-border)" : "none",
						marginBottom: isExpanded ? "8px" : "0px",
					}}>
					<div className="header-title">
						<span className={`codicon codicon-chevron-${isExpanded ? "down" : "right"} header-icon`}></span>
						Response
					</div>
					<div style={{ minWidth: isExpanded ? "auto" : "0", visibility: isExpanded ? "visible" : "hidden" }}>
						<ToggleSwitch onClick={(e) => e.stopPropagation()}>
							<span className="toggle-label">{displayMode === "rich" ? "Rich Display" : "Plain Text"}</span>
							<div
								className={`toggle-container ${displayMode === "rich" ? "active" : ""}`}
								onClick={toggleDisplayMode}>
								<div className="toggle-handle"></div>
							</div>
						</ToggleSwitch>
					</div>
				</ResponseHeader>

				{isExpanded && <div className="response-content">{renderContent()}</div>}
			</ResponseContainer>
		)
	} catch (error) {
		console.log("Error rendering MCP response - falling back to plain text") // Restored comment
		// Fallback for critical rendering errors
		return (
			<ResponseContainer>
				<ResponseHeader onClick={toggleExpand}>
					<div className="header-title">
						<span className={`codicon codicon-chevron-${isExpanded ? "down" : "right"} header-icon`}></span>
						Response (Error)
					</div>
				</ResponseHeader>
				{isExpanded && (
					<div className="response-content">
						<div style={{ color: "var(--vscode-errorForeground)" }}>Error parsing response:</div>
						<UrlText>{responseText}</UrlText>
					</div>
				)}
			</ResponseContainer>
		)
	}
}

// Wrap the entire McpResponseDisplay component with an error boundary
const McpResponseDisplayWithErrorBoundary: React.FC<McpResponseDisplayProps> = (props) => {
	return (
		<ChatErrorBoundary>
			<McpResponseDisplay {...props} />
		</ChatErrorBoundary>
	)
}

export default McpResponseDisplayWithErrorBoundary
