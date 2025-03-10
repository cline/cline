import React, { useEffect, useState, useCallback } from "react"
import { vscode } from "../../utils/vscode"
import LinkPreview from "./LinkPreview"
import styled from "styled-components"
import { CODE_BLOCK_BG_COLOR } from "../common/CodeBlock"
import DOMPurify from "dompurify"
import {
	isImageUrlSync,
	isUrl,
	safeCreateUrl,
	getSafeHostname,
	formatUrlForOpening,
	checkIfImageUrl,
	extractUrlsFromText,
	findUrls,
	MAX_URLS,
	processBatch
} from "./UrlProcessingService"

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
	fullMatch: string // The full matched text (including any prefix like "image:")
	index: number // Position in the text
	isImage: boolean // Whether this URL is an image
	isProcessed: boolean // Whether we've already processed this URL (to avoid duplicates)
}

// Error boundary component to prevent crashes from URL processing
class ErrorBoundary extends React.Component<
	{ children: React.ReactNode },
	{ hasError: boolean; error: Error | null }
> {
	constructor(props: { children: React.ReactNode }) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error) {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		console.log("Error in component:", error.message);
	}

	render() {
		if (this.state.hasError) {
			return (
				<div style={{ padding: "10px", color: "var(--vscode-errorForeground)" }}>
					<h3>Something went wrong displaying this content</h3>
					<p>Error: {this.state.error?.message || "Unknown error"}</p>
					<p>Please switch to plain text mode to view the content safely.</p>
				</div>
			);
		}

		return this.props.children;
	}
}

const McpResponseDisplay: React.FC<McpResponseDisplayProps> = ({ responseText }) => {
	const [isLoading, setIsLoading] = useState(true)
	const [displayMode, setDisplayMode] = useState<"rich" | "plain">(() => {
		// Get saved preference from localStorage, default to 'rich'
		const savedMode = localStorage.getItem("mcpDisplayMode")
		return savedMode === "plain" ? "plain" : "rich"
	})
	const [urlMatches, setUrlMatches] = useState<UrlMatch[]>([])
	const [error, setError] = useState<string | null>(null)

	const toggleDisplayMode = useCallback(() => {
		const newMode = displayMode === "rich" ? "plain" : "rich"
		setDisplayMode(newMode)
		localStorage.setItem("mcpDisplayMode", newMode)
	}, [displayMode])

	// Find all URLs in the text and determine if they're images
	useEffect(() => {
		const processResponse = async () => {
			console.log("Processing MCP response for URL extraction");
			setIsLoading(true)
			setError(null)

			try {
				const text = responseText || ""
				const matches: UrlMatch[] = []

				// More robust URL regex that handles common URL formats
				const urlRegex = /https?:\/\/[^\s<>"']+/g
				let urlMatch: RegExpExecArray | null
				
				let urlCount = 0;

				while ((urlMatch = urlRegex.exec(text)) !== null && urlCount < MAX_URLS) {
					const url = urlMatch[0]
					
					// Skip invalid URLs
					if (!isUrl(url)) {
						console.log("Skipping invalid URL:", url);
						continue;
					}
					
					// Skip localhost URLs to prevent security issues
					if (url.includes('localhost') || url.includes('127.0.0.1') || url.includes('0.0.0.0')) {
						console.log("Skipping localhost URL:", url);
						continue;
					}

					matches.push({
						url,
						fullMatch: url,
						index: urlMatch.index,
						isImage: false, // Will check later
						isProcessed: false,
					})
					
					urlCount++;
				}

				console.log(`Found ${matches.length} URLs in text, checking if they are images`);

				// First set the matches with default values so UI can start rendering
				setUrlMatches(matches);
				
				// Then process in smaller batches with progressive updates
				const batchSize = 4; // Process 4 at a time to avoid overwhelming the system
				
				for (let i = 0; i < matches.length; i += batchSize) {
					const batchMatches = matches.slice(i, i + batchSize);
					console.log(`Processing URL batch ${Math.floor(i/batchSize) + 1} of ${Math.ceil(matches.length/batchSize)}`);
					
					// Create promises for each URL in this batch
					const checkPromises = batchMatches.map(match => {
						return checkIfImageUrl(match.url)
							.then(isImage => {
								// Update the match in place
								match.isImage = isImage;
								return match;
							})
							.catch(err => {
								console.log(`URL check skipped: ${match.url}`);
								return match; // Return the match unchanged on error
							});
					});
					
					// Process this batch with individual timeouts
					const processedBatch = await processBatch(checkPromises, batchSize, 3000);
					
					// Update state after each batch to show progress
					setUrlMatches(prevMatches => {
						// Create a new array to trigger re-render
						const newMatches = [...prevMatches];
						return newMatches;
					});
					
					// Small delay between batches to allow UI to update
					if (i + batchSize < matches.length) {
						await new Promise(resolve => setTimeout(resolve, 50));
					}
				}

				// Final sort by position in the text
				setUrlMatches(prevMatches => {
					const sortedMatches = [...prevMatches].sort((a, b) => a.index - b.index);
					console.log(`URL processing complete. Found ${sortedMatches.filter(m => m.isImage).length} image URLs`);
					return sortedMatches;
				});
			} catch (error) {
				console.log("Error processing MCP response - switching to plain text mode");
				setError("Failed to process response content. Switch to plain text mode to view safely.")
			} finally {
				setIsLoading(false)
			}
		}

		processResponse()
	}, [responseText])

	// Function to render content based on display mode
	const renderContent = () => {
		// For plain text mode, just show the text
		if (displayMode === "plain" || isLoading) {
			return <UrlText>{responseText}</UrlText>
		}

		// Show error message if there was an error
		if (error) {
			return (
				<>
					<div style={{ color: "var(--vscode-errorForeground)", marginBottom: "10px" }}>
						{error}
					</div>
					<UrlText>{responseText}</UrlText>
				</>
			);
		}

		// For rich display mode, show the text with embedded content
		if (!isLoading) { // We already know displayMode is "rich" if we get here
			// Create an array of text segments and embedded content
			const segments: JSX.Element[] = []
			let lastIndex = 0
			let segmentIndex = 0

			// Track embed count for logging
			let embedCount = 0;

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

					// Add embedded content after the URL - always show embed for every URL instance
					if (match.isImage) {
						segments.push(
							<div key={`embed-${segmentIndex++}`} style={{ margin: "10px 0" }}>
								<ErrorBoundary>
									<img
										src={DOMPurify.sanitize(url)}
										alt={`Image for ${url}`}
										style={{
											width: "85%",
											height: "auto",
											borderRadius: "4px",
											cursor: "pointer",
										}}
										onClick={() => {
											try {
												const formattedUrl = formatUrlForOpening(url)
												vscode.postMessage({
													type: "openInBrowser",
													url: DOMPurify.sanitize(formattedUrl),
												})
											} catch (e) {
												console.log("Error opening URL");
											}
										}}
										onError={(e) => {
											console.log(`Image could not be loaded: ${url}`);
											// Show error message instead of hiding
											const imgElement = e.target as HTMLImageElement;
											const parent = imgElement.parentElement;
											if (parent) {
												const errorMsg = document.createElement('div');
												errorMsg.textContent = `Failed to load image: ${url}`;
												errorMsg.style.color = 'var(--vscode-errorForeground)';
												errorMsg.style.padding = '8px';
												errorMsg.style.border = '1px solid var(--vscode-editorError-foreground)';
												errorMsg.style.borderRadius = '4px';
												errorMsg.style.marginTop = '8px';
												parent.appendChild(errorMsg);
												imgElement.style.display = 'none';
											}
										}}
									/>
								</ErrorBoundary>
							</div>,
						)
						embedCount++;
						console.log(`Added image embed for ${url}, embed count: ${embedCount}`);
					} else {
						// For non-image URLs, always show the preview
						try {
							// Skip localhost URLs
							if (!url.includes('localhost') && !url.includes('127.0.0.1') && !url.includes('0.0.0.0')) {
								segments.push(
									<div key={`embed-${segmentIndex++}`} style={{ margin: "10px 0" }}>
										<ErrorBoundary>
											<LinkPreview url={formatUrlForOpening(url)} />
										</ErrorBoundary>
									</div>,
								)
								
								embedCount++;
								console.log(`Added link preview for ${url}, embed count: ${embedCount}`);
							}
						} catch (e) {
							console.log("Link preview could not be created");
							// Show error message for failed link preview
							segments.push(
								<div 
									key={`embed-error-${segmentIndex++}`} 
									style={{ 
										margin: "10px 0",
										padding: "8px",
										color: "var(--vscode-errorForeground)",
										border: "1px solid var(--vscode-editorError-foreground)",
										borderRadius: "4px"
									}}
								>
									Failed to create preview for: {url}
								</div>
							);
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
				<ResponseHeader>
					<span className="header-title">Response</span>
					<ToggleSwitch>
						<span className="toggle-label">{displayMode === "rich" ? "Rich Display" : "Plain Text"}</span>
						<div className={`toggle-container ${displayMode === "rich" ? "active" : ""}`} onClick={toggleDisplayMode}>
							<div className="toggle-handle"></div>
						</div>
					</ToggleSwitch>
				</ResponseHeader>

				<div className="response-content">{renderContent()}</div>
			</ResponseContainer>
		)
	} catch (error) {
		console.log("Error rendering MCP response - falling back to plain text");
		return (
			<ResponseContainer>
				<ResponseHeader>
					<span className="header-title">Response</span>
				</ResponseHeader>
				<div className="response-content">
					<div>Error parsing response:</div>
					<UrlText>{responseText}</UrlText>
				</div>
			</ResponseContainer>
		)
	}
}

// Wrap the entire McpResponseDisplay component with an error boundary
const McpResponseDisplayWithErrorBoundary: React.FC<McpResponseDisplayProps> = (props) => {
	return (
		<ErrorBoundary>
			<McpResponseDisplay {...props} />
		</ErrorBoundary>
	);
};

export default McpResponseDisplayWithErrorBoundary;
