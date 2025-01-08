import { diff_match_patch } from 'diff-match-patch';
import * as git from 'isomorphic-git';
import { fs as memfs, vol } from 'memfs';
import { Hunk } from './types';
import { getDMPSimilarity } from './search-strategies';

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

export type EditResult = {
  confidence: number;
  result: string[];
  strategy: string;
};

// Context matching edit strategy
export function applyContextMatching(hunk: Hunk, content: string[], matchPosition: number): EditResult {
  if (matchPosition === -1) {
    return { confidence: 0, result: content, strategy: 'context' };
  }

  const newResult = [...content.slice(0, matchPosition)];
  let sourceIndex = matchPosition;
  let previousIndent = '';

  for (const change of hunk.changes) {
    if (change.type === 'context') {
      newResult.push(change.originalLine || (change.indent + change.content));
      previousIndent = change.indent;
      sourceIndex++;
    } else if (change.type === 'add') {
      const indent = change.indent || inferIndentation(change.content, 
        hunk.changes.filter(c => c.type === 'context').map(c => c.originalLine || ''),
        previousIndent
      );
      newResult.push(indent + change.content);
      previousIndent = indent;
    } else if (change.type === 'remove') {
      sourceIndex++;
    }
  }

  newResult.push(...content.slice(sourceIndex));
  
  // Validate the result
  const similarity = getDMPSimilarity(
    content.slice(matchPosition, matchPosition + hunk.changes.length).join('\n'),
    newResult.slice(matchPosition, matchPosition + hunk.changes.length).join('\n')
  );
  
  return { 
    confidence: similarity,
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
  const currentText = content.join('\n');
  const contextLines = hunk.changes
    .filter(c => c.type === 'context')
    .map(c => c.content);

  // Create a patch from the hunk with proper indentation
  const patch = dmp.patch_make(
    currentText,
    hunk.changes.reduce((acc, change) => {
      if (change.type === 'add') {
        const indent = change.indent || inferIndentation(change.content, contextLines);
        return acc + indent + change.content + '\n';
      }
      if (change.type === 'remove') {
        return acc.replace(change.content + '\n', '');
      }
      return acc + change.content + '\n';
    }, '')
  );

  const [patchedText] = dmp.patch_apply(patch, currentText);
  const similarity = getDMPSimilarity(
    content.slice(matchPosition, matchPosition + hunk.changes.length).join('\n'),
    patchedText
  );
  
  return { 
    confidence: similarity,
    result: patchedText.split('\n'),
    strategy: 'dmp'
  };
}

// Git edit strategy
export async function applyGit(hunk: Hunk, content: string[], matchPosition: number): Promise<EditResult> {
  if (matchPosition === -1) {
    return { confidence: 0, result: content, strategy: 'git' };
  }

  vol.reset();
  
  try {
    await git.init({ fs: memfs, dir: '/' });
    
    const originalContent = content.join('\n');
    await memfs.promises.writeFile('/file.txt', originalContent);
    
    await git.add({ fs: memfs, dir: '/', filepath: 'file.txt' });
    await git.commit({
      fs: memfs,
      dir: '/',
      author: { name: 'Temp', email: 'temp@example.com' },
      message: 'Initial commit'
    });

    await git.branch({ fs: memfs, dir: '/', ref: 'patch-branch' });
    await git.checkout({ fs: memfs, dir: '/', ref: 'patch-branch' });

    const lines = originalContent.split('\n');
    const newLines = [...lines];
    let offset = matchPosition;

    const contextLines = hunk.changes
      .filter(c => c.type === 'context')
      .map(c => c.content);

    for (const change of hunk.changes) {
      if (change.type === 'add') {
        const indent = change.indent || inferIndentation(change.content, contextLines);
        newLines.splice(offset, 0, indent + change.content);
        offset++;
      } else if (change.type === 'remove') {
        const index = newLines.findIndex(
          (line, i) => i >= offset && line.trimLeft() === change.content
        );
        if (index !== -1) {
          newLines.splice(index, 1);
        }
      } else {
        offset++;
      }
    }

    const modifiedContent = newLines.join('\n');
    await memfs.promises.writeFile('/file.txt', modifiedContent);

    await git.add({ fs: memfs, dir: '/', filepath: 'file.txt' });
    await git.commit({
      fs: memfs,
      dir: '/',
      author: { name: 'Temp', email: 'temp@example.com' },
      message: 'Apply changes'
    });

    const similarity = getDMPSimilarity(
      content.slice(matchPosition, matchPosition + hunk.changes.length).join('\n'),
      newLines.slice(matchPosition, matchPosition + hunk.changes.length).join('\n')
    );

    return { 
      confidence: similarity,
      result: newLines,
      strategy: 'git'
    };
  } catch (error) {
    return { confidence: 0, result: content, strategy: 'git' };
  } finally {
    vol.reset();
  }
}

// Main edit function that tries strategies sequentially
export async function applyEdit(hunk: Hunk, content: string[], matchPosition: number, confidence: number, debug: boolean = false): Promise<EditResult> {
  // Don't attempt any edits if confidence is too low and not in debug mode
  const MIN_CONFIDENCE = 0.9;
  if (confidence < MIN_CONFIDENCE && !debug) {
    return { confidence: 0, result: content, strategy: 'none' };
  }

  // Try each strategy in sequence until one succeeds
  const strategies = [
    { name: 'context', apply: () => applyContextMatching(hunk, content, matchPosition) },
    { name: 'dmp', apply: () => applyDMP(hunk, content, matchPosition) },
    { name: 'git', apply: () => applyGit(hunk, content, matchPosition) }
  ];

  if (debug) {
    // In debug mode, try all strategies and return the first success
    const results = await Promise.all(strategies.map(async strategy => {
      const result = await strategy.apply();
      return result;
    }));
    
    const successfulResults = results.filter(result => result.confidence > MIN_CONFIDENCE);
    if (successfulResults.length > 0) {
      return successfulResults.reduce((best, current) => 
        current.confidence > best.confidence ? current : best
      );
    }
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
