import { vscode } from "../../utils/vscode"

// Safely create a URL object with error handling and ensure HTTPS
export const safeCreateUrl = (url: string): URL | null => {
	try {
		// Convert HTTP to HTTPS for security
		if (url.startsWith("http://")) {
			url = url.replace("http://", "https://")
		}

		return new URL(url)
	} catch (e) {
		// If the URL doesn't have a protocol, add https://
		if (!url.startsWith("https://")) {
			try {
				return new URL(`https://${url}`)
			} catch (e) {
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
	} catch (e) {
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
	} catch (e) {
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

	// For https URLs, we need to send a message to the extension
	if (url.startsWith("https")) {
		try {
			// Create a promise that will resolve when we get a response
			return new Promise((resolve) => {
				let timeoutId: ReturnType<typeof setTimeout> | undefined = undefined

				// Set up a one-time listener for the response
				const messageListener = (event: MessageEvent) => {
					const message = event.data
					if (message.type === "isImageUrlResult" && message.url === url) {
						window.removeEventListener("message", messageListener)
						resolve(message.isImage)
						if (timeoutId) {
							clearTimeout(timeoutId)
						}
					}
				}

				window.addEventListener("message", messageListener)

				// Send the request to the extension
				vscode.postMessage({
					type: "checkIsImageUrl",
					text: url,
				})

				// Set a timeout to avoid hanging indefinitely
				timeoutId = setTimeout(() => {
					window.removeEventListener("message", messageListener)
					console.log("Hit timeout waiting for checkIsImageUrl")
					resolve(false)
				}, 3000)
			})
		} catch (error) {
			console.log("Error checking if URL is an image:", url)
			// Don't fall back to extension check on error
			// Instead, return false to indicate it's not an image
			return false
		}
	}

	// Don't fall back to extension check for other URLs
	// Only data URLs (handled above) are guaranteed to be images
	// For all other URLs, we need proper content type verification
	console.log(`URL protocol not supported for image check: ${url}`)
	return false
}
