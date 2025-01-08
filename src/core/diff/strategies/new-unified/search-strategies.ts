import { compareTwoStrings } from 'string-similarity';
import { closest } from 'fastest-levenshtein';
import { diff_match_patch } from 'diff-match-patch';
import { Change } from './types';

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
    .filter(c => c.type === 'context' || c.type === 'remove')
    .map(c => c.content);
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

// Exact match strategy
export function findExactMatch(searchStr: string, content: string[], startIndex: number = 0): SearchResult {
  const contentStr = content.slice(startIndex).join('\n');
  const searchLines = searchStr.split('\n');
  
  const exactMatch = contentStr.indexOf(searchStr);
  if (exactMatch !== -1) {
    const matchedContent = content.slice(
      startIndex + contentStr.slice(0, exactMatch).split('\n').length - 1,
      startIndex + contentStr.slice(0, exactMatch).split('\n').length - 1 + searchLines.length
    ).join('\n');
    
    const dmpValid = getDMPSimilarity(searchStr, matchedContent) >= MIN_CONFIDENCE;
    return {
      index: startIndex + contentStr.slice(0, exactMatch).split('\n').length - 1,
      confidence: dmpValid ? 1.0 : 0.9,
      strategy: 'exact'
    };
  }
  
  return { index: -1, confidence: 0, strategy: 'exact' };
}

// String similarity strategy
export function findSimilarityMatch(searchStr: string, content: string[], startIndex: number = 0): SearchResult {
  const searchLines = searchStr.split('\n');
  let bestScore = 0;
  let bestIndex = -1;
  const minScore = 0.8;

  for (let i = startIndex; i < content.length - searchLines.length + 1; i++) {
    const windowStr = content.slice(i, i + searchLines.length).join('\n');
    const score = compareTwoStrings(searchStr, windowStr);
    if (score > bestScore && score >= minScore) {
      const dmpValid = getDMPSimilarity(searchStr, windowStr) >= MIN_CONFIDENCE;
      const adjustedScore = dmpValid ? score : score * 0.9;
      
      if (adjustedScore > bestScore) {
        bestScore = adjustedScore;
        bestIndex = i;
      }
    }
  }

  return { 
    index: bestIndex, 
    confidence: bestIndex !== -1 ? bestScore : 0,
    strategy: 'similarity'
  };
}

// Levenshtein strategy
export function findLevenshteinMatch(searchStr: string, content: string[], startIndex: number = 0): SearchResult {
  const searchLines = searchStr.split('\n');
  const candidates = [];
  
  for (let i = startIndex; i < content.length - searchLines.length + 1; i++) {
    candidates.push(content.slice(i, i + searchLines.length).join('\n'));
  }
  
  if (candidates.length > 0) {
    const closestMatch = closest(searchStr, candidates);
    const index = startIndex + candidates.indexOf(closestMatch);
    const dmpValid = getDMPSimilarity(searchStr, closestMatch) >= MIN_CONFIDENCE;
    return { 
      index, 
      confidence: dmpValid ? 0.7 : 0.6,
      strategy: 'levenshtein'
    };
  }

  return { index: -1, confidence: 0, strategy: 'levenshtein' };
}

// Main search function that tries all strategies
export function findBestMatch(searchStr: string, content: string[], startIndex: number = 0): SearchResult {
  const strategies = [
    findExactMatch,
    findSimilarityMatch,
    findLevenshteinMatch
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