import React, { useEffect, useState } from "react"
import { vscode } from "../../utils/vscode"
import LinkPreview from "./LinkPreview"

// We'll use the backend isImageUrl function for HEAD requests
// This is a client-side fallback for data URLs and obvious image extensions
const isImageUrlSync = (str: string): boolean => {
	// Remove "image:" prefix if present
	const cleanStr = str.replace(/^image:\s*/, '')
	
	// Check for data URLs which are definitely images
	if (cleanStr.startsWith('data:image/')) {
		return true
	}
	
	// Check for common image file extensions
	return cleanStr.match(/\.(jpg|jpeg|png|gif|webp)$/i) !== null
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

export const cleanUrl = (str: string): string => {
	return str.replace(/^image:\s*/, '').replace(/^url:\s*/, '')
}

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
				const cleanedValue = cleanUrl(value)
				
				// First check with synchronous method
				if (isImageUrlSync(value)) {
					imageUrls.push(cleanedValue)
				} else if (isUrl(cleanedValue)) {
					// For URLs that don't obviously look like images, we'll check asynchronously
					const checkPromise = checkIfImageUrl(cleanedValue).then(isImage => {
						if (isImage) {
							imageUrls.push(cleanedValue)
						} else {
							regularUrls.push(cleanedValue)
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
	
	// Match image URLs (explicitly marked with image: prefix)
	const imageMatches = text.match(/image:\s*(https?:\/\/[^\s]+)/g)
	if (imageMatches) {
		imageUrls.push(...imageMatches.map(match => match.replace(/^image:\s*/, '')))
	}
	
	// Match regular URLs
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

interface McpResponseExtrasProps {
	responseText: string
}

const McpResponseExtras: React.FC<McpResponseExtrasProps> = ({ responseText }) => {
	const [imageUrls, setImageUrls] = useState<string[]>([])
	const [regularUrls, setRegularUrls] = useState<string[]>([])
	const [isLoading, setIsLoading] = useState(true)
	
	useEffect(() => {
		const processResponse = async () => {
			setIsLoading(true)
			try {
				let foundImageUrls: string[] = []
				let foundRegularUrls: string[] = []
				const text = responseText || ""
				
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
				console.error('Error processing MCP response:', error)
			} finally {
				setIsLoading(false)
			}
		}
		
		processResponse()
	}, [responseText])
		
	if (isLoading) {
		return <div>Analyzing response content...</div>
	}
	
	const hasContent = imageUrls.length > 0 || regularUrls.length > 0
	
	try {
		return hasContent ? (
			<>
				{imageUrls.length > 0 && (
					<>
						<div>Found {imageUrls.length} image{imageUrls.length !== 1 ? 's' : ''} in response:</div>
						<div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "10px", marginBottom: "20px" }}>
							{imageUrls.map((url, index) => (
								<img 
									key={`image-${index}`}
									src={url}
									alt={`Image ${index + 1}`}
									className="embed"
							style={{
								width: "100%",
								height: "auto",
								borderRadius: "4px",
								cursor: "pointer"
							}}
									onClick={() => {
										// Open images directly in the browser
										const formattedUrl = formatUrlForOpening(url)
										vscode.postMessage({ 
											type: "openInBrowser", 
											url: formattedUrl 
										})
									}}
								/>
							))}
						</div>
					</>
				)}
				
				{regularUrls.length > 0 && (
					<>
						<div>Found {regularUrls.length} link{regularUrls.length !== 1 ? 's' : ''} in response:</div>
						<div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "16px" }}>
							{regularUrls.map((url, index) => (
								<LinkPreview key={`link-${index}`} url={formatUrlForOpening(url)} />
							))}
						</div>
					</>
				)}
			</>
		) : <div>No links or images found in response</div>
	} catch (error) {
		console.error('Error parsing MCP response:', error);
		return (
			<div>
				<div>Error parsing response:</div>
				<div style={{ 
					fontFamily: "monospace",
					fontSize: "12px",
					marginTop: "5px",
					opacity: 0.7
				}}>
					{responseText}
				</div>
			</div>
		)
	}
}

export default McpResponseExtras
