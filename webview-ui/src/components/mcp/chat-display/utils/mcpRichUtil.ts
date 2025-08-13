import { StringRequest } from "@shared/proto/cline/common"
import { WebServiceClient } from "@/services/grpc-client"

// Represents a URL found in the text with its position and metadata
export interface UrlMatch {
	url: string // The actual URL
	fullMatch: string // The full matched text
	index: number // Position in the text
	isImage: boolean // Whether this URL is an image
	isProcessed: boolean // Whether we've already processed this URL (to avoid duplicates)
}

// Display segment interface
export interface DisplaySegment {
	type: "text" | "url" | "image" | "link" | "error"
	content: string
	url?: string
	key: string // Pre-computed key for React
}

// Safely create a URL object with error handling and ensure HTTPS
export const safeCreateUrl = (url: string): URL | null => {
	try {
		// Convert HTTP to HTTPS for security
		if (url.startsWith("http://")) {
			url = url.replace("http://", "https://")
		}

		return new URL(url)
	} catch (_e) {
		// If the URL doesn't have a protocol, add https://
		if (!url.startsWith("https://")) {
			try {
				return new URL(`https://${url}`)
			} catch (_e) {
				console.log(`Invalid URL: ${url}`)
				return null
			}
		}
		console.log(`Invalid URL: ${url}`)
		return null
	}
}

// Check if a string is a valid URL
export const isUrl = (str: string): boolean => {
	return safeCreateUrl(str) !== null
}

// Get hostname safely
export const getSafeHostname = (url: string): string => {
	try {
		const urlObj = safeCreateUrl(url)
		return urlObj ? urlObj.hostname : "unknown-host"
	} catch (_e) {
		return "unknown-host"
	}
}

// Check if a URL is a localhost URL by examining the hostname
export const isLocalhostUrl = (url: string): boolean => {
	try {
		const hostname = getSafeHostname(url)
		return (
			hostname === "localhost" ||
			hostname === "127.0.0.1" ||
			hostname === "0.0.0.0" ||
			hostname.startsWith("192.168.") ||
			hostname.startsWith("10.") ||
			hostname.endsWith(".local")
		)
	} catch (_e) {
		// If we can't parse the URL, assume it's not localhost
		return false
	}
}

// Function to normalize relative URLs by combining with a base URL
export const normalizeRelativeUrl = (relativeUrl: string, baseUrl: string): string => {
	// If it's already an absolute URL or a data URL, return as is
	if (relativeUrl.startsWith("http://") || relativeUrl.startsWith("https://") || relativeUrl.startsWith("data:")) {
		return relativeUrl
	}

	try {
		// Parse the base URL
		const baseUrlObj = safeCreateUrl(baseUrl)
		if (!baseUrlObj) {
			return relativeUrl // If we can't parse the base URL, return original
		}

		// Handle different types of relative paths
		if (relativeUrl.startsWith("//")) {
			// Protocol-relative URL
			return `${baseUrlObj.protocol}${relativeUrl}`
		} else if (relativeUrl.startsWith("/")) {
			// Root-relative URL
			return `${baseUrlObj.protocol}//${baseUrlObj.host}${relativeUrl}`
		} else {
			// Path-relative URL
			// Get the directory part of the URL
			let basePath = baseUrlObj.pathname
			if (!basePath.endsWith("/")) {
				// If the path doesn't end with a slash, remove the file part
				basePath = basePath.substring(0, basePath.lastIndexOf("/") + 1)
			}
			return `${baseUrlObj.protocol}//${baseUrlObj.host}${basePath}${relativeUrl}`
		}
	} catch (error) {
		console.log(`Error normalizing relative URL: ${error}`)
		return relativeUrl // Return original on error
	}
}

// Helper to ensure URL is in a format that can be opened
export const formatUrlForOpening = (url: string): string => {
	// If it's a data URI, return as is
	if (url.startsWith("data:image/")) {
		return url
	}

	// Use safeCreateUrl to validate and format the URL
	const urlObj = safeCreateUrl(url)
	if (urlObj) {
		return urlObj.href
	}

	console.log(`Invalid URL format: ${url}`)
	// Return a safe fallback that won't crash
	return "about:blank"
}

// Function to check if a URL is an image using HEAD request
export const checkIfImageUrl = async (url: string): Promise<boolean> => {
	// For data URLs, we can check synchronously
	if (url.startsWith("data:image/")) {
		return true
	}

	// Create a secure URL for the check but don't modify the original URL
	let secureUrl = url
	// Convert HTTP to HTTPS for security in the network request only
	if (secureUrl.startsWith("http://")) {
		secureUrl = secureUrl.replace("http://", "https://")
		console.log(`Using HTTPS version for image check: ${secureUrl}`)
	}

	// Validate URL before proceeding
	if (!isUrl(url)) {
		console.log("Invalid URL format:", url)
		return false
	}

	// For https URLs, we need to use the gRPC FileService
	if (url.startsWith("https")) {
		try {
			// Use the gRPC client with timeout
			const timeoutPromise = new Promise<boolean>((resolve) => {
				setTimeout(() => {
					console.log("Hit timeout waiting for checkIsImageUrl")
					resolve(false)
				}, 3000)
			})

			// Create the actual service call
			const servicePromise = WebServiceClient.checkIsImageUrl(StringRequest.create({ value: url }))
				.then((result) => result.isImage)
				.catch((error) => {
					console.error("Error checking if URL is an image via gRPC:", error)
					return false
				})

			// Race between the service call and the timeout
			return Promise.race([servicePromise, timeoutPromise])
		} catch (_error) {
			console.log("Error checking if URL is an image:", url)
			// Return false to indicate it's not an image
			return false
		}
	}

	// Don't fall back to extension check for other URLs
	// Only data URLs (handled above) are guaranteed to be images
	// For all other URLs, we need proper content type verification
	console.log(`URL protocol not supported for image check: ${url}`)
	return false
}

/**
 * Extracts all valid URLs from the given text
 * @param text - The text to search for URLs
 * @param maxUrls - Maximum number of URLs to extract (default: 50)
 * @returns Array of URL matches sorted by position in text
 */
export const extractUrlsFromText = (text: string, maxUrls: number = 50): UrlMatch[] => {
	const matches: UrlMatch[] = []
	const urlRegex = /(?:https?:\/\/|data:image)[^\s<>"']+/g
	let urlMatch: RegExpExecArray | null
	let urlCount = 0

	while ((urlMatch = urlRegex.exec(text)) !== null && urlCount < maxUrls) {
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
			isImage: false, // Will be determined later
			isProcessed: false,
		})

		urlCount++
	}

	console.log(`Found ${matches.length} URLs in text`)
	return matches.sort((a, b) => a.index - b.index)
}

/**
 * Processes URLs to determine their types (e.g., image vs link)
 * Processes URLs sequentially to avoid network flooding
 * @param matches - Array of URL matches to process
 * @param onProgress - Callback for progress updates with updated matches
 * @param cancellationToken - Object to check if processing should be cancelled
 * @returns Promise that resolves when processing is complete
 */
export const processUrlTypes = async (
	matches: UrlMatch[],
	onProgress: (updatedMatches: UrlMatch[]) => void,
	cancellationToken: { cancelled: boolean },
): Promise<void> => {
	console.log(`Starting sequential URL processing for ${matches.length} URLs`)

	for (let i = 0; i < matches.length; i++) {
		// Skip already processed URLs
		if (matches[i].isProcessed) {
			continue
		}

		// Check if processing has been canceled
		if (cancellationToken.cancelled) {
			console.log("URL processing canceled")
			return
		}

		const match = matches[i]
		console.log(`Processing URL ${i + 1} of ${matches.length}: ${match.url}`)

		try {
			// Check if URL is an image
			const isImage = await checkIfImageUrl(match.url)

			// Skip if processing has been canceled
			if (cancellationToken.cancelled) {
				return
			}

			// Update the match
			match.isImage = isImage
			match.isProcessed = true

			// Notify progress with a new array to ensure React detects changes
			onProgress([...matches])
		} catch (err) {
			console.log(`URL check error: ${match.url}`, err)
			match.isProcessed = true

			// Update state even on error
			if (!cancellationToken.cancelled) {
				onProgress([...matches])
			}
		}

		// Delay between URL processing to avoid overwhelming the network
		if (!cancellationToken.cancelled && i < matches.length - 1) {
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
	}

	console.log(`URL processing complete. Found ${matches.filter((m) => m.isImage).length} image URLs`)
}

/**
 * Orchestrates the URL extraction and processing pipeline
 * @param text - The response text to process
 * @param maxUrls - Maximum number of URLs to process
 * @param onMatchesFound - Callback when initial URLs are extracted
 * @param onMatchesUpdated - Callback when URL types are determined
 * @param onError - Error handler callback
 * @returns Cleanup function to cancel processing
 */
export const processResponseUrls = (
	text: string,
	maxUrls: number,
	onMatchesFound: (matches: UrlMatch[]) => void,
	onMatchesUpdated: (matches: UrlMatch[]) => void,
	onError: (error: string) => void,
): (() => void) => {
	const cancellationToken = { cancelled: false }

	const process = async () => {
		try {
			// Extract URLs from text
			const matches = extractUrlsFromText(text, maxUrls)

			// Immediately notify about found matches
			onMatchesFound(matches)

			// Process URLs in the background
			await processUrlTypes(matches, onMatchesUpdated, cancellationToken)
		} catch (_error) {
			onError("Failed to process response content. Switch to plain text mode to view safely.")
		}
	}

	// Start processing
	process()

	// Return cleanup function
	return () => {
		cancellationToken.cancelled = true
		console.log("Cleaning up URL processing")
	}
}

/**
 * Builds an array of display segments from response text and URL matches
 * @param responseText - The full response text
 * @param urlMatches - Array of URL matches with their positions and types
 * @returns Array of display segments describing how to render the content
 */
export const buildDisplaySegments = (responseText: string, urlMatches: UrlMatch[]): DisplaySegment[] => {
	const segments: DisplaySegment[] = []
	let lastIndex = 0
	let segmentIndex = 0

	// Handle case with no URLs
	if (urlMatches.length === 0) {
		return [
			{
				type: "text",
				content: responseText,
				key: "segment-0",
			},
		]
	}

	// Process each URL match
	for (let i = 0; i < urlMatches.length; i++) {
		const match = urlMatches[i]
		const { url, fullMatch, index } = match

		// Add text segment before this URL
		if (index > lastIndex) {
			segments.push({
				type: "text",
				content: responseText.substring(lastIndex, index),
				key: `segment-${segmentIndex++}`,
			})
		}

		// Add the URL text itself
		segments.push({
			type: "url",
			content: fullMatch,
			key: `url-${segmentIndex++}`,
		})

		// Add embedded content after the URL
		if (match.isImage) {
			segments.push({
				type: "image",
				content: url,
				url: formatUrlForOpening(url),
				key: `embed-image-${url}-${segmentIndex++}`,
			})
		} else if (match.isProcessed && !isLocalhostUrl(url)) {
			segments.push({
				type: "link",
				content: url,
				url: formatUrlForOpening(url),
				key: `embed-${url}-${segmentIndex++}`,
			})
		}

		// Update lastIndex for next segment
		lastIndex = index + fullMatch.length
	}

	// Add any remaining text after the last URL
	if (lastIndex < responseText.length) {
		segments.push({
			type: "text",
			content: responseText.substring(lastIndex),
			key: `segment-${segmentIndex++}`,
		})
	}

	return segments
}
