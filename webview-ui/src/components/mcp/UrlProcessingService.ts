import { vscode } from "../../utils/vscode"
import DOMPurify from "dompurify"

// Maximum number of URLs to process in total
export const MAX_URLS = 100;

// We'll use the backend isImageUrl function for HEAD requests
// This is a client-side fallback for data URLs and obvious image extensions
export const isImageUrlSync = (str: string): boolean => {
	// Check for data URLs which are definitely images
	if (str.startsWith("data:image/")) {
		return true
	}

	// Check for common image file extensions
	return str.match(/\.(jpg|jpeg|png|gif|webp)$/i) !== null
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

// Check if a string is a valid URL
export const isUrl = (str: string): boolean => {
	// Use safeCreateUrl under the hood since they do almost the same thing
	return safeCreateUrl(str) !== null;
}

// Get hostname safely
export const getSafeHostname = (url: string): string => {
	try {
		const urlObj = safeCreateUrl(url);
		return urlObj ? urlObj.hostname : 'unknown-host';
	} catch (e) {
		return 'unknown-host';
	}
}

// Helper to ensure URL is in a format that can be opened
export const formatUrlForOpening = (url: string): string => {
	// If it's a data URI, return as is
	if (url.startsWith("data:image/")) {
		return url
	}

	// Use safeCreateUrl to validate and format the URL
	const urlObj = safeCreateUrl(url);
	if (urlObj) {
		return urlObj.href;
	}
	
	console.log(`Invalid URL format: ${url}`);
	// Return a safe fallback that won't crash
	return "about:blank";
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

// Process a batch of promises with individual timeouts - only try once, no retries
export const processBatch = async <T>(
	promises: Promise<T>[],
	batchSize: number = 4,
	timeoutMs: number = 5000
): Promise<T[]> => {
	console.log(`Processing ${promises.length} promises in batches of ${batchSize}`);
	const results: T[] = [];

	// Process in batches
	for (let i = 0; i < promises.length; i += batchSize) {
		console.log(`Processing batch ${Math.floor(i/batchSize) + 1} of ${Math.ceil(promises.length/batchSize)}`);
		const batch = promises.slice(i, i + batchSize);
		
		// Process each promise in the batch with its own timeout
		const batchPromises = batch.map(promise => 
			Promise.race([
				promise,
				new Promise<never>((_, reject) => 
					setTimeout(() => reject(new Error("Item timeout")), timeoutMs)
				)
			])
		);
		
		// Use Promise.allSettled to handle individual promise failures
		const batchResults = await Promise.allSettled(batchPromises);
		
		// Process results, including both successful and failed ones
		// This ensures we don't lose track of any URLs
		batchResults.forEach((result, index) => {
			if (result.status === 'fulfilled') {
				results.push(result.value);
			} else {
				// For failed promises, we still add the result to maintain the order
				// The caller will need to handle these appropriately
				console.log(`Item ${index} in batch failed: ${result.reason}`);
				// We can't access the original promise value directly, so push null
				results.push(null as unknown as T);
			}
		});
		
		// Add a small delay between batches to prevent overwhelming
		if (i + batchSize < promises.length) {
			await new Promise(resolve => setTimeout(resolve, 50));
		}
	}

	console.log(`Processed ${results.length} of ${promises.length} promises (including failed ones)`);
	return results;
}

// Extract URLs from text using regex
export const extractUrlsFromText = async (text: string): Promise<{ imageUrls: string[]; regularUrls: string[] }> => {
	console.log("Extracting URLs from text");
	const imageUrls: string[] = []
	const regularUrls: string[] = []
	const pendingChecks: Promise<void>[] = []
	
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
		console.log(`Found ${extractedUrls.length} image-prefixed URLs, adding ${urlsToAdd.length}`);
		imageUrls.push(...urlsToAdd)
		urlCount += urlsToAdd.length;
	}

	// Match all URLs (including those that might be in the middle of paragraphs)
	const urlMatches = text.match(/https?:\/\/[^\s<>"']+/g)
	if (urlMatches && urlCount < MAX_URLS) {
		// Filter out URLs that are already in imageUrls
		const filteredUrls = urlMatches
			.filter((url) => !imageUrls.includes(url))
			// Limit the number of URLs to process
			.slice(0, MAX_URLS - urlCount);

		console.log(`Found ${urlMatches.length} URLs, processing ${filteredUrls.length} after filtering`);

		// Check each URL to see if it's an image
		for (const url of filteredUrls) {
			// Validate URL before processing
			if (!isUrl(url)) {
				console.log("Skipping invalid URL:", url);
				continue;
			}
			
			// Skip localhost URLs to prevent security issues
			if (url.includes('localhost') || url.includes('127.0.0.1') || url.includes('0.0.0.0')) {
				console.log("Skipping localhost URL:", url);
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

	// Process URL checks in batches
	if (pendingChecks.length > 0) {
		console.log(`Processing ${pendingChecks.length} URL checks in batches`);
		await processBatch(pendingChecks);
	}

	console.log(`URL extraction complete. Found ${imageUrls.length} image URLs and ${regularUrls.length} regular URLs`);
	return { imageUrls, regularUrls }
}

// Find all URLs (both image and regular) in an object
export const findUrls = async (obj: any): Promise<{ imageUrls: string[]; regularUrls: string[] }> => {
	console.log("Finding URLs in object");
	const imageUrls: string[] = []
	const regularUrls: string[] = []
	const pendingChecks: Promise<void>[] = []
	
	let urlCount = 0;

	if (typeof obj === "object" && obj !== null) {
		for (const value of Object.values(obj)) {
			// Stop processing if we've reached the limit
			if (urlCount >= MAX_URLS) {
				console.log(`Reached URL limit of ${MAX_URLS}, stopping processing`);
				break;
			}
			
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
						console.log(`Added ${imageUrlsToAdd.length} image URLs and ${regularUrlsToAdd.length} regular URLs from nested object`);
					}
				}).catch(err => {
					console.log("Some nested URLs could not be processed");
				});
				pendingChecks.push(nestedUrlsPromise)
			}
		}
	}

	// Process URL checks in batches
	if (pendingChecks.length > 0) {
		console.log(`Processing ${pendingChecks.length} URL checks in batches`);
		await processBatch(pendingChecks);
	}

	console.log(`URL finding complete. Found ${imageUrls.length} image URLs and ${regularUrls.length} regular URLs`);
	return { imageUrls, regularUrls }
}
