export interface OpenGraphData {
	title?: string
	description?: string
	image?: string
	url?: string
	siteName?: string
	type?: string
}

/**
 * Returns display-only metadata without contacting the destination.
 *
 * Automatic link previews used to issue background GET requests for content
 * selected by model/tool output. Corporate-safe builds intentionally keep link
 * rendering receive-only: full page retrieval is available only through the
 * guarded research tool, where the destination is visible and policy checked.
 * @param url The URL to fetch metadata from
 * @returns Promise resolving to OpenGraphData
 */
export async function fetchOpenGraphData(url: string): Promise<OpenGraphData> {
	try {
		const urlObj = new URL(url)
		return {
			title: urlObj.hostname,
			description: urlObj.toString(),
			url: urlObj.toString(),
			siteName: urlObj.hostname,
		}
	} catch {
		return {
			title: url,
			description: url,
			url,
		}
	}
}

/**
 * Checks a URL's path extension without making a network request.
 * @param url The URL to check
 * @returns Promise resolving to boolean indicating if the URL is an image
 */
export async function detectImageUrl(url: string): Promise<boolean> {
	try {
		const parsed = new URL(url)
		return /\.(jpg|jpeg|png|gif|webp|bmp|svg|tiff|tif|avif)$/i.test(parsed.pathname)
	} catch {
		return false
	}
}
