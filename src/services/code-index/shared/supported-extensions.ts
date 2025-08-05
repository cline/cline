import { extensions as allExtensions } from "../../tree-sitter"

// Include all extensions including markdown for the scanner
export const scannerExtensions = allExtensions

/**
 * Extensions that should always use fallback chunking instead of tree-sitter parsing.
 * These are typically languages that don't have a proper WASM parser available
 * or where the parser doesn't work correctly.
 *
 * NOTE: Only extensions that are already in the supported extensions list can be added here.
 * To add support for new file types, they must first be added to the tree-sitter extensions list.
 *
 * HOW TO ADD A NEW FALLBACK EXTENSION:
 * 1. First ensure the extension is in src/services/tree-sitter/index.ts extensions array
 * 2. Add the extension to the fallbackExtensions array below
 * 3. The file will automatically use length-based chunking for indexing
 *
 * Note: Do NOT remove parser cases from languageParser.ts as they may be used elsewhere
 */
export const fallbackExtensions = [
	".vb", // Visual Basic .NET - no dedicated WASM parser
	".scala", // Scala - uses fallback chunking instead of Lua query workaround
	".swift", // Swift - uses fallback chunking due to parser instability
]

/**
 * Check if a file extension should use fallback chunking
 * @param extension File extension (including the dot)
 * @returns true if the extension should use fallback chunking
 */
export function shouldUseFallbackChunking(extension: string): boolean {
	return fallbackExtensions.includes(extension.toLowerCase())
}
