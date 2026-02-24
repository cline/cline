/**
 * Slash command utilities for CLI
 * Handles detection, filtering, and insertion of slash commands
 */

export interface VisibleWindow<T> {
	items: T[]
	startIndex: number
}

/**
 * Calculate visible window for a scrollable list menu.
 * Centers the selected item in the visible window when possible.
 * Returns the visible items and the start index for selection tracking.
 */
export function getVisibleWindow<T>(items: T[], selectedIndex: number, maxVisible = 5): VisibleWindow<T> {
	if (items.length <= maxVisible) {
		return { items, startIndex: 0 }
	}

	const halfWindow = Math.floor(maxVisible / 2)
	let startIndex = Math.max(0, selectedIndex - halfWindow)
	const endIndex = Math.min(items.length, startIndex + maxVisible)

	// Adjust if we're near the end
	if (endIndex - startIndex < maxVisible) {
		startIndex = Math.max(0, endIndex - maxVisible)
	}

	return { items: items.slice(startIndex, endIndex), startIndex }
}

/**
 * Insert a slash command at the given slash index, replacing any partial query
 */
export function insertSlashCommand(text: string, slashIndex: number, commandName: string): string {
	const beforeSlash = text.slice(0, slashIndex)
	// Insert command with trailing space
	return `${beforeSlash}/${commandName} `
}
