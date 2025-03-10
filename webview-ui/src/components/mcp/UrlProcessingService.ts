import { vscode } from "../../utils/vscode"
import DOMPurify from "dompurify"

// Maximum number of URLs to process in total
export const MAX_URLS = 50

// We'll use the backend isImageUrl function for HEAD requests
// This is a client-side fallback for data URLs and obvious image extensions
export const isImageUrlSync = (str: string): boolean => {
	// Check for data URLs which are definitely images
	if (str.startsWith("data:image/")) {
		return true
	}

	// Check for common image file extensions - added more extensions including gif
	return str.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg|tiff|tif|avif)$/i) !== null
}

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
	// Use safeCreateUrl under the hood since they do almost the same thing
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
		if (!baseUrlObj) return relativeUrl // If we can't parse the base URL, return original

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
				let timeoutId: ReturnType<typeof setTimeout> | undefined = undefined;

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

// Process a batch of promises with individual timeouts - only try once, no retries
export const processBatch = async <T>(
	promises: Promise<T>[],
	batchSize: number = 2, // Reduced default batch size
	timeoutMs: number = 8000 // Increased default timeout
): Promise<Array<T | null>> => {
	console.log(`Processing ${promises.length} promises in batches of ${batchSize}`)
	const results: Array<T | null> = []

	// Process in batches
	for (let i = 0; i < promises.length; i += batchSize) {
		console.log(`Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(promises.length / batchSize)}`)
		const batch = promises.slice(i, i + batchSize)

		// Create an array to track which promises have completed
		const completedFlags = new Array(batch.length).fill(false)

		// Process each promise in the batch individually to prevent one timeout from affecting others
		const batchResults = await Promise.all(
			batch.map((promise, idx) => {
				// Create a promise that resolves with the result or null on timeout
				return new Promise<T | null>((resolve) => {
					// Set up timeout
					const timeoutId = setTimeout(() => {
						if (!completedFlags[idx]) {
							console.log(`Promise ${i + idx} timed out after ${timeoutMs}ms`)
							resolve(null)
						}
					}, timeoutMs)

					// Process the actual promise
					promise
						.then((result) => {
							// Only resolve if we haven't already timed out
							if (!completedFlags[idx]) {
								completedFlags[idx] = true
								clearTimeout(timeoutId)
								resolve(result)
							}
						})
						.catch((err) => {
							console.log(`Promise ${i + idx} failed: ${err.message}`)
							if (!completedFlags[idx]) {
								completedFlags[idx] = true
								clearTimeout(timeoutId)
								resolve(null)
							}
						})
				})
			})
		)

		// Add results to the final array
		results.push(...batchResults)

		// Add a larger delay between batches to prevent overwhelming servers
		if (i + batchSize < promises.length) {
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
	}

	console.log(`Processed ${results.length} of ${promises.length} promises (including failed ones)`)
	return results // Return array with possible null values, let caller handle filtering if needed
}

// Find all URLs (both image and regular) in an object
export const findUrls = async (obj: any): Promise<{ imageUrls: string[]; regularUrls: string[] }> => {
	console.log("Finding URLs in object")
	const imageUrls: string[] = []
	const regularUrls: string[] = []
	const pendingChecks: Promise<void>[] = []

	let urlCount = 0

	if (typeof obj === "object" && obj !== null) {
		for (const value of Object.values(obj)) {
			// Stop processing if we've reached the limit
			if (urlCount >= MAX_URLS) {
				console.log(`Reached URL limit of ${MAX_URLS}, stopping processing`)
				break
			}

			if (typeof value === "string") {
				const originalUrl = value // Keep the original URL

				// Skip localhost URLs to prevent security issues
				if (isLocalhostUrl(originalUrl)) {
					console.log("Skipping localhost URL:", originalUrl)
					continue
				}

				// Only check if it's a valid URL first
				if (isUrl(originalUrl)) {
					// Always use proper content type verification for all URLs
					const checkPromise = checkIfImageUrl(value)
						.then((isImage) => {
							if (isImage) {
								imageUrls.push(value)
							} else {
								regularUrls.push(value)
							}
						})
						.catch((err) => {
							console.log(`URL check skipped: ${value}`)
						})
					pendingChecks.push(checkPromise)
					urlCount++
				}
			} else if (typeof value === "object") {
				const nestedUrlsPromise = findUrls(value)
					.then((nestedUrls) => {
						// Respect the URL limit for nested objects too
						const remainingSlots = MAX_URLS - urlCount
						if (remainingSlots > 0) {
							const imageUrlsToAdd = nestedUrls.imageUrls.slice(0, remainingSlots)
							imageUrls.push(...imageUrlsToAdd)

							const newCount = urlCount + imageUrlsToAdd.length
							const regularUrlsToAdd = nestedUrls.regularUrls.slice(0, MAX_URLS - newCount)
							regularUrls.push(...regularUrlsToAdd)

							urlCount = newCount + regularUrlsToAdd.length
							console.log(
								`Added ${imageUrlsToAdd.length} image URLs and ${regularUrlsToAdd.length} regular URLs from nested object`
							)
						}
					})
					.catch((err) => {
						console.log("Some nested URLs could not be processed")
					})
				pendingChecks.push(nestedUrlsPromise)
			}
		}
	}

	// Process URL checks in batches
	if (pendingChecks.length > 0) {
		console.log(`Processing ${pendingChecks.length} URL checks in batches`)
		await processBatch(pendingChecks)
	}

	console.log(`URL finding complete. Found ${imageUrls.length} image URLs and ${regularUrls.length} regular URLs`)
	return { imageUrls, regularUrls }
}
