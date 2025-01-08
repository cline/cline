import { diff_match_patch } from 'diff-match-patch';
import * as git from 'isomorphic-git';
import { fs as memfs, vol } from 'memfs';
import { Change, EditResult, Hunk } from './types';
import { getDMPSimilarity, validateEditResult } from './search-strategies';

// Helper function to infer indentation
function inferIndentation(line: string, contextLines: string[], previousIndent: string = ''): string {
  const match = line.match(/^(\s+)/);
  if (match) {
    return match[1];
  }

  for (const contextLine of contextLines) {
    const contextMatch = contextLine.match(/^(\s+)/);
    if (contextMatch) {
      const currentLineDepth = (line.match(/^\s*/)?.[0] || '').length;
      const contextLineDepth = contextMatch[1].length;
      
      if (currentLineDepth > contextLineDepth) {
        return contextMatch[1] + ' '.repeat(2);
      }
      return contextMatch[1];
    }
  }

  return previousIndent;
}

// Context matching edit strategy
export function applyContextMatching(hunk: Hunk, content: string[], matchPosition: number): EditResult {
  if (matchPosition === -1) {
    return { confidence: 0, result: content, strategy: 'context' };
  }

  const newResult = [...content.slice(0, matchPosition)];
  let sourceIndex = matchPosition;
  let previousIndent = '';
  let lastChangeWasRemove = false;  // Track if last change was a remove

  for (const change of hunk.changes) {

    if (change.type === 'context') {
      newResult.push(change.originalLine || (change.indent + change.content));
      previousIndent = change.indent;
      if (!lastChangeWasRemove) {  // Only increment if we didn't just remove a line
        sourceIndex++;
      }
      lastChangeWasRemove = false;
    } else if (change.type === 'add') {
      const indent = change.indent || inferIndentation(change.content, 
        hunk.changes.filter(c => c.type === 'context' && c.originalLine).map(c => c.originalLine || ''),
        previousIndent
      );
      newResult.push(indent + change.content);
      previousIndent = indent;
      lastChangeWasRemove = false;
    } else if (change.type === 'remove') {
      sourceIndex++;
      lastChangeWasRemove = true;
    }
  }

  newResult.push(...content.slice(sourceIndex));
  
  // Calculate the window size based on all changes
  const windowSize = hunk.changes.length;
  
  // Validate the result using the full window size
  const similarity = getDMPSimilarity(
    content.slice(matchPosition, matchPosition + windowSize).join('\n'),
    newResult.slice(matchPosition, matchPosition + windowSize).join('\n')
  )

  const confidence = validateEditResult(hunk, newResult.slice(matchPosition, matchPosition + windowSize).join('\n'), 'context');

  return { 
    confidence: similarity * confidence,
    result: newResult,
    strategy: 'context'
  };
}

// DMP edit strategy
export function applyDMP(hunk: Hunk, content: string[], matchPosition: number): EditResult {
  if (matchPosition === -1) {
    return { confidence: 0, result: content, strategy: 'dmp' };
  }

  const dmp = new diff_match_patch();
  
  // Build BEFORE block (context + removals)
  const beforeLines = hunk.changes
    .filter(change => change.type === 'context' || change.type === 'remove')
    .map(change => change.originalLine || (change.indent + change.content));
  
  // Build AFTER block (context + additions)
  const afterLines = hunk.changes
    .filter(change => change.type === 'context' || change.type === 'add')
    .map(change => change.originalLine || (change.indent + change.content));
  
  // Convert to text
  const beforeText = beforeLines.join('\n');
  const afterText = afterLines.join('\n');
  
  // Create the patch
  const patch = dmp.patch_make(beforeText, afterText);
  
  // Get the target text from content
  const targetText = content.slice(matchPosition, matchPosition + beforeLines.length).join('\n');
  
  // Apply the patch
  const [patchedText] = dmp.patch_apply(patch, targetText);
  
  // Split patched text back into lines
  const patchedLines = patchedText.split('\n');
  
  // Construct the final result
  const newResult = [
    ...content.slice(0, matchPosition),
    ...patchedLines,
    ...content.slice(matchPosition + beforeLines.length)
  ];
  
  // Calculate confidence
  const similarity = getDMPSimilarity(beforeText, targetText);
  const confidence = validateEditResult(hunk, patchedText, 'dmp');
  
  return {
    confidence: similarity * confidence,
    result: newResult,
    strategy: 'dmp'
  };
}

// Git edit strategy with cherry-pick approach
async function applyGit(hunk: Hunk, content: string[], matchPosition: number): Promise<EditResult> {
  if (matchPosition === -1) {
    return { confidence: 0, result: content, strategy: 'git' };
  }

  vol.reset();
  
  try {
    // Initialize git repo
    await git.init({ fs: memfs, dir: '/' });
    
    // Create original content - only use the edit region
    const editRegion = content.slice(matchPosition, matchPosition + hunk.changes.length);
    const editText = editRegion.join('\n');
    await memfs.promises.writeFile('/file.txt', editText);
    await git.add({ fs: memfs, dir: '/', filepath: 'file.txt' });
    await git.commit({
      fs: memfs,
      dir: '/',
      author: { name: 'Temp', email: 'temp@example.com' },
      message: 'Original'
    });
    const originalHash = await git.resolveRef({ fs: memfs, dir: '/', ref: 'HEAD' });

    // Create search content (content with removals)
    const searchLines = [...editRegion];
    let offset = 0;
    for (const change of hunk.changes) {
      if (change.type === 'remove') {
        const index = searchLines.findIndex(
          (line, i) => i >= offset && line.trimLeft() === change.content
        );
        if (index !== -1) {
          searchLines.splice(index, 1);
        }
      }
      if (change.type !== 'add') {
        offset++;
      }
    }
    
    // Create search branch and commit
    await git.branch({ fs: memfs, dir: '/', ref: 'search' });
    await git.checkout({ fs: memfs, dir: '/', ref: 'search' });
    await memfs.promises.writeFile('/file.txt', searchLines.join('\n'));
    await git.add({ fs: memfs, dir: '/', filepath: 'file.txt' });
    await git.commit({
      fs: memfs,
      dir: '/',
      author: { name: 'Temp', email: 'temp@example.com' },
      message: 'Search state'
    });
    const searchHash = await git.resolveRef({ fs: memfs, dir: '/', ref: 'HEAD' });

    // Create replace content (with additions)
    const replaceLines = [...searchLines];
    offset = 0;
    const contextLines = hunk.changes
      .filter(c => c.type === 'context')
      .map(c => c.content);

    for (const change of hunk.changes) {
      if (change.type === 'add') {
        const indent = change.indent || inferIndentation(change.content, contextLines);
        replaceLines.splice(offset, 0, indent + change.content);
        offset++;
      } else if (change.type !== 'remove') {
        offset++;
      }
    }

    // Create replace branch and commit
    await git.branch({ fs: memfs, dir: '/', ref: 'replace' });
    await git.checkout({ fs: memfs, dir: '/', ref: 'replace' });
    await memfs.promises.writeFile('/file.txt', replaceLines.join('\n'));
    await git.add({ fs: memfs, dir: '/', filepath: 'file.txt' });
    await git.commit({
      fs: memfs,
      dir: '/',
      author: { name: 'Temp', email: 'temp@example.com' },
      message: 'Replace state'
    });
    const replaceHash = await git.resolveRef({ fs: memfs, dir: '/', ref: 'HEAD' });

    // Try both strategies:
    // 1. OSR: Cherry-pick replace onto original
    // 2. SR-SO: Apply search->replace changes to search->original

    // Strategy 1: OSR
    await git.checkout({ fs: memfs, dir: '/', ref: originalHash });
    try {
      await git.merge({
        fs: memfs,
        dir: '/',
        ours: originalHash,
        theirs: replaceHash,
        author: { name: 'Temp', email: 'temp@example.com' },
        message: 'Cherry-pick OSR'
      });
      const osrResult = (await memfs.promises.readFile('/file.txt')).toString();
      const osrSimilarity = getDMPSimilarity(editText, osrResult)

      const confidence = validateEditResult(hunk, osrResult, 'git-osr');
      
      if (osrSimilarity * confidence > 0.9) {
        // Construct result with edited portion
        const newResult = [
          ...content.slice(0, matchPosition),
          ...osrResult.split('\n'),
          ...content.slice(matchPosition + hunk.changes.length)
        ];
        return {
          confidence: osrSimilarity,
          result: newResult,
          strategy: 'git-osr'
        };
      }
    } catch (error) {
      console.log('OSR strategy failed:', error);
    }

    // Strategy 2: SR-SO
    await git.checkout({ fs: memfs, dir: '/', ref: searchHash });
    try {
      // First apply original changes
      await git.merge({
        fs: memfs,
        dir: '/',
        ours: searchHash,
        theirs: originalHash,
        author: { name: 'Temp', email: 'temp@example.com' },
        message: 'Apply original changes'
      });

      // Then apply replace changes
      await git.merge({
        fs: memfs,
        dir: '/',
        ours: 'HEAD',
        theirs: replaceHash,
        author: { name: 'Temp', email: 'temp@example.com' },
        message: 'Apply replace changes'
      });

      const srsoResult = (await memfs.promises.readFile('/file.txt')).toString();
      const srsoSimilarity = getDMPSimilarity(editText, srsoResult)

      const confidence = validateEditResult(hunk, srsoResult, 'git-srso');

      // Construct result with edited portion
      const newResult = [
        ...content.slice(0, matchPosition),
        ...srsoResult.split('\n'),
        ...content.slice(matchPosition + hunk.changes.length)
      ];
      return {
        confidence: srsoSimilarity * confidence,
        result: newResult,
        strategy: 'git-srso'
      };
    } catch (error) {
      console.log('SR-SO strategy failed:', error);
      return { confidence: 0, result: content, strategy: 'git' };
    }
  } catch (error) {
    console.log('Git strategy failed:', error);
    return { confidence: 0, result: content, strategy: 'git' };
  } finally {
    vol.reset();
  }
}

// Main edit function that tries strategies sequentially
export async function applyEdit(hunk: Hunk, content: string[], matchPosition: number, confidence: number, debug: string = 'false'): Promise<EditResult> {

  // Don't attempt any edits if confidence is too low and not in debug mode
  const MIN_CONFIDENCE = 0.9;
  if (confidence < MIN_CONFIDENCE) {
    console.log(`Search confidence (${confidence}) below minimum threshold (${MIN_CONFIDENCE}), skipping edit`);
    return { confidence: 0, result: content, strategy: 'none' };
  }

  // Try each strategy in sequence until one succeeds
  const strategies = [
    { name: 'dmp', apply: () => applyDMP(hunk, content, matchPosition) },
    { name: 'context', apply: () => applyContextMatching(hunk, content, matchPosition) },
    { name: 'git', apply: () => applyGit(hunk, content, matchPosition) }
  ];

  if (debug !== '') {
    // In debug mode, try all strategies and return the first success
    const results = await Promise.all(strategies.map(async strategy => {
      console.log(`Attempting edit with ${strategy.name} strategy...`);
      const result = await strategy.apply();
      console.log(`Strategy ${strategy.name} succeeded with confidence ${result.confidence}`);
      return result;
    }));
    
    /*const successfulResults = results.filter(result => result.confidence > MIN_CONFIDENCE);
    if (successfulResults.length > 0) {
      const bestResult = successfulResults.reduce((best, current) => 
        current.confidence > best.confidence ? current : best
      );
      return bestResult;
    }*/
    return results.find(result => result.strategy === debug) || { confidence: 0, result: content, strategy: 'none' };
  } else {
    // Normal mode - try strategies sequentially until one succeeds
    for (const strategy of strategies) {
      const result = await strategy.apply();
      if (result.confidence > MIN_CONFIDENCE) {
        return result;
      }
    }
  }

  // If all strategies fail, return failure
  return { confidence: 0, result: content, strategy: 'none' };
}
