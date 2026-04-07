/**
 * Shared utility functions for parsing task-progress checklist items.
 * Used by both extension and webview code.
 */

/**
 * Checks if a trimmed line matches checklist item patterns.
 * @param line The trimmed line to check
 * @returns true if the line is a checklist item (- [ ], - [x], or - [X])
 */
export function isChecklistItem(line: string): boolean {
	return line.startsWith("- [ ]") || line.startsWith("- [x]") || line.startsWith("- [X]")
}

/**
 * Checks if a trimmed line is a completed checklist item.
 * @param line The trimmed line to check
 * @returns true if the line is a completed checklist item (- [x] or - [X])
 */
export function isCompletedChecklistItem(line: string): boolean {
	return line.startsWith("- [x]") || line.startsWith("- [X]")
}

/**
 * Flexible regex pattern for matching checklist items with spacing variations.
 * Matches patterns like "- [x] text", "- [X] text", "- [ ] text", "-  [ ]  text", etc.
 */
export const CHECKLIST_ITEM_REGEX = /^-\s*\[([ xX])\]\s*(.+)$/

/**
 * Parse a checklist item using a flexible regex (allows spacing variations).
 * @param line The trimmed line to parse
 * @returns Object with checked status and text, or null if not a checklist item
 */
export function parseChecklistItem(line: string): { checked: boolean; text: string } | null {
	const match = line.match(CHECKLIST_ITEM_REGEX)
	if (match) {
		const checked = match[1] === "x" || match[1] === "X"
		const text = match[2].trim()
		return { checked, text }
	}
	return null
}
