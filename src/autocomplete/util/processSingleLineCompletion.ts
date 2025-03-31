import * as Diff from "diff"

interface SingleLineCompletionResult {
	completionText: string
	range?: {
		start: number
		end: number
	}
}

interface DiffType {
	count?: number
	added?: boolean
	removed?: boolean
	value: string
}

function diffPatternMatches(diffs: DiffType[], pattern: DiffPartType[]): boolean {
	if (diffs.length !== pattern.length) {
		return false
	}

	for (let i = 0; i < diffs.length; i++) {
		const diff = diffs[i]
		const diffPartType: DiffPartType = !diff.added && !diff.removed ? "=" : diff.added ? "+" : "-"

		if (diffPartType !== pattern[i]) {
			return false
		}
	}

	return true
}

type DiffPartType = "+" | "-" | "="

export function processSingleLineCompletion(
	lastLineOfCompletionText: string,
	currentText: string,
	cursorPosition: number,
): SingleLineCompletionResult | undefined {
	const diffs: DiffType[] = Diff.diffWords(currentText, lastLineOfCompletionText)

	if (diffPatternMatches(diffs, ["+"])) {
		// Just insert, we're already at the end of the line
		return {
			completionText: lastLineOfCompletionText,
		}
	}

	if (diffPatternMatches(diffs, ["+", "="]) || diffPatternMatches(diffs, ["+", "=", "+"])) {
		// The model repeated the text after the cursor to the end of the line
		return {
			completionText: lastLineOfCompletionText,
			range: {
				start: cursorPosition,
				end: currentText.length + cursorPosition,
			},
		}
	}

	if (diffPatternMatches(diffs, ["+", "-"]) || diffPatternMatches(diffs, ["-", "+"])) {
		// We are midline and the model just inserted without repeating to the end of the line
		return {
			completionText: lastLineOfCompletionText,
		}
	}

	// For any other diff pattern, just use the first added part if available
	if (diffs[0]?.added) {
		return {
			completionText: diffs[0].value,
		}
	}

	// Default case: treat as simple insertion
	return {
		completionText: lastLineOfCompletionText,
	}
}
