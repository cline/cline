import React, { useEffect, useState, useCallback, useRef } from "react"
import LinkPreview from "./LinkPreview"
import ImagePreview from "./ImagePreview"
import styled from "styled-components"
import { CODE_BLOCK_BG_COLOR } from "../common/CodeBlock"
import {
	isUrl,
	formatUrlForOpening,
	checkIfImageUrl,
	MAX_URLS,
	isLocalhostUrl
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
				<div style={{ 
					padding: "10px", 
					color: "var(--vscode-errorForeground)",
					height: "128px", // Fixed height
					overflow: "auto" // Allow scrolling if content overflows
				}}>
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
	// Reference to track if processing should be canceled
	const processingCancelRef = useRef(false)

	const toggleDisplayMode = useCallback(() => {
		const newMode = displayMode === "rich" ? "plain" : "rich"
		setDisplayMode(newMode)
		localStorage.setItem("mcpDisplayMode", newMode)
		
		// If switching to plain mode, cancel any ongoing processing
		if (newMode === "plain") {
			console.log("Switching to plain mode - canceling URL processing");
			processingCancelRef.current = true;
			setUrlMatches([]); // Clear any existing matches when switching to plain mode
		} else {
			// If switching to rich mode, the useEffect will re-run and fetch data
			// because displayMode is a dependency of the useEffect
			console.log("Switching to rich mode - will start URL processing");
			// No need to do anything else here as the useEffect will handle it
		}
	}, [displayMode])

	// Find all URLs in the text and determine if they're images
	useEffect(() => {
		// Reset cancel flag when effect runs
		processingCancelRef.current = false;
		
		// Skip all processing if in plain mode
		if (displayMode === "plain") {
			setIsLoading(false);
			setUrlMatches([]); // Clear any existing matches when in plain mode
			return;
		}
		
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

				// First pass: Extract all URLs and immediately make them available for rendering
				while ((urlMatch = urlRegex.exec(text)) !== null && urlCount < MAX_URLS) {
					let url = urlMatch[0]
					
					// Convert HTTP to HTTPS for security
					if (url.startsWith('http://')) {
						url = url.replace('http://', 'https://');
						console.log(`Converted HTTP URL to HTTPS in response: ${url}`);
					}
					
					// Skip invalid URLs
					if (!isUrl(url)) {
						console.log("Skipping invalid URL:", url);
						continue;
					}
					
					// Skip localhost URLs to prevent security issues
					if (isLocalhostUrl(url)) {
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

				console.log(`Found ${matches.length} URLs in text, will check if they are images`);

				// Set matches immediately so UI can start rendering with loading states
				setUrlMatches(matches.sort((a, b) => a.index - b.index));
				
				// Mark loading as complete to show content immediately
				setIsLoading(false)
				
				// Process image checks in the background - one at a time to avoid network flooding
				const processImageChecks = async () => {
					console.log(`Starting sequential URL processing for ${matches.length} URLs`);
					
					// Quick check for common image extensions first - IMMEDIATE PROCESSING
					for (let i = 0; i < matches.length; i++) {
						const match = matches[i];
						const url = match.url.toLowerCase();
						
						// Check for common image extensions - expanded list
						if (url.endsWith('.jpg') || url.endsWith('.jpeg') || 
							url.endsWith('.png') || url.endsWith('.gif') || 
							url.endsWith('.webp') || url.endsWith('.svg') ||
							url.endsWith('.bmp') || url.endsWith('.tiff') || 
							url.endsWith('.tif') || url.endsWith('.avif') ||
							// Also check for image URLs with query parameters
							url.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff|tif|avif)(\?|#).+$/i) !== null) {
							
							// For URLs that look like images, we'll still verify with the ImagePreview component
							// which will do a content type check
							match.isImage = true;
							match.isProcessed = true;
							console.log(`Detected potential image by extension: ${match.url}`);
						}
					}
					
					// Update state with extension-based detection results
					setUrlMatches([...matches]);
					
					// Process remaining URLs one at a time to avoid flooding the network
					for (let i = 0; i < matches.length; i++) {
						// Skip already processed URLs (from extension check)
						if (matches[i].isProcessed) continue;
						
						// Check if processing has been canceled (switched to plain mode)
						if (processingCancelRef.current) {
							console.log("URL processing canceled - display mode changed to plain");
							return;
						}
						
						const match = matches[i];
						console.log(`Processing URL ${i + 1} of ${matches.length}: ${match.url}`);
						
						try {
							// Process each URL individually
							const isImage = await checkIfImageUrl(match.url);
							
							// Skip if processing has been canceled
							if (processingCancelRef.current) return;
							
							// Update the match in place
							match.isImage = isImage;
							match.isProcessed = true;
							
							// Update state after each URL to show progress
							// Create a new array to ensure React detects the state change
							setUrlMatches([...matches]);
							
						} catch (err) {
							console.log(`URL check error: ${match.url}`, err);
							match.isProcessed = true;
							
							// Update state even on error
							if (!processingCancelRef.current) {
								setUrlMatches([...matches]);
							}
						}
						
						// Delay between URL processing to avoid overwhelming the network
						if (!processingCancelRef.current && i < matches.length - 1) {
							// Much longer delay between URLs to avoid network flooding
							// This gives each URL more time to complete before starting the next one
							await new Promise(resolve => setTimeout(resolve, 100));
						}
					}
					
					console.log(`URL processing complete. Found ${matches.filter(m => m.isImage).length} image URLs`);
				};
				
				// Start the background processing
				processImageChecks();
				
			} catch (error) {
				console.log("Error processing MCP response - switching to plain text mode");
				setError("Failed to process response content. Switch to plain text mode to view safely.")
				setIsLoading(false)
			}
		}

		processResponse()
		
		// Cleanup function to cancel processing if component unmounts or dependencies change
		return () => {
			processingCancelRef.current = true;
			console.log("Cleaning up URL processing");
		};
	}, [responseText, displayMode]) // Added displayMode as a dependency

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

					// Add embedded content after the URL
					// For images, use the ImagePreview component
					if (match.isImage) {
						segments.push(
							<div key={`embed-image-${url}-${segmentIndex++}`}>
								<ImagePreview url={url} />
							</div>
						)
						embedCount++;
						// console.log(`Added image embed for ${url}, embed count: ${embedCount}`);
					} else if (match.isProcessed) {
						// For non-image URLs or URLs we haven't processed yet, show link preview
						try {
							// Skip localhost URLs
							if (!isLocalhostUrl(url)) {
								// Use a unique key that includes the URL to ensure each preview is isolated
								segments.push(
									<div key={`embed-${url}-${segmentIndex++}`} style={{ margin: "10px 0" }}>
										<ErrorBoundary>
											<LinkPreview url={formatUrlForOpening(url)} />
										</ErrorBoundary>
									</div>,
								)
								
								embedCount++;
								// console.log(`Added link preview for ${url}, embed count: ${embedCount}`);
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
										borderRadius: "4px",
										height: "128px", // Fixed height
										overflow: "auto" // Allow scrolling if content overflows
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
