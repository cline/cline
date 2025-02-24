import React from "react"
import { vscode } from "../../utils/vscode"

// Image detection utilities
export const isImageUrl = (str: string): boolean => {
	// Remove "image:" prefix if present
	const cleanStr = str.replace(/^image:\s*/, '')
	return cleanStr.match(/\.(jpg|jpeg|png|gif|webp)$/i) !== null || 
		cleanStr.startsWith('data:image/') ||
		(cleanStr.includes('wolframalpha.com') && cleanStr.includes('MSPStoreType=image'))
}

export const cleanUrl = (str: string): string => {
	return str.replace(/^image:\s*/, '')
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

export const findImageUrls = (obj: any): string[] => {
	const urls: string[] = []
	if (typeof obj === 'object' && obj !== null) {
		Object.values(obj).forEach(value => {
			if (typeof value === 'string' && isImageUrl(value)) {
				urls.push(cleanUrl(value))
			} else if (typeof value === 'object') {
				urls.push(...findImageUrls(value))
			}
		})
	}
	return urls
}

interface McpResponseExtrasProps {
	responseText: string
}

const McpResponseExtras: React.FC<McpResponseExtrasProps> = ({ responseText }) => {
	try {
		let imageUrls: string[] = []
		const text = responseText || ""
		
		// First try parsing as JSON
		try {
			const jsonResponse = JSON.parse(text)
			imageUrls = findImageUrls(jsonResponse)
		} catch {
			// If not JSON, try parsing as formatted text
			const matches = text.match(/image:\s*(https?:\/\/[^\s]+)/g)
			if (matches) {
				imageUrls = matches.map(match => match.replace(/^image:\s*/, ''))
			}
		}
		
		return imageUrls.length > 0 ? (
			<>
				<div>Found {imageUrls.length} image{imageUrls.length !== 1 ? 's' : ''} in response:</div>
				<div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "10px" }}>
					{imageUrls.map((url, index) => (
						<img 
							key={`response-${index}`}
							src={url}
							alt={`Response ${index + 1}`}
							className="embed"
							style={{
								width: "100%",
								height: "auto",
								borderRadius: "4px",
								cursor: "pointer"
							}}
							onClick={() => {
								// For data URIs, use openImage
								if (url.startsWith('data:image/')) {
									vscode.postMessage({ type: "openImage", text: url })
								} else {
									// For regular URLs, open in a webview panel
									vscode.postMessage({ 
										type: "openImageInWebview", 
										text: url 
									})
								}
							}}
						/>
					))}
				</div>
			</>
		) : <div>No images found in response</div>
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
