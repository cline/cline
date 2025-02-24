import React, { useEffect, useState, useCallback } from "react"
import { vscode } from "../../utils/vscode"
import LinkPreview from "./LinkPreview"
import styled from "styled-components"

// We'll use the backend isImageUrl function for HEAD requests
// This is a client-side fallback for data URLs and obvious image extensions
const isImageUrlSync = (str: string): boolean => {
	// Check for data URLs which are definitely images
	if (str.startsWith('data:image/')) {
		return true
	}
	
	// Check for common image file extensions
	return str.match(/\.(jpg|jpeg|png|gif|webp)$/i) !== null
}

export const isUrl = (str: string): boolean => {
	// Basic URL validation
	const urlPattern = /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/[^\s]*)?$/
	return urlPattern.test(str)
}

// Function to check if a URL is an image using HEAD request
export const checkIfImageUrl = async (url: string): Promise<boolean> => {
	// For data URLs, we can check synchronously
	if (url.startsWith('data:image/')) {
		return true
	}
	
	// For http/https URLs, we need to send a message to the extension
	if (url.startsWith('http')) {
		try {
			// Create a promise that will resolve when we get a response
			return new Promise((resolve) => {
				// Set up a one-time listener for the response
				const messageListener = (event: MessageEvent) => {
					const message = event.data
					if (message.type === "isImageUrlResult" && message.url === url) {
						window.removeEventListener('message', messageListener)
						resolve(message.isImage)
					}
				}
				
				window.addEventListener('message', messageListener)
				
				// Send the request to the extension
				vscode.postMessage({
					type: "checkIsImageUrl",
					text: url
				})
				
				// Set a timeout to avoid hanging indefinitely
				setTimeout(() => {
					window.removeEventListener('message', messageListener)
					// Fall back to extension check
					resolve(isImageUrlSync(url))
				}, 3000)
			})
		} catch (error) {
			console.error("Error checking if URL is an image:", error)
			return isImageUrlSync(url)
		}
	}
	
	// Fall back to extension check for other URLs
	return isImageUrlSync(url)
}

// No longer needed as our regex directly extracts the URL part

// Helper to ensure URL is in a format that can be opened
export const formatUrlForOpening = (url: string): string => {
	// If it's a data URI, return as is
	if (url.startsWith('data:image/')) {
		return url
	}
	
	// If it's a regular URL but doesn't have a protocol, add https://
	if (!url.startsWith('http://') && !url.startsWith('https://')) {
		return `https://${url}`
	}
	
	return url
}

// Find all URLs (both image and regular) in an object
export const findUrls = async (obj: any): Promise<{ imageUrls: string[], regularUrls: string[] }> => {
	const imageUrls: string[] = []
	const regularUrls: string[] = []
	const pendingChecks: Promise<void>[] = []
	
	if (typeof obj === 'object' && obj !== null) {
		for (const value of Object.values(obj)) {
			if (typeof value === 'string') {
				// First check with synchronous method
				if (isImageUrlSync(value)) {
					imageUrls.push(value)
				} else if (isUrl(value)) {
					// For URLs that don't obviously look like images, we'll check asynchronously
					const checkPromise = checkIfImageUrl(value).then(isImage => {
						if (isImage) {
							imageUrls.push(value)
						} else {
							regularUrls.push(value)
						}
					})
					pendingChecks.push(checkPromise)
				}
			} else if (typeof value === 'object') {
				const nestedUrlsPromise = findUrls(value).then(nestedUrls => {
					imageUrls.push(...nestedUrls.imageUrls)
					regularUrls.push(...nestedUrls.regularUrls)
				})
				pendingChecks.push(nestedUrlsPromise)
			}
		}
	}
	
	// Wait for all async checks to complete
	await Promise.all(pendingChecks)
	
	return { imageUrls, regularUrls }
}

// Extract URLs from text using regex
export const extractUrlsFromText = async (text: string): Promise<{ imageUrls: string[], regularUrls: string[] }> => {
	const imageUrls: string[] = []
	const regularUrls: string[] = []
	const pendingChecks: Promise<void>[] = []
	
	// Match URLs with image: prefix and extract just the URL part
	const imageMatches = text.match(/image:\s*(https?:\/\/[^\s]+)/g)
	if (imageMatches) {
		// Extract just the URL part from matches with image: prefix
		const extractedUrls = imageMatches.map(match => {
			const urlMatch = /image:\s*(https?:\/\/[^\s]+)/.exec(match)
			return urlMatch ? urlMatch[1] : null
		}).filter(Boolean) as string[]
		
		imageUrls.push(...extractedUrls)
	}
	
	// Match all URLs (including those that might be in the middle of paragraphs)
	const urlMatches = text.match(/https?:\/\/[^\s]+/g)
	if (urlMatches) {
		// Filter out URLs that are already in imageUrls
		const filteredUrls = urlMatches.filter(url => !imageUrls.includes(url))
		
		// Check each URL to see if it's an image
		for (const url of filteredUrls) {
			// First check with synchronous method
			if (isImageUrlSync(url)) {
				imageUrls.push(url)
			} else {
				// For URLs that don't obviously look like images, we'll check asynchronously
				const checkPromise = checkIfImageUrl(url).then(isImage => {
					if (isImage) {
						imageUrls.push(url)
					} else {
						regularUrls.push(url)
					}
				})
				pendingChecks.push(checkPromise)
			}
		}
	}
	
	// Wait for all async checks to complete
	await Promise.all(pendingChecks)
	
	return { imageUrls, regularUrls }
}

const ToggleSwitch = styled.div`
	position: absolute;
	top: 0;
	right: 0;
	display: flex;
	align-items: center;
	font-size: 12px;
	color: var(--vscode-descriptionForeground);
	margin-bottom: 10px;
	
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
	padding-top: 24px;
	font-family: var(--vscode-editor-font-family, monospace);
	font-size: var(--vscode-editor-font-size, 12px);
	background-color: var(--vscode-textCodeBlock-background, #1e1e1e);
	color: var(--vscode-editor-foreground, #d4d4d4);
	border-radius: 3px;
	padding: 10px;
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
	url: string;            // The actual URL
	fullMatch: string;      // The full matched text (including any prefix like "image:")
	index: number;          // Position in the text
	isImage: boolean;       // Whether this URL is an image
	isProcessed: boolean;   // Whether we've already processed this URL (to avoid duplicates)
}

const McpResponseDisplay: React.FC<McpResponseDisplayProps> = ({ responseText }) => {
	const [isLoading, setIsLoading] = useState(true)
	const [displayMode, setDisplayMode] = useState<'rich' | 'plain'>(() => {
		// Get saved preference from localStorage, default to 'rich'
		const savedMode = localStorage.getItem('mcpDisplayMode')
		return (savedMode === 'plain' ? 'plain' : 'rich') as 'rich' | 'plain'
	})
	const [urlMatches, setUrlMatches] = useState<UrlMatch[]>([])
	
	const toggleDisplayMode = useCallback(() => {
		const newMode = displayMode === 'rich' ? 'plain' : 'rich'
		setDisplayMode(newMode)
		localStorage.setItem('mcpDisplayMode', newMode)
	}, [displayMode])
	
	// Find all URLs in the text and determine if they're images
	useEffect(() => {
		const processResponse = async () => {
			setIsLoading(true)
			
			try {
				const text = responseText || ""
				const matches: UrlMatch[] = []
				
				// Find all URLs in the text
				const urlRegex = /https?:\/\/[^\s]+/g
				let urlMatch: RegExpExecArray | null
				
				while ((urlMatch = urlRegex.exec(text)) !== null) {
					const url = urlMatch[0]
					const fullMatch = url
					
					matches.push({
						url,
						fullMatch,
						index: urlMatch.index,
						isImage: false,  // Will check later
						isProcessed: false
					})
				}
				
				// Check if URLs are images
				for (const match of matches) {
					match.isImage = await checkIfImageUrl(match.url)
				}
				
				// Sort by position in the text
				matches.sort((a, b) => a.index - b.index)
				
				setUrlMatches(matches)
			} catch (error) {
				console.error('Error processing MCP response:', error)
			} finally {
				setIsLoading(false)
			}
		}
		
		processResponse()
	}, [responseText])
	
	// Function to render content based on display mode
	const renderContent = () => {
		if (isLoading) {
			return <div>Analyzing response content...</div>
		}
		
		// For plain text mode, just show the text
		if (displayMode === 'plain') {
			return <UrlText>{responseText}</UrlText>
		}
		
		// For rich display mode, show the text with embedded content
		if (displayMode === 'rich') {
			// Create an array of text segments and embedded content
			const segments: JSX.Element[] = []
			let lastIndex = 0
			let segmentIndex = 0
			
			// Reset the processed flag for all URLs
			const processedUrls = new Set<string>()
			
			// Add the text before the first URL
			if (urlMatches.length === 0) {
				segments.push(
					<UrlText key={`segment-${segmentIndex}`}>
						{responseText}
					</UrlText>
				)
			} else {
				for (let i = 0; i < urlMatches.length; i++) {
					const match = urlMatches[i]
					const { url, fullMatch, index } = match
					
					// Add text segment before this URL
					if (index > lastIndex) {
						segments.push(
							<UrlText key={`segment-${segmentIndex++}`}>
								{responseText.substring(lastIndex, index)}
							</UrlText>
						)
					}
					
					// Add the URL text itself
					segments.push(
						<UrlText key={`url-${segmentIndex++}`}>
							{fullMatch}
						</UrlText>
					)
					
					// Calculate the end position of this URL in the text
					const urlEndIndex = index + fullMatch.length
					
					// Add embedded content after the URL
					if (match.isImage) {
						segments.push(
							<div key={`embed-${segmentIndex++}`} style={{ margin: '10px 0' }}>
								<img 
									src={url}
									alt={`Image for ${url}`}
									style={{
										width: "100%",
										height: "auto",
										borderRadius: "4px",
										cursor: "pointer"
									}}
									onClick={() => {
										const formattedUrl = formatUrlForOpening(url)
										vscode.postMessage({ 
											type: "openInBrowser", 
											url: formattedUrl 
										})
									}}
								/>
							</div>
						)
					} else if (!processedUrls.has(url)) {
						// For non-image URLs, only show the preview once
						segments.push(
							<div key={`embed-${segmentIndex++}`} style={{ margin: '10px 0' }}>
								<LinkPreview url={formatUrlForOpening(url)} />
							</div>
						)
						
						// Mark this URL as processed
						processedUrls.add(url)
					}
					
					// Update lastIndex for next segment
					lastIndex = urlEndIndex
				}
				
				// Add any remaining text after the last URL
				if (lastIndex < responseText.length) {
					segments.push(
						<UrlText key={`segment-${segmentIndex++}`}>
							{responseText.substring(lastIndex)}
						</UrlText>
					)
				}
			}
			
			return <>{segments}</>
		}
		
		return null
	}
	
	try {
		return (
			<ResponseContainer>
				<ToggleSwitch>
					<span className="toggle-label">
						{displayMode === 'rich' ? 'Rich Display' : 'Plain Text'}
					</span>
					<div 
						className={`toggle-container ${displayMode === 'rich' ? 'active' : ''}`}
						onClick={toggleDisplayMode}
					>
						<div className="toggle-handle"></div>
					</div>
				</ToggleSwitch>
				
				{renderContent()}
			</ResponseContainer>
		)
	} catch (error) {
		console.error('Error parsing MCP response:', error);
		return (
			<ResponseContainer>
				<div>Error parsing response:</div>
				<UrlText>
					{responseText}
				</UrlText>
			</ResponseContainer>
		)
	}
}

export default McpResponseDisplay
