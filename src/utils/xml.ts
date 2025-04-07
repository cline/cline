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
			ignoreAttributes: false,
			attributeNamePrefix: "@_",
			parseAttributeValue: false,
			parseTagValue: false,
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
