/**
 * Shared utilities for processing Jupyter notebooks for LLM context.
 * Used by both the context menu commands (addToCline, etc.) and file reading (extract-text.ts).
 */

/**
 * Image MIME types that should be truncated in notebook outputs
 */
const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/svg+xml", "image/webp"]

/**
 * Sanitizes the outputs of a single notebook cell by truncating image data.
 * Keeps text outputs intact for context, only replaces binary image data with placeholders.
 *
 * @param cell A notebook cell object
 * @returns The cell with sanitized outputs
 */
export function sanitizeCellOutputs(cell: Record<string, unknown>): Record<string, unknown> {
	if (cell.cell_type !== "code" || !cell.outputs || !Array.isArray(cell.outputs)) {
		return cell
	}

	const sanitizedOutputs = cell.outputs.map((output: Record<string, unknown>) => {
		// Handle display_data and execute_result outputs with data field
		if (output.data && typeof output.data === "object") {
			const data = output.data as Record<string, unknown>
			const sanitizedData = { ...data }

			for (const mimeType of IMAGE_MIME_TYPES) {
				if (mimeType in sanitizedData) {
					sanitizedData[mimeType] = "[IMAGE DATA TRUNCATED]"
				}
			}

			return { ...output, data: sanitizedData }
		}
		return output
	})

	return { ...cell, outputs: sanitizedOutputs }
}

/**
 * Sanitizes a Jupyter notebook JSON by truncating verbose image data in cell outputs.
 * This prevents flooding the LLM context with large base64-encoded images that are
 * not useful for editing (outputs are regenerated when code runs).
 *
 * @param jsonString The raw notebook JSON string
 * @returns Sanitized JSON string with image data truncated
 */
export function sanitizeNotebookForLLM(jsonString: string): string {
	try {
		const notebook = JSON.parse(jsonString)

		if (!notebook.cells || !Array.isArray(notebook.cells)) {
			return jsonString
		}

		notebook.cells = notebook.cells.map((cell: Record<string, unknown>) => sanitizeCellOutputs(cell))

		return JSON.stringify(notebook, null, 1)
	} catch {
		// If parsing fails, return original string
		return jsonString
	}
}

/**
 * Sanitizes a single notebook cell object and returns it as a JSON string.
 * Used by context menu commands that work with individual cells.
 *
 * @param cell A notebook cell object
 * @returns JSON string of the sanitized cell
 */
export function sanitizeCellForLLM(cell: Record<string, unknown>): string {
	const sanitized = sanitizeCellOutputs(cell)
	return JSON.stringify(sanitized, null, 2)
}
