import { compareTwoStrings } from 'string-similarity';
import { closest } from 'fastest-levenshtein';
import { diff_match_patch } from 'diff-match-patch';
import { Change, Hunk } from './types';

export type SearchResult = {
  index: number;
  confidence: number;
  strategy: string;
};

//TODO: this should be configurable
const MIN_CONFIDENCE = 0.95;

// Helper function to prepare search string from context
export function prepareSearchString(changes: Change[]): string {
  const lines = changes
    .filter((c) => c.type === 'context' || c.type === 'remove')
    .map((c) => c.content);
  return lines.join('\n');
}

// Helper function to evaluate similarity between two texts
export function evaluateSimilarity(original: string, modified: string): number {
  return compareTwoStrings(original, modified);
}

// Helper function to validate using diff-match-patch
export function getDMPSimilarity(original: string, modified: string): number {
  const dmp = new diff_match_patch();
  const diffs = dmp.diff_main(original, modified);
  dmp.diff_cleanupSemantic(diffs);
  const patches = dmp.patch_make(original, diffs);
  const [expectedText] = dmp.patch_apply(patches, original);

  const similarity = evaluateSimilarity(expectedText, modified);
  return similarity;
}

// Helper function to validate edit results using hunk information
// Returns a confidence reduction value between 0 and 1
// Example: If similarity is 0.8 and MIN_CONFIDENCE is 0.95,
// returns 0.1 (0.5 * (1 - 0.8)) to reduce confidence proportionally but with less impact.
// If similarity >= MIN_CONFIDENCE, returns 0 (no reduction).
export function validateEditResult(hunk: Hunk, result: string, strategy: string): number {
  const hunkDeepCopy: Hunk = JSON.parse(JSON.stringify(hunk));

  // Create skeleton of original content (context + removed lines)
  const originalSkeleton = hunkDeepCopy.changes
    .filter((change) => change.type === 'context' || change.type === 'remove')
    .map((change) => change.content)
    .join('\n');

  // Create skeleton of expected result (context + added lines)
  const expectedSkeleton = hunkDeepCopy.changes
    .filter((change) => change.type === 'context' || change.type === 'add')
    .map((change) => change.content)
    .join('\n');

  // Compare with original content
  const originalSimilarity = evaluateSimilarity(originalSkeleton, result);
  console.log('originalSimilarity ', strategy, originalSimilarity);
  // If original similarity is 1, it means changes weren't applied
  if (originalSimilarity > 0.97) {
    if (originalSimilarity === 1) {
      return 0.5; // Significant confidence reduction
    } else {
      return 0.8;
    }
  }

  // Compare with expected result
  const expectedSimilarity = evaluateSimilarity(expectedSkeleton, result);

  console.log('expectedSimilarity', strategy, expectedSimilarity);
  

  // Scale between 0.98 and 1.0 (4% impact) based on expected similarity
  const multiplier =
    expectedSimilarity < MIN_CONFIDENCE ? 0.96 + 0.04 * expectedSimilarity : 1;

  return multiplier;
}

// Helper function to validate context lines against original content
function validateContextLines(searchStr: string, content: string): number {
  // Extract just the context lines from the search string
  const contextLines = searchStr
    .split('\n')
    .filter((line) => !line.startsWith('-')); // Exclude removed lines

  // Compare context lines with content
  const similarity = evaluateSimilarity(contextLines.join('\n'), content);

  // Context lines must match very closely, or confidence drops significantly
  return similarity < MIN_CONFIDENCE ? similarity * 0.3 : similarity;
}

// Exact match strategy
export function findExactMatch(
  searchStr: string,
  content: string[],
  startIndex: number = 0
): SearchResult {
  const contentStr = content.slice(startIndex).join('\n');
  const searchLines = searchStr.split('\n');

  const exactMatch = contentStr.indexOf(searchStr);
  if (exactMatch !== -1) {
    const matchedContent = content
      .slice(
        startIndex + contentStr.slice(0, exactMatch).split('\n').length - 1,
        startIndex +
          contentStr.slice(0, exactMatch).split('\n').length -
          1 +
          searchLines.length
      )
      .join('\n');

    const similarity = getDMPSimilarity(searchStr, matchedContent);
    const contextSimilarity = validateContextLines(searchStr, matchedContent);
    const confidence = Math.min(similarity, contextSimilarity);

    return {
      index:
        startIndex + contentStr.slice(0, exactMatch).split('\n').length - 1,
      confidence,
      strategy: 'exact',
    };
  }

  return { index: -1, confidence: 0, strategy: 'exact' };
}

// String similarity strategy
export function findSimilarityMatch(
  searchStr: string,
  content: string[],
  startIndex: number = 0
): SearchResult {
  const searchLines = searchStr.split('\n');
  let bestScore = 0;
  let bestIndex = -1;
  const minScore = 0.8;

  for (let i = startIndex; i < content.length - searchLines.length + 1; i++) {
    const windowStr = content.slice(i, i + searchLines.length).join('\n');
    const score = compareTwoStrings(searchStr, windowStr);
    if (score > bestScore && score >= minScore) {
      const similarity = getDMPSimilarity(searchStr, windowStr);
      const contextSimilarity = validateContextLines(searchStr, windowStr);
      const adjustedScore = Math.min(similarity, contextSimilarity) * score;

      if (adjustedScore > bestScore) {
        bestScore = adjustedScore;
        bestIndex = i;
      }
    }
  }

  return {
    index: bestIndex,
    confidence: bestIndex !== -1 ? bestScore : 0,
    strategy: 'similarity',
  };
}

// Levenshtein strategy
export function findLevenshteinMatch(
  searchStr: string,
  content: string[],
  startIndex: number = 0
): SearchResult {
  const searchLines = searchStr.split('\n');
  const candidates = [];

  for (let i = startIndex; i < content.length - searchLines.length + 1; i++) {
    candidates.push(content.slice(i, i + searchLines.length).join('\n'));
  }

  if (candidates.length > 0) {
    const closestMatch = closest(searchStr, candidates);
    const index = startIndex + candidates.indexOf(closestMatch);
    const similarity = getDMPSimilarity(searchStr, closestMatch);
    const contextSimilarity = validateContextLines(searchStr, closestMatch);
    const confidence = Math.min(similarity, contextSimilarity) * 0.7; // Still apply Levenshtein penalty

    return {
      index,
      confidence,
      strategy: 'levenshtein',
    };
  }

  return { index: -1, confidence: 0, strategy: 'levenshtein' };
}

// Main search function that tries all strategies
export function findBestMatch(
  searchStr: string,
  content: string[],
  startIndex: number = 0
): SearchResult {
  const strategies = [
    findExactMatch,
    findSimilarityMatch,
    findLevenshteinMatch,
  ];

  let bestResult: SearchResult = { index: -1, confidence: 0, strategy: 'none' };

  for (const strategy of strategies) {
    const result = strategy(searchStr, content, startIndex);
    if (result.confidence > bestResult.confidence) {
      bestResult = result;
    }
  }

  return bestResult;
}
