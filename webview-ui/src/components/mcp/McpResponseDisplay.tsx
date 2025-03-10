import React, { useEffect, useState, useCallback } from "react"
import { vscode } from "../../utils/vscode"
import LinkPreview from "./LinkPreview"
import styled from "styled-components"
import { CODE_BLOCK_BG_COLOR } from "../common/CodeBlock"
import DOMPurify from "dompurify"

// We'll use the backend isImageUrl function for HEAD requests
// This is a client-side fallback for data URLs and obvious image extensions
const isImageUrlSync = (str: string): boolean => {
	// Check for data URLs which are definitely images
	if (str.startsWith("data:image/")) {
		return true
	}

	// Check for common image file extensions
	return str.match(/\.(jpg|jpeg|png|gif|webp)$/i) !== null
}

export const isUrl = (str: string): boolean => {
	try {
		// Try to construct a URL object - this is the most reliable way to validate
		new URL(str);
		return true;
	} catch (e) {
		// If the URL doesn't have a protocol, try adding https://
		if (!str.startsWith('http://') && !str.startsWith('https://')) {
			try {
				new URL(`https://${str}`);
				return true;
			} catch (e) {
				return false;
			}
		}
		return false;
	}
}

// Safely create a URL object with error handling
export const safeCreateUrl = (url: string): URL | null => {
	try {
		return new URL(url);
	} catch (e) {
		// If the URL doesn't have a protocol, try adding https://
		if (!url.startsWith('http://') && !url.startsWith('https://')) {
			try {
				return new URL(`https://${url}`);
			} catch (e) {
				console.log(`Invalid URL: ${url}`);
				return null;
			}
		}
		console.log(`Invalid URL: ${url}`);
		return null;
	}
}

// Get hostname safely
export const getSafeHostname = (url: string): string => {
	try {
		const urlObj = safeCreateUrl(url);
		return urlObj ? urlObj.hostname : new URL('https://example.com').hostname;
	} catch (e) {
		return 'unknown-host';
	}
}

// Function to check if a URL is an image using HEAD request
export const checkIfImageUrl = async (url: string): Promise<boolean> => {
	// For data URLs, we can check synchronously
	if (url.startsWith("data:image/")) {
		return true
	}

	// Validate URL before proceeding
	if (!isUrl(url)) {
		console.log("Invalid URL format:", url);
		return false;
	}

	// For http/https URLs, we need to send a message to the extension
	if (url.startsWith("http")) {
		try {
			// Create a promise that will resolve when we get a response
			return new Promise((resolve) => {
				// Set up a one-time listener for the response
				const messageListener = (event: MessageEvent) => {
					const message = event.data
					if (message.type === "isImageUrlResult" && message.url === url) {
						window.removeEventListener("message", messageListener)
						resolve(message.isImage)
					}
				}

				window.addEventListener("message", messageListener)

				// Send the request to the extension
				vscode.postMessage({
					type: "checkIsImageUrl",
					text: url,
				})

				// Set a timeout to avoid hanging indefinitely
				setTimeout(() => {
					window.removeEventListener("message", messageListener)
					// Fall back to extension check
					resolve(isImageUrlSync(url))
				}, 3000)
			})
		} catch (error) {
			console.log("Error checking if URL is an image:", url);
			return isImageUrlSync(url)
		}
	}

	// Fall back to extension check for other URLs
	return isImageUrlSync(url)
}

// Helper to ensure URL is in a format that can be opened
export const formatUrlForOpening = (url: string): string => {
	// If it's a data URI, return as is
	if (url.startsWith("data:image/")) {
		return url
	}

	// Validate URL
	try {
		// If it's a regular URL but doesn't have a protocol, add https://
		if (!url.startsWith("http://") && !url.startsWith("https://")) {
			// Validate with https:// prefix
			new URL(`https://${url}`);
			return `https://${url}`
		}
		
		// Validate as-is
		new URL(url);
		return url;
	} catch (e) {
		console.log(`Invalid URL format: ${url}`);
		// Return a safe fallback that won't crash
		return "about:blank";
	}
}

// Find all URLs (both image and regular) in an object
export const findUrls = async (obj: any): Promise<{ imageUrls: string[]; regularUrls: string[] }> => {
	const imageUrls: string[] = []
	const regularUrls: string[] = []
	const pendingChecks: Promise<void>[] = []
	
	// Limit the number of URLs to process to prevent performance issues
	const MAX_URLS = 100;
	let urlCount = 0;

	if (typeof obj === "object" && obj !== null) {
		for (const value of Object.values(obj)) {
			// Stop processing if we've reached the limit
			if (urlCount >= MAX_URLS) break;
			
			if (typeof value === "string") {
				// First check with synchronous method
				if (isImageUrlSync(value)) {
					imageUrls.push(value)
					urlCount++;
				} else if (isUrl(value)) {
					// For URLs that don't obviously look like images, we'll check asynchronously
					const checkPromise = checkIfImageUrl(value).then((isImage) => {
						if (isImage) {
							imageUrls.push(value)
						} else {
							regularUrls.push(value)
						}
					}).catch(err => {
						console.log(`URL check skipped: ${value}`);
					});
					pendingChecks.push(checkPromise)
					urlCount++;
				}
			} else if (typeof value === "object") {
				const nestedUrlsPromise = findUrls(value).then((nestedUrls) => {
					// Respect the URL limit for nested objects too
					const remainingSlots = MAX_URLS - urlCount;
					if (remainingSlots > 0) {
						const imageUrlsToAdd = nestedUrls.imageUrls.slice(0, remainingSlots);
						imageUrls.push(...imageUrlsToAdd);
						
						const newCount = urlCount + imageUrlsToAdd.length;
						const regularUrlsToAdd = nestedUrls.regularUrls.slice(0, MAX_URLS - newCount);
						regularUrls.push(...regularUrlsToAdd);
						
						urlCount = newCount + regularUrlsToAdd.length;
					}
				}).catch(err => {
					console.log("Some nested URLs could not be processed");
				});
				pendingChecks.push(nestedUrlsPromise)
			}
		}
	}

	// Process URLs in batches of 4 at a time to limit parallel connections
	try {
		// Process in batches of 4
		for (let i = 0; i < pendingChecks.length; i += 4) {
			const batch = pendingChecks.slice(i, i + 4);
			await Promise.race([
				Promise.all(batch),
				new Promise(resolve => setTimeout(resolve, 5000)) // 5 second timeout per batch
			]);
		}
	} catch (error) {
		console.log("Some URLs could not be processed within the timeout period");
	}

	return { imageUrls, regularUrls }
}

// Extract URLs from text using regex
export const extractUrlsFromText = async (text: string): Promise<{ imageUrls: string[]; regularUrls: string[] }> => {
	const imageUrls: string[] = []
	const regularUrls: string[] = []
	const pendingChecks: Promise<void>[] = []
	
	// Limit the number of URLs to process
	const MAX_URLS = 100;
	let urlCount = 0;

	// Match URLs with image: prefix and extract just the URL part
	const imageMatches = text.match(/image:\s*(https?:\/\/[^\s]+)/g)
	if (imageMatches) {
		// Extract just the URL part from matches with image: prefix
		const extractedUrls = imageMatches
			.map((match) => {
				const urlMatch = /image:\s*(https?:\/\/[^\s]+)/.exec(match)
				return urlMatch ? urlMatch[1] : null
			})
			.filter(Boolean) as string[]

		// Respect URL limit
		const urlsToAdd = extractedUrls.slice(0, MAX_URLS);
		imageUrls.push(...urlsToAdd)
		urlCount += urlsToAdd.length;
	}

	// Match all URLs (including those that might be in the middle of paragraphs)
	const urlMatches = text.match(/https?:\/\/[^\s]+/g)
	if (urlMatches && urlCount < MAX_URLS) {
		// Filter out URLs that are already in imageUrls
		const filteredUrls = urlMatches
			.filter((url) => !imageUrls.includes(url))
			// Limit the number of URLs to process
			.slice(0, MAX_URLS - urlCount);

		// Check each URL to see if it's an image
		for (const url of filteredUrls) {
			// Validate URL before processing
			if (!isUrl(url)) {
				console.log("Skipping invalid URL:", url);
				continue;
			}
			
			// First check with synchronous method
			if (isImageUrlSync(url)) {
				imageUrls.push(url)
			} else {
				// For URLs that don't obviously look like images, we'll check asynchronously
				const checkPromise = checkIfImageUrl(url)
					.then((isImage) => {
						if (isImage) {
							imageUrls.push(url)
						} else {
							regularUrls.push(url)
						}
					})
					.catch(err => {
						console.log(`URL check skipped: ${url}`);
					});
				pendingChecks.push(checkPromise)
			}
			urlCount++;
		}
	}

	// Process URLs in batches of 4 at a time to limit parallel connections
	try {
		// Process in batches of 4
		for (let i = 0; i < pendingChecks.length; i += 4) {
			const batch = pendingChecks.slice(i, i + 4);
			await Promise.race([
				Promise.all(batch),
				new Promise(resolve => setTimeout(resolve, 5000)) // 5 second timeout per batch
			]);
		}
	} catch (error) {
		console.log("Some URLs could not be processed within the timeout period");
	}

	return { imageUrls, regularUrls }
}

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
			setIsLoading(true)
			setError(null)

			try {
				const text = responseText || ""
				const matches: UrlMatch[] = []

				// More robust URL regex that handles common URL formats
				const urlRegex = /https?:\/\/[^\s<>"']+/g
				let urlMatch: RegExpExecArray | null
				
				// Limit the number of URLs to process
				const MAX_URLS = 100;
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

				// Check if URLs are images with a timeout
				const checkPromises = matches.map(match => {
					return Promise.race([
						checkIfImageUrl(match.url)
							.then(isImage => {
								match.isImage = isImage;
								return match;
							})
							.catch(err => {
								console.log(`URL check skipped: ${match.url}`);
								return match; // Return the match unchanged on error
							}),
						// Timeout after 3 seconds
						new Promise<typeof match>(resolve => {
							setTimeout(() => resolve(match), 3000);
						})
					]);
				});

				// Process URL checks in batches of 4 at a time
				for (let i = 0; i < checkPromises.length; i += 4) {
					const batch = checkPromises.slice(i, i + 4);
					await Promise.race([
						Promise.all(batch),
						new Promise(resolve => setTimeout(resolve, 5000)) // 5 second timeout per batch
					]);
				}

				// Sort by position in the text
				matches.sort((a, b) => a.index - b.index)

				setUrlMatches(matches)
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

			// Reset the processed flag for all URLs
			const processedUrls = new Set<string>()
			
			// Limit the number of embedded previews to prevent performance issues
			const MAX_EMBEDS = 5;
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

					// Add embedded content after the URL (with limits)
					if (embedCount < MAX_EMBEDS) {
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
												// Hide the broken image
												(e.target as HTMLImageElement).style.display = 'none';
											}}
										/>
									</ErrorBoundary>
								</div>,
							)
							embedCount++;
						} else if (!processedUrls.has(url)) {
							// For non-image URLs, only show the preview once
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
									
									// Mark this URL as processed
									processedUrls.add(url)
									embedCount++;
								}
							} catch (e) {
								console.log("Link preview could not be created");
							}
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

export default McpResponseDisplay
