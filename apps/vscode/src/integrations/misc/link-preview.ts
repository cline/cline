import axios from "axios"
import * as cheerio from "cheerio/slim"
import { fetch, getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"

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
		const response = await fetch(url, {
			headers: {
				"user-agent": "Mozilla/5.0 (compatible; VSCodeExtension/1.0; +https://cline.bot)",
			},
			redirect: "follow",
			signal: AbortSignal.timeout(5000),
		})
		if (!response.ok) {
			throw new Error(`Failed to fetch Open Graph data: ${response.status}`)
		}
		const $ = cheerio.load(await response.text())
		const metadata = new Map<string, string>()
		$("meta").each((_index, element) => {
			const key = ($(element).attr("property") || $(element).attr("name"))?.toLowerCase()
			const content = $(element).attr("content")
			if (key && content && !metadata.has(key)) {
				metadata.set(key, content)
			}
		})
		const get = (...keys: string[]) => keys.map((key) => metadata.get(key)).find(Boolean)
		const resolvedUrl = response.url || url

		// Handle image URLs
		let imageUrl = get("og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src")

		if (imageUrl) {
			try {
				imageUrl = new URL(imageUrl, resolvedUrl).href
			} catch (error) {
				Logger.error(`Error converting relative URL to absolute: ${imageUrl}`, error)
			}
		}

		return {
			title: get("og:title", "twitter:title", "dc.title") || $("title").first().text().trim() || new URL(url).hostname,
			description:
				get("og:description", "twitter:description", "dc.description", "description") || "No description available",
			image: imageUrl,
			url: get("og:url") || resolvedUrl,
			siteName: get("og:site_name") || new URL(url).hostname,
			type: get("og:type"),
		}
	} catch (_error) {
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
export async function detectImageUrl(url: string): Promise<boolean> {
	try {
		const response = await axios.head(url, {
			headers: {
				"User-Agent": "Mozilla/5.0 (compatible; VSCodeExtension/1.0; +https://cline.bot)",
			},
			timeout: 3000,
			...getAxiosSettings(),
		})

		const contentType = response.headers["content-type"]
		return !!contentType && typeof contentType === "string" && contentType.startsWith("image/")
	} catch (_error) {
		// If we can't determine, fall back to checking the file extension
		return /\.(jpg|jpeg|png|gif|webp|bmp|svg|tiff|tif|avif)$/i.test(url)
	}
}
