import axios from "axios"
import ogs from "open-graph-scraper"

export interface OpenGraphData {
	title?: string
	description?: string
	image?: string
	url?: string
	siteName?: string
	type?: string
}

/**
 * Fetches Open Graph metadata from a URL
 * @param url The URL to fetch metadata from
 * @returns Promise resolving to OpenGraphData
 */
export async function fetchOpenGraphData(url: string): Promise<OpenGraphData> {
	try {
		const options = {
			url: url,
			timeout: 5000,
			headers: {
				"user-agent": "Mozilla/5.0 (compatible; VSCodeExtension/1.0; +https://cline.bot)",
			},
			onlyGetOpenGraphInfo: false, // Get all metadata, not just Open Graph
			fetchOptions: {
				redirect: "follow", // Follow redirects
			} as any,
		}

		const { result } = await ogs(options)

		// Use type assertion to avoid TypeScript errors
		const data = result as any

		// Handle image URLs
		let imageUrl = data.ogImage?.[0]?.url || data.twitterImage?.[0]?.url

		// If the image URL is relative, make it absolute
		if (imageUrl && (imageUrl.startsWith("/") || imageUrl.startsWith("./"))) {
			try {
				// Extract the base URL and make the relative URL absolute
				const urlObj = new URL(url)
				const baseUrl = `${urlObj.protocol}//${urlObj.hostname}`
				imageUrl = new URL(imageUrl, baseUrl).href
			} catch (error) {
				console.error(`Error converting relative URL to absolute: ${imageUrl}`, error)
			}
		}

		return {
			title: data.ogTitle || data.twitterTitle || data.dcTitle || data.title || new URL(url).hostname,
			description:
				data.ogDescription ||
				data.twitterDescription ||
				data.dcDescription ||
				data.description ||
				"No description available",
			image: imageUrl,
			url: data.ogUrl || url,
			siteName: data.ogSiteName || new URL(url).hostname,
			type: data.ogType,
		}
	} catch (error) {
		console.error(`Error fetching Open Graph data for ${url}:`, error)
		// Return basic information based on the URL
		try {
			const urlObj = new URL(url)
			return {
				title: urlObj.hostname,
				description: url,
				url: url,
				siteName: urlObj.hostname,
			}
		} catch {
			return {
				title: url,
				description: url,
				url: url,
			}
		}
	}
}

/**
 * Checks if a URL is an image by making a HEAD request and checking the content type
 * @param url The URL to check
 * @returns Promise resolving to boolean indicating if the URL is an image
 */
export async function isImageUrl(url: string): Promise<boolean> {
	try {
		const response = await axios.head(url, {
			headers: {
				"User-Agent": "Mozilla/5.0 (compatible; VSCodeExtension/1.0; +https://cline.bot)",
			},
			timeout: 3000,
		})

		const contentType = response.headers["content-type"]
		return contentType && contentType.startsWith("image/")
	} catch (error) {
		console.error(`Error checking if URL is an image: ${url}`, error)
		// If we can't determine, fall back to checking the file extension
		return /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(url)
	}
}
