import { compareTwoStrings } from "string-similarity"
import { closest } from "fastest-levenshtein"
import { diff_match_patch } from "diff-match-patch"
import { Change, Hunk } from "./types"

export type SearchResult = {
	index: number
	confidence: number
	strategy: string
}

//TODO: this should be configurable
const MIN_CONFIDENCE = 0.97
const MIN_CONFIDENCE_LARGE_FILE = 0.9
const LARGE_FILE_THRESHOLD = 1000 // lines
const UNIQUE_CONTENT_BOOST = 0.05
const DEFAULT_OVERLAP_SIZE = 3 // lines of overlap between windows
const MAX_WINDOW_SIZE = 500 // maximum lines in a window

// Helper function to calculate adaptive confidence threshold based on file size
function getAdaptiveThreshold(contentLength: number): number {
	if (contentLength <= LARGE_FILE_THRESHOLD) {
		return MIN_CONFIDENCE
	}
	return MIN_CONFIDENCE_LARGE_FILE
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
// Returns a confidence reduction value between 0 and 1
// Example: If similarity is 0.8 and MIN_CONFIDENCE is 0.95,
// returns 0.1 (0.5 * (1 - 0.8)) to reduce confidence proportionally but with less impact.
// If similarity >= MIN_CONFIDENCE, returns 0 (no reduction).
export function validateEditResult(hunk: Hunk, result: string, strategy: string): number {
	const hunkDeepCopy: Hunk = JSON.parse(JSON.stringify(hunk))

	// Create skeleton of original content (context + removed lines)
	const originalSkeleton = hunkDeepCopy.changes
		.filter((change) => change.type === "context" || change.type === "remove")
		.map((change) => change.content)
		.join("\n")

	// Create skeleton of expected result (context + added lines)
	const expectedSkeleton = hunkDeepCopy.changes
		.filter((change) => change.type === "context" || change.type === "add")
		.map((change) => change.content)
		.join("\n")

	// Compare with original content
	const originalSimilarity = evaluateSimilarity(originalSkeleton, result)
	console.log("originalSimilarity ", strategy, originalSimilarity)

	// Compare with expected result
	const expectedSimilarity = evaluateSimilarity(expectedSkeleton, result)

	console.log("expectedSimilarity", strategy, expectedSimilarity)
	console.log("result", result)

	// If original similarity is 1 and expected similarity is not 1, it means changes weren't applied
	if (originalSimilarity > 0.97 && expectedSimilarity !== 1) {
		if (originalSimilarity === 1) {
			// If original similarity is 1, it means changes weren't applied
			if (originalSimilarity > 0.97) {
				if (originalSimilarity === 1) {
					return 0.5 // Significant confidence reduction
				} else {
					return 0.8
				}
			}
		} else {
			return 0.8
		}
	}

	// Scale between 0.98 and 1.0 (4% impact) based on expected similarity
	const multiplier = expectedSimilarity < MIN_CONFIDENCE ? 0.96 + 0.04 * expectedSimilarity : 1

	return multiplier
}

// Helper function to validate context lines against original content
function validateContextLines(searchStr: string, content: string): number {
	// Extract just the context lines from the search string
	const contextLines = searchStr.split("\n").filter((line) => !line.startsWith("-")) // Exclude removed lines

	// Compare context lines with content
	const similarity = evaluateSimilarity(contextLines.join("\n"), content)

	// Get adaptive threshold based on content size
	const threshold = getAdaptiveThreshold(content.split("\n").length)

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
	overlapSize: number = DEFAULT_OVERLAP_SIZE
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
	overlapSize: number = DEFAULT_OVERLAP_SIZE
): SearchResult[] {
	if (matches.length === 0) {
		return []
	}

	// Sort matches by confidence
	matches.sort((a, b) => b.confidence - a.confidence)

	const combinedMatches: SearchResult[] = []
	const usedIndices = new Set<number>()

	for (const match of matches) {
		if (usedIndices.has(match.windowIndex)) {continue}

		// Find overlapping matches
		const overlapping = matches.filter(
			(m) =>
				Math.abs(m.windowIndex - match.windowIndex) === 1 &&
				Math.abs(m.index - match.index) <= overlapSize &&
				!usedIndices.has(m.windowIndex)
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

// Modified search functions to use sliding windows
export function findExactMatch(searchStr: string, content: string[], startIndex: number = 0): SearchResult {
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
					windowStr.slice(0, exactMatch).split("\n").length - 1 + searchLines.length
				)
				.join("\n")

			const similarity = getDMPSimilarity(searchStr, matchedContent)
			const contextSimilarity = validateContextLines(searchStr, matchedContent)
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
export function findSimilarityMatch(searchStr: string, content: string[], startIndex: number = 0): SearchResult {
	const searchLines = searchStr.split("\n")
	let bestScore = 0
	let bestIndex = -1
	const minScore = 0.8

	for (let i = startIndex; i < content.length - searchLines.length + 1; i++) {
		const windowStr = content.slice(i, i + searchLines.length).join("\n")
		const score = compareTwoStrings(searchStr, windowStr)
		if (score > bestScore && score >= minScore) {
			const similarity = getDMPSimilarity(searchStr, windowStr)
			const contextSimilarity = validateContextLines(searchStr, windowStr)
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
export function findLevenshteinMatch(searchStr: string, content: string[], startIndex: number = 0): SearchResult {
	const searchLines = searchStr.split("\n")
	const candidates = []

	for (let i = startIndex; i < content.length - searchLines.length + 1; i++) {
		candidates.push(content.slice(i, i + searchLines.length).join("\n"))
	}

	if (candidates.length > 0) {
		const closestMatch = closest(searchStr, candidates)
		const index = startIndex + candidates.indexOf(closestMatch)
		const similarity = getDMPSimilarity(searchStr, closestMatch)
		const contextSimilarity = validateContextLines(searchStr, closestMatch)
		const confidence = Math.min(similarity, contextSimilarity)
		return {
			index,
			confidence: index !== -1 ? confidence : 0,
			strategy: "levenshtein",
		}
	}

	return { index: -1, confidence: 0, strategy: "levenshtein" }
}

// Helper function to identify anchor lines based on uniqueness and complexity
function identifyAnchors(searchStr: string, content: string[]): { line: string; index: number; weight: number }[] {
	const searchLines = searchStr.split("\n")
	const contentStr = content.join("\n")
	const anchors: { line: string; index: number; weight: number }[] = []

	for (let i = 0; i < searchLines.length; i++) {
		const line = searchLines[i]
		if (!line.trim()) {continue} // Skip empty lines

		// Calculate line complexity (more special chars = more unique)
		const specialChars = (line.match(/[^a-zA-Z0-9\s]/g) || []).length
		const complexity = specialChars / line.length

		// Count occurrences in content
		const regex = new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
		const matches = contentStr.match(regex)
		const occurrences = matches ? matches.length : 0

		// Calculate uniqueness weight
		const uniquenessWeight = occurrences <= 1 ? 1 : 1 / occurrences
		const weight = uniquenessWeight * (0.7 + 0.3 * complexity)

		if (weight > 0.5) {
			// Only consider lines with high enough weight
			anchors.push({ line, index: i, weight })
		}
	}

	// Sort by weight descending
	return anchors.sort((a, b) => b.weight - a.weight)
}

// Helper function to validate anchor positions
function validateAnchorPositions(
	anchors: { line: string; index: number }[],
	content: string[],
	searchLines: string[]
): number {
	for (const anchor of anchors) {
		const anchorIndex = content.findIndex((line) => line === anchor.line)
		if (anchorIndex !== -1) {
			// Check if surrounding context matches
			const contextBefore = searchLines.slice(Math.max(0, anchor.index - 2), anchor.index).join("\n")
			const contextAfter = searchLines.slice(anchor.index + 1, anchor.index + 3).join("\n")
			const contentBefore = content.slice(Math.max(0, anchorIndex - 2), anchorIndex).join("\n")
			const contentAfter = content.slice(anchorIndex + 1, anchorIndex + 3).join("\n")

			const beforeSimilarity = evaluateSimilarity(contextBefore, contentBefore)
			const afterSimilarity = evaluateSimilarity(contextAfter, contentAfter)

			if (beforeSimilarity > 0.8 && afterSimilarity > 0.8) {
				return anchorIndex - anchor.index
			}
		}
	}
	return -1
}

// Anchor-based search strategy
export function findAnchorMatch(searchStr: string, content: string[], startIndex: number = 0): SearchResult {
	const searchLines = searchStr.split("\n")
	const anchors = identifyAnchors(searchStr, content.slice(startIndex))

	if (anchors.length === 0) {
		return { index: -1, confidence: 0, strategy: "anchor" }
	}

	// Try to validate position using top anchors
	const offset = validateAnchorPositions(anchors.slice(0, 3), content.slice(startIndex), searchLines)

	if (offset !== -1) {
		const matchPosition = startIndex + offset
		const matchedContent = content.slice(matchPosition, matchPosition + searchLines.length).join("\n")
		const similarity = getDMPSimilarity(searchStr, matchedContent)
		const contextSimilarity = validateContextLines(searchStr, matchedContent)
		const confidence = Math.min(similarity, contextSimilarity) * (1 + anchors[0].weight * 0.1) // Boost confidence based on anchor weight

		return {
			index: matchPosition,
			confidence: Math.min(1, confidence), // Cap at 1
			strategy: "anchor",
		}
	}

	return { index: -1, confidence: 0, strategy: "anchor" }
}

// Main search function that tries all strategies
export function findBestMatch(searchStr: string, content: string[], startIndex: number = 0): SearchResult {
	const strategies = [findExactMatch, findAnchorMatch, findSimilarityMatch, findLevenshteinMatch]

	let bestResult: SearchResult = { index: -1, confidence: 0, strategy: "none" }

	for (const strategy of strategies) {
		const result = strategy(searchStr, content, startIndex)
		console.log("Search result:", result)
		if (result.confidence > bestResult.confidence) {
			bestResult = result
		}
	}

	return bestResult
}
