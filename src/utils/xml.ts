import { XMLParser } from "fast-xml-parser"

/**
 * Parses an XML string into a JavaScript object
 * @param xmlString The XML string to parse
 * @returns Parsed JavaScript object representation of the XML
 * @throws Error if the XML is invalid or parsing fails
 */
export function parseXml(xmlString: string, stopNodes?: string[]): unknown {
	const _stopNodes = stopNodes ?? []
	try {
		const parser = new XMLParser({
			// Preserve attribute types (don't convert numbers/booleans)
			ignoreAttributes: false,
			attributeNamePrefix: "@_",
			// Parse numbers and booleans in text nodes
			parseAttributeValue: true,
			parseTagValue: true,
			// Trim whitespace from text nodes
			trimValues: true,
			stopNodes: _stopNodes,
		})

		return parser.parse(xmlString)
	} catch (error) {
		// Enhance error message for better debugging
		const errorMessage = error instanceof Error ? error.message : "Unknown error"
		throw new Error(`Failed to parse XML: ${errorMessage}`)
	}
}
