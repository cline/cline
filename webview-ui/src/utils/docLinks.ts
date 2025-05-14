/**
 * Utility for building Roo Code documentation links with UTM telemetry.
 *
 * @param path - The path after the docs root (no leading slash)
 * @param campaign - The UTM campaign context (e.g. "welcome", "provider_docs", "tips", "error_tooltip")
 * @returns The full docs URL with UTM parameters
 */
export function buildDocLink(path: string, campaign: string): string {
	// Remove any leading slash from path
	const cleanPath = path.replace(/^\//, "")
	const [basePath, hash] = cleanPath.split("#")
	const baseUrl = `https://docs.roocode.com/${basePath}?utm_source=extension&utm_medium=ide&utm_campaign=${encodeURIComponent(campaign)}`
	return hash ? `${baseUrl}#${hash}` : baseUrl
}
