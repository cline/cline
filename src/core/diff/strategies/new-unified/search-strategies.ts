import { compareTwoStrings } from "string-similarity"
import { closest } from "fastest-levenshtein"
import { diff_match_patch } from "diff-match-patch"
import { Change, Hunk } from "./types"

export type SearchResult = {
	index: number
	confidence: number
	strategy: string
}

const LARGE_FILE_THRESHOLD = 1000 // lines
const UNIQUE_CONTENT_BOOST = 0.05
const DEFAULT_OVERLAP_SIZE = 3 // lines of overlap between windows
const MAX_WINDOW_SIZE = 500 // maximum lines in a window

// Helper function to calculate adaptive confidence threshold based on file size
function getAdaptiveThreshold(contentLength: number, baseThreshold: number): number {
	if (contentLength <= LARGE_FILE_THRESHOLD) {
		return baseThreshold
	}
	return Math.max(baseThreshold - 0.07, 0.8) // Reduce threshold for large files but keep minimum at 80%
}

// Helper function to evaluate content uniqueness
function evaluateContentUniqueness(searchStr: string, content: string[]): number {
	const searchLines = searchStr.split("\n")
	const uniqueLines = new Set(searchLines)
	const contentStr = content.join("\n")

	// Calculate how many search lines are relatively unique in the content
	let uniqueCount = 0
	for (const line of uniqueLines) {
		const regex = new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
		const matches = contentStr.match(regex)
		if (matches && matches.length <= 2) {
			// Line appears at most twice
			uniqueCount++
		}
	}

	return uniqueCount / uniqueLines.size
}

// Helper function to prepare search string from context
export function prepareSearchString(changes: Change[]): string {
	const lines = changes.filter((c) => c.type === "context" || c.type === "remove").map((c) => c.originalLine)
	return lines.join("\n")
}

// Helper function to evaluate similarity between two texts
export function evaluateSimilarity(original: string, modified: string): number {
	return compareTwoStrings(original, modified)
}

// Helper function to validate using diff-match-patch
export function getDMPSimilarity(original: string, modified: string): number {
	const dmp = new diff_match_patch()
	const diffs = dmp.diff_main(original, modified)
	dmp.diff_cleanupSemantic(diffs)
	const patches = dmp.patch_make(original, diffs)
	const [expectedText] = dmp.patch_apply(patches, original)

	const similarity = evaluateSimilarity(expectedText, modified)
	return similarity
}

// Helper function to validate edit results using hunk information
export function validateEditResult(hunk: Hunk, result: string): number {
	// Build the expected text from the hunk
	const expectedText = hunk.changes
		.filter((change) => change.type === "context" || change.type === "add")
		.map((change) => (change.indent ? change.indent + change.content : change.content))
		.join("\n")

	// Calculate similarity between the result and expected text
	const similarity = getDMPSimilarity(expectedText, result)

	// If the result is unchanged from original, return low confidence
	const originalText = hunk.changes
		.filter((change) => change.type === "context" || change.type === "remove")
		.map((change) => (change.indent ? change.indent + change.content : change.content))
		.join("\n")

	const originalSimilarity = getDMPSimilarity(originalText, result)
	if (originalSimilarity > 0.97 && similarity !== 1) {
		return 0.8 * similarity // Some confidence since we found the right location
	}

	// For partial matches, scale the confidence but keep it high if we're close
	return similarity
}

// Helper function to validate context lines against original content
function validateContextLines(searchStr: string, content: string, confidenceThreshold: number): number {
	// Extract just the context lines from the search string
	const contextLines = searchStr.split("\n").filter((line) => !line.startsWith("-")) // Exclude removed lines

	// Compare context lines with content
	const similarity = evaluateSimilarity(contextLines.join("\n"), content)

	// Get adaptive threshold based on content size
	const threshold = getAdaptiveThreshold(content.split("\n").length, confidenceThreshold)

	// Calculate uniqueness boost
	const uniquenessScore = evaluateContentUniqueness(searchStr, content.split("\n"))
	const uniquenessBoost = uniquenessScore * UNIQUE_CONTENT_BOOST

	// Adjust confidence based on threshold and uniqueness
	return similarity < threshold ? similarity * 0.3 + uniquenessBoost : similarity + uniquenessBoost
}

// Helper function to create overlapping windows
function createOverlappingWindows(
	content: string[],
	searchSize: number,
	overlapSize: number = DEFAULT_OVERLAP_SIZE,
): { window: string[]; startIndex: number }[] {
	const windows: { window: string[]; startIndex: number }[] = []

	// Ensure minimum window size is at least searchSize
	const effectiveWindowSize = Math.max(searchSize, Math.min(searchSize * 2, MAX_WINDOW_SIZE))

	// Ensure overlap size doesn't exceed window size
	const effectiveOverlapSize = Math.min(overlapSize, effectiveWindowSize - 1)

	// Calculate step size, ensure it's at least 1
	const stepSize = Math.max(1, effectiveWindowSize - effectiveOverlapSize)

	for (let i = 0; i < content.length; i += stepSize) {
		const windowContent = content.slice(i, i + effectiveWindowSize)
		if (windowContent.length >= searchSize) {
			windows.push({ window: windowContent, startIndex: i })
		}
	}

	return windows
}

// Helper function to combine overlapping matches
function combineOverlappingMatches(
	matches: (SearchResult & { windowIndex: number })[],
	overlapSize: number = DEFAULT_OVERLAP_SIZE,
): SearchResult[] {
	if (matches.length === 0) {
		return []
	}

	// Sort matches by confidence
	matches.sort((a, b) => b.confidence - a.confidence)

	const combinedMatches: SearchResult[] = []
	const usedIndices = new Set<number>()

	for (const match of matches) {
		if (usedIndices.has(match.windowIndex)) {
			continue
		}

		// Find overlapping matches
		const overlapping = matches.filter(
			(m) =>
				Math.abs(m.windowIndex - match.windowIndex) === 1 &&
				Math.abs(m.index - match.index) <= overlapSize &&
				!usedIndices.has(m.windowIndex),
		)

		if (overlapping.length > 0) {
			// Boost confidence if we find same match in overlapping windows
			const avgConfidence =
				(match.confidence + overlapping.reduce((sum, m) => sum + m.confidence, 0)) / (overlapping.length + 1)
			const boost = Math.min(0.05 * overlapping.length, 0.1) // Max 10% boost

			combinedMatches.push({
				index: match.index,
				confidence: Math.min(1, avgConfidence + boost),
				strategy: `${match.strategy}-overlapping`,
			})

			usedIndices.add(match.windowIndex)
			overlapping.forEach((m) => usedIndices.add(m.windowIndex))
		} else {
			combinedMatches.push({
				index: match.index,
				confidence: match.confidence,
				strategy: match.strategy,
			})
			usedIndices.add(match.windowIndex)
		}
	}

	return combinedMatches
}

export function findExactMatch(
	searchStr: string,
	content: string[],
	startIndex: number = 0,
	confidenceThreshold: number = 0.97,
): SearchResult {
	const searchLines = searchStr.split("\n")
	const windows = createOverlappingWindows(content.slice(startIndex), searchLines.length)
	const matches: (SearchResult & { windowIndex: number })[] = []

	windows.forEach((windowData, windowIndex) => {
		const windowStr = windowData.window.join("\n")
		const exactMatch = windowStr.indexOf(searchStr)

		if (exactMatch !== -1) {
			const matchedContent = windowData.window
				.slice(
					windowStr.slice(0, exactMatch).split("\n").length - 1,
					windowStr.slice(0, exactMatch).split("\n").length - 1 + searchLines.length,
				)
				.join("\n")

			const similarity = getDMPSimilarity(searchStr, matchedContent)
			const contextSimilarity = validateContextLines(searchStr, matchedContent, confidenceThreshold)
			const confidence = Math.min(similarity, contextSimilarity)

			matches.push({
				index: startIndex + windowData.startIndex + windowStr.slice(0, exactMatch).split("\n").length - 1,
				confidence,
				strategy: "exact",
				windowIndex,
			})
		}
	})

	const combinedMatches = combineOverlappingMatches(matches)
	return combinedMatches.length > 0 ? combinedMatches[0] : { index: -1, confidence: 0, strategy: "exact" }
}

// String similarity strategy
export function findSimilarityMatch(
	searchStr: string,
	content: string[],
	startIndex: number = 0,
	confidenceThreshold: number = 0.97,
): SearchResult {
	const searchLines = searchStr.split("\n")
	let bestScore = 0
	let bestIndex = -1

	for (let i = startIndex; i < content.length - searchLines.length + 1; i++) {
		const windowStr = content.slice(i, i + searchLines.length).join("\n")
		const score = compareTwoStrings(searchStr, windowStr)
		if (score > bestScore && score >= confidenceThreshold) {
			const similarity = getDMPSimilarity(searchStr, windowStr)
			const contextSimilarity = validateContextLines(searchStr, windowStr, confidenceThreshold)
			const adjustedScore = Math.min(similarity, contextSimilarity) * score

			if (adjustedScore > bestScore) {
				bestScore = adjustedScore
				bestIndex = i
			}
		}
	}

	return {
		index: bestIndex,
		confidence: bestIndex !== -1 ? bestScore : 0,
		strategy: "similarity",
	}
}

// Levenshtein strategy
export function findLevenshteinMatch(
	searchStr: string,
	content: string[],
	startIndex: number = 0,
	confidenceThreshold: number = 0.97,
): SearchResult {
	const searchLines = searchStr.split("\n")
	const candidates = []

	for (let i = startIndex; i < content.length - searchLines.length + 1; i++) {
		candidates.push(content.slice(i, i + searchLines.length).join("\n"))
	}

	if (candidates.length > 0) {
		const closestMatch = closest(searchStr, candidates)
		const index = startIndex + candidates.indexOf(closestMatch)
		const similarity = getDMPSimilarity(searchStr, closestMatch)
		const contextSimilarity = validateContextLines(searchStr, closestMatch, confidenceThreshold)
		const confidence = Math.min(similarity, contextSimilarity)
		return {
			index: confidence === 0 ? -1 : index,
			confidence: index !== -1 ? confidence : 0,
			strategy: "levenshtein",
		}
	}

	return { index: -1, confidence: 0, strategy: "levenshtein" }
}

// Helper function to identify anchor lines
function identifyAnchors(searchStr: string): { first: string | null; last: string | null } {
	const searchLines = searchStr.split("\n")
	let first: string | null = null
	let last: string | null = null

	// Find the first non-empty line
	for (const line of searchLines) {
		if (line.trim()) {
			first = line
			break
		}
	}

	// Find the last non-empty line
	for (let i = searchLines.length - 1; i >= 0; i--) {
		if (searchLines[i].trim()) {
			last = searchLines[i]
			break
		}
	}

	return { first, last }
}

// Anchor-based search strategy
export function findAnchorMatch(
	searchStr: string,
	content: string[],
	startIndex: number = 0,
	confidenceThreshold: number = 0.97,
): SearchResult {
	const searchLines = searchStr.split("\n")
	const { first, last } = identifyAnchors(searchStr)

	if (!first || !last) {
		return { index: -1, confidence: 0, strategy: "anchor" }
	}

	let firstIndex = -1
	let lastIndex = -1

	// Check if the first anchor is unique
	let firstOccurrences = 0
	for (const contentLine of content) {
		if (contentLine === first) {
			firstOccurrences++
		}
	}

	if (firstOccurrences !== 1) {
		return { index: -1, confidence: 0, strategy: "anchor" }
	}

	// Find the first anchor
	for (let i = startIndex; i < content.length; i++) {
		if (content[i] === first) {
			firstIndex = i
			break
		}
	}

	// Find the last anchor
	for (let i = content.length - 1; i >= startIndex; i--) {
		if (content[i] === last) {
			lastIndex = i
			break
		}
	}

	if (firstIndex === -1 || lastIndex === -1 || lastIndex <= firstIndex) {
		return { index: -1, confidence: 0, strategy: "anchor" }
	}

	// Validate the context
	const expectedContext = searchLines.slice(searchLines.indexOf(first) + 1, searchLines.indexOf(last)).join("\n")
	const actualContext = content.slice(firstIndex + 1, lastIndex).join("\n")
	const contextSimilarity = evaluateSimilarity(expectedContext, actualContext)

	if (contextSimilarity < getAdaptiveThreshold(content.length, confidenceThreshold)) {
		return { index: -1, confidence: 0, strategy: "anchor" }
	}

	const confidence = 1

	return {
		index: firstIndex,
		confidence: confidence,
		strategy: "anchor",
	}
}

// Main search function that tries all strategies
export function findBestMatch(
	searchStr: string,
	content: string[],
	startIndex: number = 0,
	confidenceThreshold: number = 0.97,
): SearchResult {
	const strategies = [findExactMatch, findAnchorMatch, findSimilarityMatch, findLevenshteinMatch]

	let bestResult: SearchResult = { index: -1, confidence: 0, strategy: "none" }

	for (const strategy of strategies) {
		const result = strategy(searchStr, content, startIndex, confidenceThreshold)
		if (result.confidence > bestResult.confidence) {
			bestResult = result
		}
	}

	return bestResult
}
