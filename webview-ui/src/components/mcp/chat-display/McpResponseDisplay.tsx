import React, { useEffect, useState, useCallback } from "react"
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react" // Import ProgressRing
import { useExtensionState } from "../../../context/ExtensionStateContext"
import LinkPreview from "./LinkPreview"
import ImagePreview from "./ImagePreview"
import styled from "styled-components"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import ChatErrorBoundary from "@/components/chat/ChatErrorBoundary"
import { isUrl, isLocalhostUrl, formatUrlForOpening, checkIfImageUrl } from "./utils/mcpRichUtil"

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

// Represents a URL found in the text with its position and metadata
interface UrlMatch {
	url: string // The actual URL
	fullMatch: string // The full matched text
	index: number // Position in the text
	isImage: boolean // Whether this URL is an image
	isProcessed: boolean // Whether we've already processed this URL (to avoid duplicates)
}

const McpResponseDisplay: React.FC<McpResponseDisplayProps> = ({ responseText }) => {
	const { mcpResponsesCollapsed } = useExtensionState() // Get setting from context
	const [isExpanded, setIsExpanded] = useState(!mcpResponsesCollapsed) // Initialize with context setting
	const [isLoading, setIsLoading] = useState(false) // Initial loading state for rich content
	const [displayMode, setDisplayMode] = useState<"rich" | "plain">(() => {
		// Get saved preference from localStorage, default to 'rich'
		const savedMode = localStorage.getItem("mcpDisplayMode")
		return savedMode === "plain" ? "plain" : "rich"
	})
	const [urlMatches, setUrlMatches] = useState<UrlMatch[]>([])
	const [error, setError] = useState<string | null>(null)
	// Add a counter state for forcing re-renders to make toggling run smoother
	const [forceUpdateCounter, setForceUpdateCounter] = useState(0)

	const toggleDisplayMode = useCallback(() => {
		const newMode = displayMode === "rich" ? "plain" : "rich"
		// Force an immediate re-render
		setForceUpdateCounter((prev) => prev + 1)
		// Update display mode and save preference
		setDisplayMode(newMode)
		localStorage.setItem("mcpDisplayMode", newMode)
		// If switching to plain mode, cancel any ongoing processing
		if (newMode === "plain") {
			console.log("Switching to plain mode - cancelling URL processing")
			setUrlMatches([]) // Clear any existing matches when switching to plain mode
		} else {
			// If switching to rich mode, the useEffect will re-run and fetch data
			console.log("Switching to rich mode - will start URL processing")
			setUrlMatches([])
		}
	}, [displayMode])

	const toggleExpand = useCallback(() => {
		setIsExpanded((prev) => !prev)
	}, [])

	// Effect to update isExpanded if mcpResponsesCollapsed changes from context
	useEffect(() => {
		setIsExpanded(!mcpResponsesCollapsed)
	}, [])

	// Find all URLs in the text and determine if they're images
	useEffect(() => {
		// Skip all processing if in plain mode
		if (!isExpanded || displayMode === "plain") {
			setIsLoading(false)
			setUrlMatches([]) // Clear any existing matches when in plain mode
			return
		}

		// Use a direct boolean for cancellation that's scoped to this effect run
		let processingCanceled = false
		const processResponse = async () => {
			console.log("Processing MCP response for URL extraction")
			setIsLoading(true)
			setError(null)
			try {
				const text = responseText || ""
				const matches: UrlMatch[] = []
				const urlRegex = /(?:https?:\/\/|data:image)[^\s<>"']+/g
				let urlMatch: RegExpExecArray | null
				let urlCount = 0

				// First pass: Extract all URLs and immediately make them available for rendering
				while ((urlMatch = urlRegex.exec(text)) !== null && urlCount < MAX_URLS) {
					// Get the original URL from the match - never modify the original URL text
					const url = urlMatch[0]

					// Skip invalid URLs
					if (!isUrl(url)) {
						console.log("Skipping invalid URL:", url)
						continue
					}

					// Skip localhost URLs to prevent security issues
					if (isLocalhostUrl(url)) {
						console.log("Skipping localhost URL:", url)
						continue
					}

					matches.push({
						url,
						fullMatch: url,
						index: urlMatch.index,
						isImage: false, // Will check later
						isProcessed: false,
					})

					urlCount++
				}

				console.log(`Found ${matches.length} URLs in text, will check if they are images`)

				// Set matches immediately so UI can start rendering with loading states
				setUrlMatches(matches.sort((a, b) => a.index - b.index))

				// Mark loading as complete to show content immediately
				setIsLoading(false)

				// Process image checks in the background - one at a time to avoid network flooding
				const processImageChecks = async () => {
					console.log(`Starting sequential URL processing for ${matches.length} URLs`)

					for (let i = 0; i < matches.length; i++) {
						// Skip already processed URLs (from extension check)
						if (matches[i].isProcessed) continue

						// Check if processing has been canceled (switched to plain mode)
						if (processingCanceled) {
							console.log("URL processing canceled - display mode changed to plain")
							return
						}

						const match = matches[i]
						console.log(`Processing URL ${i + 1} of ${matches.length}: ${match.url}`)

						try {
							// Process each URL individually
							const isImage = await checkIfImageUrl(match.url)

							// Skip if processing has been canceled
							if (processingCanceled) return

							// Update the match in place
							match.isImage = isImage
							match.isProcessed = true

							// Update state after each URL to show progress
							// Create a new array to ensure React detects the state change
							setUrlMatches([...matches])
						} catch (err) {
							console.log(`URL check error: ${match.url}`, err)
							match.isProcessed = true

							// Update state even on error
							if (!processingCanceled) {
								setUrlMatches([...matches])
							}
						}

						// Delay between URL processing to avoid overwhelming the network
						if (!processingCanceled && i < matches.length - 1) {
							await new Promise((resolve) => setTimeout(resolve, 100))
						}
					}

					console.log(`URL processing complete. Found ${matches.filter((m) => m.isImage).length} image URLs`)
				}

				// Start the background processing
				processImageChecks()
			} catch (error) {
				setError("Failed to process response content. Switch to plain text mode to view safely.")
				setIsLoading(false)
			}
		}

		processResponse()

		// Cleanup function to cancel processing if component unmounts or dependencies change
		return () => {
			processingCanceled = true
			console.log("Cleaning up URL processing")
		}
	}, [responseText, displayMode, forceUpdateCounter, isExpanded])

	// Function to render content based on display mode
	const renderContent = () => {
		if (!isExpanded) {
			return null // Don't render content if not expanded
		}

		if (isLoading && displayMode === "rich") {
			return (
				<div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "50px" }}>
					<VSCodeProgressRing />
				</div>
			)
		}

		// For plain text mode, just show the text
		if (displayMode === "plain") {
			return <UrlText>{responseText}</UrlText>
		}

		// Show error message if there was an error
		if (error) {
			return (
				<>
					<div style={{ color: "var(--vscode-errorForeground)", marginBottom: "10px" }}>{error}</div>
					<UrlText>{responseText}</UrlText>
				</>
			)
		}

		// For rich display mode, show the text with embedded content
		if (displayMode === "rich") {
			// We already know displayMode is "rich" if we get here
			// Create an array of text segments and embedded content
			const segments: JSX.Element[] = []
			let lastIndex = 0
			let segmentIndex = 0

			// Track embed count for logging
			let embedCount = 0

			// Add the text before the first URL
			if (urlMatches.length === 0) {
				segments.push(<UrlText key={`segment-${segmentIndex}`}>{responseText}</UrlText>)
			} else {
				for (let i = 0; i < urlMatches.length; i++) {
					const match = urlMatches[i]
					const { url, fullMatch, index } = match

					// Add text segment before this URL
					if (index > lastIndex) {
						segments.push(
							<UrlText key={`segment-${segmentIndex++}`}>{responseText.substring(lastIndex, index)}</UrlText>,
						)
					}

					// Add the URL text itself
					segments.push(<UrlText key={`url-${segmentIndex++}`}>{fullMatch}</UrlText>)

					// Calculate the end position of this URL in the text
					const urlEndIndex = index + fullMatch.length

					// Add embedded content after the URL
					// For images, use the ImagePreview component
					if (match.isImage) {
						segments.push(
							<div key={`embed-image-${url}-${segmentIndex++}`}>
								{/* Use formatUrlForOpening for network calls but preserve original URL in display */}
								<ImagePreview url={formatUrlForOpening(url)} />
							</div>,
						)
						embedCount++
						// console.log(`Added image embed for ${url}, embed count: ${embedCount}`);
					} else if (match.isProcessed) {
						// For non-image URLs or URLs we haven't processed yet, show link preview
						try {
							// Skip localhost URLs
							if (!isLocalhostUrl(url)) {
								// Use a unique key that includes the URL to ensure each preview is isolated
								segments.push(
									<div key={`embed-${url}-${segmentIndex++}`} style={{ margin: "10px 0" }}>
										{/* Already using formatUrlForOpening for link previews */}
										<LinkPreview url={formatUrlForOpening(url)} />
									</div>,
								)

								embedCount++
								// console.log(`Added link preview for ${url}, embed count: ${embedCount}`);
							}
						} catch (e) {
							console.log("Link preview could not be created")
							// Show error message for failed link preview
							segments.push(
								<div
									key={`embed-error-${segmentIndex++}`}
									style={{
										margin: "10px 0",
										padding: "8px",
										color: "var(--vscode-errorForeground)",
										border: "1px solid var(--vscode-editorError-foreground)",
										borderRadius: "4px",
										height: "128px", // Fixed height
										overflow: "auto", // Allow scrolling if content overflows
									}}>
									Failed to create preview for: {url}
								</div>,
							)
						}
					}

					// Update lastIndex for next segment
					lastIndex = urlEndIndex
				}

				// Add any remaining text after the last URL
				if (lastIndex < responseText.length) {
					segments.push(<UrlText key={`segment-${segmentIndex++}`}>{responseText.substring(lastIndex)}</UrlText>)
				}
			}

			return <>{segments}</>
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
