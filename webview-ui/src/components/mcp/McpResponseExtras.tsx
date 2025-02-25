import React, { useEffect, useState, useCallback } from "react"
import { vscode } from "../../utils/vscode"
import LinkPreview from "./LinkPreview"
import styled from "styled-components"

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
	// Basic URL validation
	const urlPattern = /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/[^\s]*)?$/
	return urlPattern.test(str)
}

// Function to check if a URL is an image using HEAD request
export const checkIfImageUrl = async (url: string): Promise<boolean> => {
	// For data URLs, we can check synchronously
	if (url.startsWith("data:image/")) {
		return true
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
			console.error("Error checking if URL is an image:", error)
			return isImageUrlSync(url)
		}
	}

	// Fall back to extension check for other URLs
	return isImageUrlSync(url)
}

export const cleanUrl = (str: string): string => {
	// Remove any prefixes like "image:" or "url:"
	return str.replace(/^(image|url):\s*/, "")
}

// Helper to ensure URL is in a format that can be opened
export const formatUrlForOpening = (url: string): string => {
	// If it's a data URI, return as is
	if (url.startsWith("data:image/")) {
		return url
	}

	// If it's a regular URL but doesn't have a protocol, add https://
	if (!url.startsWith("http://") && !url.startsWith("https://")) {
		return `https://${url}`
	}

	return url
}

// Find all URLs (both image and regular) in an object
export const findUrls = async (obj: any): Promise<{ imageUrls: string[]; regularUrls: string[] }> => {
	const imageUrls: string[] = []
	const regularUrls: string[] = []
	const pendingChecks: Promise<void>[] = []

	if (typeof obj === "object" && obj !== null) {
		for (const value of Object.values(obj)) {
			if (typeof value === "string") {
				const cleanedValue = cleanUrl(value)

				// First check with synchronous method
				if (isImageUrlSync(cleanedValue)) {
					imageUrls.push(cleanedValue)
				} else if (isUrl(cleanedValue)) {
					// For URLs that don't obviously look like images, we'll check asynchronously
					const checkPromise = checkIfImageUrl(cleanedValue).then((isImage) => {
						if (isImage) {
							imageUrls.push(cleanedValue)
						} else {
							regularUrls.push(cleanedValue)
						}
					})
					pendingChecks.push(checkPromise)
				}
			} else if (typeof value === "object") {
				const nestedUrlsPromise = findUrls(value).then((nestedUrls) => {
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
export const extractUrlsFromText = async (text: string): Promise<{ imageUrls: string[]; regularUrls: string[] }> => {
	const imageUrls: string[] = []
	const regularUrls: string[] = []
	const pendingChecks: Promise<void>[] = []

	// Match URLs with image: prefix and extract just the URL part
	const imageMatches = text.match(/image:\s*(https?:\/\/[^\s]+)/g)
	if (imageMatches) {
		const cleanedUrls = imageMatches.map((match) => match.replace(/^image:\s*/, ""))
		imageUrls.push(...cleanedUrls)
	}

	// Match all URLs (including those that might be in the middle of paragraphs)
	const urlMatches = text.match(/https?:\/\/[^\s]+/g)
	if (urlMatches) {
		// Filter out URLs that are already in imageUrls
		const filteredUrls = urlMatches.filter((url) => !imageUrls.includes(url))

		// Check each URL to see if it's an image
		for (const url of filteredUrls) {
			// First check with synchronous method
			if (isImageUrlSync(url)) {
				imageUrls.push(url)
			} else {
				// For URLs that don't obviously look like images, we'll check asynchronously
				const checkPromise = checkIfImageUrl(url).then((isImage) => {
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
`

// Style for URL text to ensure proper wrapping
const UrlText = styled.div`
	white-space: pre-wrap;
	word-break: break-all;
	overflow-wrap: break-word;
`

interface McpResponseExtrasProps {
	responseText: string
}

// Function to extract URLs and their positions in text
const extractUrlsWithPositions = (text: string): { url: string; index: number }[] => {
	// This regex matches both standalone URLs and URLs with image: prefix
	const urlRegex = /(?:image:\s*)?(https?:\/\/[^\s]+)/g
	const matches: { url: string; index: number }[] = []
	let match

	while ((match = urlRegex.exec(text)) !== null) {
		// Get the actual URL (group 1) and its position
		const url = match[1]
		// Calculate the actual index of the URL itself (not the prefix)
		const urlIndex = match.index + (match[0].length - url.length)

		matches.push({
			url: url,
			index: urlIndex,
		})
	}

	return matches
}

const McpResponseExtras: React.FC<McpResponseExtrasProps> = ({ responseText }) => {
	const [imageUrls, setImageUrls] = useState<string[]>([])
	const [regularUrls, setRegularUrls] = useState<string[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [displayMode, setDisplayMode] = useState<"rich" | "plain">(() => {
		// Get saved preference from localStorage, default to 'rich'
		const savedMode = localStorage.getItem("mcpDisplayMode")
		return (savedMode === "plain" ? "plain" : "rich") as "rich" | "plain"
	})
	const [urlPositions, setUrlPositions] = useState<{ [url: string]: number }>({})

	const toggleDisplayMode = useCallback(() => {
		const newMode = displayMode === "rich" ? "plain" : "rich"
		setDisplayMode(newMode)
		localStorage.setItem("mcpDisplayMode", newMode)
	}, [displayMode])

	useEffect(() => {
		const processResponse = async () => {
			setIsLoading(true)
			try {
				let foundImageUrls: string[] = []
				let foundRegularUrls: string[] = []
				const text = responseText || ""

				// Extract URL positions for inline display
				const extractedUrls = extractUrlsWithPositions(text)
				const positions: { [url: string]: number } = {}
				extractedUrls.forEach((item) => {
					positions[item.url] = item.index
				})
				setUrlPositions(positions)

				// First try parsing as JSON
				try {
					const jsonResponse = JSON.parse(text)
					const urls = await findUrls(jsonResponse)
					foundImageUrls = urls.imageUrls
					foundRegularUrls = urls.regularUrls
				} catch {
					// If not JSON, try parsing as formatted text
					const urls = await extractUrlsFromText(text)
					foundImageUrls = urls.imageUrls
					foundRegularUrls = urls.regularUrls
				}

				setImageUrls(foundImageUrls)
				setRegularUrls(foundRegularUrls)
			} catch (error) {
				console.error("Error processing MCP response:", error)
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

		const hasContent = imageUrls.length > 0 || regularUrls.length > 0

		if (!hasContent) {
			return <div>No links or images found in response</div>
		}

		// For plain text mode, just show the text
		if (displayMode === "plain") {
			return <UrlText>{responseText}</UrlText>
		}

		// For rich display mode, show the text with embedded content
		if (displayMode === "rich") {
			// Sort URLs by their position in the text
			const allUrls = [...imageUrls, ...regularUrls]
			const sortedUrls = allUrls
				.filter((url) => urlPositions[url] !== undefined)
				.sort((a, b) => urlPositions[a] - urlPositions[b])

			// Create an array of text segments and embedded content
			const segments: JSX.Element[] = []
			let lastIndex = 0
			let segmentIndex = 0

			// Add the text before the first URL
			if (sortedUrls.length === 0) {
				segments.push(<UrlText key={`segment-${segmentIndex}`}>{responseText}</UrlText>)
			} else {
				sortedUrls.forEach((url, index) => {
					const position = urlPositions[url]

					// Add text segment before this URL
					if (position > lastIndex) {
						segments.push(
							<UrlText key={`segment-${segmentIndex++}`}>{responseText.substring(lastIndex, position)}</UrlText>,
						)
					}

					// Add the URL itself
					const urlEndIndex = position + url.length
					segments.push(
						<UrlText key={`url-${segmentIndex++}`}>{responseText.substring(position, urlEndIndex)}</UrlText>,
					)

					// Add embedded content after the URL
					if (imageUrls.includes(url)) {
						segments.push(
							<div key={`embed-${segmentIndex++}`} style={{ margin: "10px 0" }}>
								<img
									src={url}
									alt={`Image for ${url}`}
									style={{
										width: "100%",
										height: "auto",
										borderRadius: "4px",
										cursor: "pointer",
									}}
									onClick={() => {
										const formattedUrl = formatUrlForOpening(url)
										vscode.postMessage({
											type: "openInBrowser",
											url: formattedUrl,
										})
									}}
								/>
							</div>,
						)
					} else if (regularUrls.includes(url)) {
						segments.push(
							<div key={`embed-${segmentIndex++}`} style={{ margin: "10px 0" }}>
								<LinkPreview url={formatUrlForOpening(url)} />
							</div>,
						)
					}

					// Update lastIndex for next segment
					lastIndex = urlEndIndex
				})

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
				<ToggleSwitch>
					<span className="toggle-label">{displayMode === "rich" ? "Rich Display" : "Plain Text"}</span>
					<div className={`toggle-container ${displayMode === "rich" ? "active" : ""}`} onClick={toggleDisplayMode}>
						<div className="toggle-handle"></div>
					</div>
				</ToggleSwitch>

				{renderContent()}
			</ResponseContainer>
		)
	} catch (error) {
		console.error("Error parsing MCP response:", error)
		return (
			<div>
				<div>Error parsing response:</div>
				<div
					style={{
						fontFamily: "monospace",
						fontSize: "12px",
						marginTop: "5px",
						opacity: 0.7,
					}}>
					{responseText}
				</div>
			</div>
		)
	}
}

export default McpResponseExtras
