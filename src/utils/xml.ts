import { XMLParser } from "fast-xml-parser"

/**
 * Options for XML parsing
 */
interface ParseXmlOptions {
	/**
	 * Whether to process HTML entities (e.g., &amp; to &).
	 * Default: true for general parsing, false for diff operations
	 */
	processEntities?: boolean
}

/**
 * Parses an XML string into a JavaScript object
 * @param xmlString The XML string to parse
 * @param stopNodes Optional array of node names to stop parsing at
 * @param options Optional parsing options
 * @returns Parsed JavaScript object representation of the XML
 * @throws Error if the XML is invalid or parsing fails
 */
export function parseXml(xmlString: string, stopNodes?: string[], options?: ParseXmlOptions): unknown {
	const _stopNodes = stopNodes ?? []
	const processEntities = options?.processEntities ?? true

	try {
		const parser = new XMLParser({
			ignoreAttributes: false,
			attributeNamePrefix: "@_",
			parseAttributeValue: false,
			parseTagValue: false,
			trimValues: true,
			processEntities,
			stopNodes: _stopNodes,
		})

		return parser.parse(xmlString)
	} catch (error) {
		// Enhance error message for better debugging
		const errorMessage = error instanceof Error ? error.message : "Unknown error"
		throw new Error(`Failed to parse XML: ${errorMessage}`)
	}
}

/**
 * Parses an XML string for diffing purposes, ensuring no HTML entities are decoded.
 * This is a specialized version of parseXml to be used exclusively by diffing tools
 * to prevent mismatches caused by entity processing.
 *
 * Use this instead of parseXml when:
 * - Comparing parsed content against original file content
 * - Performing diff operations where exact character matching is required
 * - Processing XML that will be used in search/replace operations
 *
 * @param xmlString The XML string to parse
 * @param stopNodes Optional array of node names to stop parsing at
 * @returns Parsed JavaScript object representation of the XML
 * @throws Error if the XML is invalid or parsing fails
 */
export function parseXmlForDiff(xmlString: string, stopNodes?: string[]): unknown {
	// Delegate to parseXml with processEntities disabled
	return parseXml(xmlString, stopNodes, { processEntities: false })
}
