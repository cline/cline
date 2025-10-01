import { getStructuredData } from "@/lib/structured-data"

/**
 * StructuredData Component
 *
 * Renders JSON-LD structured data in the document head for SEO.
 *
 * The structured data includes:
 * - Organization information (brand, logo, social profiles)
 * - WebSite metadata (site name for Google Search)
 * - SoftwareApplication details (VS Code extension)
 *
 * @see https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data
 */
export function StructuredData() {
	const structuredData = getStructuredData()

	return (
		<script
			type="application/ld+json"
			dangerouslySetInnerHTML={{
				__html: JSON.stringify(structuredData),
			}}
		/>
	)
}
