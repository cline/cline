import { diff_match_patch } from 'diff-match-patch';
import { EditResult, Hunk } from './types';
import { getDMPSimilarity, validateEditResult } from './search-strategies';
import * as path from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import * as tmp from 'tmp';
import * as fs from 'fs';

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
  let contextLinesProcessed = 0;

  for (const change of hunk.changes) {
    if (change.type === 'context') {
      newResult.push(change.originalLine || (change.indent + change.content));
      previousIndent = change.indent;
      sourceIndex++;
      contextLinesProcessed++;
    } else if (change.type === 'add') {
      const indent = change.indent || inferIndentation(change.content, 
        hunk.changes.filter(c => c.type === 'context' && c.originalLine).map(c => c.originalLine || ''),
        previousIndent
      );
      newResult.push(indent + change.content);
      previousIndent = indent;
    } else if (change.type === 'remove') {
      sourceIndex++;
    }
  }

  // Only append remaining content after the hunk's actual span in the original content
  const remainingContentStart = matchPosition + contextLinesProcessed + hunk.changes.filter(c => c.type === 'remove').length;
  newResult.push(...content.slice(remainingContentStart));
  
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

// Git fallback strategy that works with full content
async function applyGitFallback(hunk: Hunk, content: string[]): Promise<EditResult> {
  let tmpDir: tmp.DirResult | undefined;
  
  try {
    // Create temporary directory
    tmpDir = tmp.dirSync({ unsafeCleanup: true });
    const git: SimpleGit = simpleGit(tmpDir.name);
    
    // Initialize git repo
    await git.init();
    await git.addConfig('user.name', 'Temp');
    await git.addConfig('user.email', 'temp@example.com');

    const filePath = path.join(tmpDir.name, 'file.txt');

    // Build the search text (context + removals)
    const searchLines = hunk.changes
      .filter(change => change.type === 'context' || change.type === 'remove')
      .map(change => change.originalLine || (change.indent + change.content));
    
    // Build the replace text (context + additions)
    const replaceLines = hunk.changes
      .filter(change => change.type === 'context' || change.type === 'add')
      .map(change => change.originalLine || (change.indent + change.content));

    const searchText = searchLines.join('\n');
    const replaceText = replaceLines.join('\n');
    const originalText = content.join('\n');

    // Strategy 1: O->S->R, cherry-pick R onto O
    try {
      // Original commit - use full file content
      fs.writeFileSync(filePath, originalText);
      await git.add('file.txt');
      const originalCommit = await git.commit('original');

      // Search commit - just the search text
      fs.writeFileSync(filePath, searchText);
      await git.add('file.txt');
      await git.commit('search');

      // Replace commit - just the replace text
      fs.writeFileSync(filePath, replaceText);
      await git.add('file.txt');
      const replaceCommit = await git.commit('replace');

      // Go back to original and cherry-pick
      await git.checkout(originalCommit.commit);
      try {
        await git.raw(['cherry-pick', '--minimal', replaceCommit.commit]);
        
        // Read result
        const newText = fs.readFileSync(filePath, 'utf-8');
        const newLines = newText.split('\n');
        return {
          confidence: 1,
          result: newLines,
          strategy: 'git-fallback'
        };
      } catch (cherryPickError) {
        console.log('Strategy 1 failed with merge conflict');
      }
    } catch (error) {
      console.log('Strategy 1 failed:', error);
    }

    // Strategy 2: S->R, S->O, cherry-pick R onto O
    try {
      // Reset repo
      await git.init();
      await git.addConfig('user.name', 'Temp');
      await git.addConfig('user.email', 'temp@example.com');

      // Search commit - just the search text
      fs.writeFileSync(filePath, searchText);
      await git.add('file.txt');
      const searchCommit = await git.commit('search');

      // Replace commit - just the replace text
      fs.writeFileSync(filePath, replaceText);
      await git.add('file.txt');
      const replaceCommit = await git.commit('replace');

      // Go back to search and create original with full file content
      await git.checkout(searchCommit.commit);
      fs.writeFileSync(filePath, originalText);
      await git.add('file.txt');
      await git.commit('original');

      try {
        // Cherry-pick replace onto original
        await git.raw(['cherry-pick', '--minimal', replaceCommit.commit]);
        
        // Read result
        const newText = fs.readFileSync(filePath, 'utf-8');
        const newLines = newText.split('\n');
        return {
          confidence: 1,
          result: newLines,
          strategy: 'git-fallback'
        };
      } catch (cherryPickError) {
        console.log('Strategy 2 failed with merge conflict');
      }
    } catch (error) {
      console.log('Strategy 2 failed:', error);
    }

    // If both strategies fail, return no confidence
    console.log('Git fallback failed');
    return { confidence: 0, result: content, strategy: 'git-fallback' };
  } catch (error) {
    console.log('Git fallback strategy failed:', error);
    return { confidence: 0, result: content, strategy: 'git-fallback' };
  } finally {
    // Clean up temporary directory
    if (tmpDir) {
      tmpDir.removeCallback();
    }
  }
}

// Main edit function that tries strategies sequentially
export async function applyEdit(hunk: Hunk, content: string[], matchPosition: number, confidence: number, debug: string = 'false'): Promise<EditResult> {
  // Don't attempt regular edits if confidence is too low
  const MIN_CONFIDENCE = 0.9;
  if (confidence < MIN_CONFIDENCE && debug === '') {
    console.log(`Search confidence (${confidence}) below minimum threshold (${MIN_CONFIDENCE}), trying git fallback...`);
    return applyGitFallback(hunk, content);
  }

  // Try each strategy in sequence until one succeeds
  const strategies = [
    { name: 'dmp', apply: () => applyDMP(hunk, content, matchPosition) },
    { name: 'context', apply: () => applyContextMatching(hunk, content, matchPosition) },
    { name: 'git-fallback', apply: () => applyGitFallback(hunk, content) }
  ];

  if (debug !== '') {
    // In debug mode, try all strategies including git fallback
    const results = await Promise.all([
      ...strategies.map(async strategy => {
        console.log(`Attempting edit with ${strategy.name} strategy...`);
        const result = await strategy.apply();
        console.log(`Strategy ${strategy.name} succeeded with confidence ${result.confidence}`);
        return result;
      })
    ]);
    
    return results.find(result => result.strategy === debug) || { confidence: 0, result: content, strategy: 'none' };
  } else {
    // Normal mode - try strategies sequentially until one succeeds
    for (const strategy of strategies) {
      const result = await strategy.apply();
      if (result.confidence === 1) {
        return result;
      }
    }
    // If all strategies fail, try git fallback
    
    const result = await applyGitFallback(hunk, content);
    if(result.confidence === 1) {
      return result;
    }
  }

  return { confidence: 0, result: content, strategy: 'none' };
}
