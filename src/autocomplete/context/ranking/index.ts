import { countTokens } from "../../../llm/countTokens"
import { AutocompleteSnippetWithScore, RangeInFileWithContents } from "../../types"
import { HelperVars } from "../../util/HelperVars"

const rx = /[\s.,\/#!$%\^&\*;:{}=\-_`~()\[\]]/g
export function getSymbolsForSnippet(snippet: string): Set<string> {
	const symbols = snippet
		.split(rx)
		.map((s) => s.trim())
		.filter((s) => s !== "")
	return new Set(symbols)
}

/**
 * Calculate similarity as number of shared symbols divided by total number of unique symbols between both.
 */
function jaccardSimilarity(a: string, b: string): number {
	const aSet = getSymbolsForSnippet(a)
	const bSet = getSymbolsForSnippet(b)
	const union = new Set([...aSet, ...bSet]).size

	// Avoid division by zero
	if (union === 0) {
		return 0
	}

	let intersection = 0
	for (const symbol of aSet) {
		if (bSet.has(symbol)) {
			intersection++
		}
	}

	return intersection / union
}

/**
 * Rank code snippets to be used in tab-autocomplete prompt. Returns a sorted version of the snippet array.
 */
export function rankAndOrderSnippets(
	ranges: AutocompleteSnippetWithScore[],
	helper: HelperVars,
): Required<AutocompleteSnippetWithScore>[] {
	const windowAroundCursor =
		helper.fullPrefix.slice(-helper.options.slidingWindowSize * helper.options.slidingWindowPrefixPercentage) +
		helper.fullSuffix.slice(helper.options.slidingWindowSize * (1 - helper.options.slidingWindowPrefixPercentage))

	const snippets: Required<AutocompleteSnippetWithScore>[] = ranges.map((snippet) => ({
		score: snippet.score ?? jaccardSimilarity(snippet.contents, windowAroundCursor),
		...snippet,
	}))
	const uniqueSnippets = deduplicateSnippets(snippets)
	return uniqueSnippets.sort((a, b) => a.score - b.score)
}

/**
 * Deduplicate code snippets by merging overlapping ranges into a single range.
 */
function deduplicateSnippets(snippets: Required<AutocompleteSnippetWithScore>[]): Required<AutocompleteSnippetWithScore>[] {
	// Group by file
	const fileGroups: {
		[key: string]: Required<AutocompleteSnippetWithScore>[]
	} = {}
	for (const snippet of snippets) {
		if (!fileGroups[snippet.filepath]) {
			fileGroups[snippet.filepath] = []
		}
		fileGroups[snippet.filepath].push(snippet)
	}

	// Merge overlapping ranges
	const allRanges = []
	for (const file of Object.keys(fileGroups)) {
		allRanges.push(...mergeSnippetsByRange(fileGroups[file]))
	}
	return allRanges
}

function mergeSnippetsByRange(snippets: Required<AutocompleteSnippetWithScore>[]): Required<AutocompleteSnippetWithScore>[] {
	if (snippets.length <= 1) {
		return snippets
	}

	const sorted = snippets.sort((a, b) => a.range.start.line - b.range.start.line)
	const merged: Required<AutocompleteSnippetWithScore>[] = []

	while (sorted.length > 0) {
		const next = sorted.shift()!
		const last = merged[merged.length - 1]
		if (merged.length > 0 && last.range.end.line >= next.range.start.line) {
			// Merge with previous snippet
			last.score = Math.max(last.score, next.score)
			try {
				last.range.end = next.range.end
			} catch (e) {
				console.log("Error merging ranges", e)
			}
			last.contents = mergeOverlappingRangeContents(last, next)
		} else {
			merged.push(next)
		}
	}

	return merged
}

function mergeOverlappingRangeContents(first: RangeInFileWithContents, second: RangeInFileWithContents): string {
	const firstLines = first.contents.split("\n")
	const numOverlapping = first.range.end.line - second.range.start.line
	return `${firstLines.slice(-numOverlapping).join("\n")}\n${second.contents}`
}

/**
 * Fill the allowed space with snippets.
 * It is assumed that the snippets are sorted by score.
 */
export function fillPromptWithSnippets(
	snippets: Required<AutocompleteSnippetWithScore>[],
	maxSnippetTokens: number,
	modelName: string,
): Required<AutocompleteSnippetWithScore>[] {
	let tokensRemaining = maxSnippetTokens
	const keptSnippets: Required<AutocompleteSnippetWithScore>[] = []
	for (let i = 0; i < snippets.length; i++) {
		const snippet = snippets[i]
		const tokenCount = countTokens(snippet.contents, modelName)
		if (tokensRemaining - tokenCount >= 0) {
			tokensRemaining -= tokenCount
			keptSnippets.push(snippet)
		} else {
		}
	}

	return keptSnippets
}
