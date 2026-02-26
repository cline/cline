/**
 * Computes line-level diff statistics between two strings.
 *
 * Uses a simple line-by-line comparison:
 * - Lines present only in `after` are counted as added.
 * - Lines present only in `before` are counted as deleted.
 * - Lines that differ at the same position are counted as changed.
 */
export interface LineDiffStats {
	linesAdded: number
	linesDeleted: number
	linesChanged: number
}

/**
 * Calculate line diff stats between before and after content.
 *
 * @param before - The original file content (empty string for new files)
 * @param after - The new file content (empty string for deleted files)
 * @returns LineDiffStats with counts of added, deleted, and changed lines
 */
export function computeLineDiffStats(before: string, after: string): LineDiffStats {
	const beforeLines = before ? before.split("\n") : []
	const afterLines = after ? after.split("\n") : []

	const maxLen = Math.max(beforeLines.length, afterLines.length)
	let linesAdded = 0
	let linesDeleted = 0
	let linesChanged = 0

	for (let i = 0; i < maxLen; i++) {
		const bLine = i < beforeLines.length ? beforeLines[i] : undefined
		const aLine = i < afterLines.length ? afterLines[i] : undefined

		if (bLine === undefined && aLine !== undefined) {
			linesAdded++
		} else if (bLine !== undefined && aLine === undefined) {
			linesDeleted++
		} else if (bLine !== aLine) {
			linesChanged++
		}
	}

	return { linesAdded, linesDeleted, linesChanged }
}
