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
		tmpDir = tmp.dirSync({ unsafeCleanup: true });
		const git: SimpleGit = simpleGit(tmpDir.name);
		
		await git.init();
		await git.addConfig('user.name', 'Temp');
		await git.addConfig('user.email', 'temp@example.com');

		const filePath = path.join(tmpDir.name, 'file.txt');

		const searchLines = hunk.changes
			.filter(change => change.type === 'context' || change.type === 'remove')
			.map(change => change.originalLine || (change.indent + change.content));
		
		const replaceLines = hunk.changes
			.filter(change => change.type === 'context' || change.type === 'add')
			.map(change => change.originalLine || (change.indent + change.content));

		const searchText = searchLines.join('\n');
		const replaceText = replaceLines.join('\n');
		const originalText = content.join('\n');

		try {
			fs.writeFileSync(filePath, originalText);
			await git.add('file.txt');
			const originalCommit = await git.commit('original');
			console.log('Strategy 1 - Original commit:', originalCommit.commit);

			fs.writeFileSync(filePath, searchText);
			await git.add('file.txt');
			const searchCommit1 = await git.commit('search');
			console.log('Strategy 1 - Search commit:', searchCommit1.commit);

			fs.writeFileSync(filePath, replaceText);
			await git.add('file.txt');
			const replaceCommit = await git.commit('replace');
			console.log('Strategy 1 - Replace commit:', replaceCommit.commit);

			console.log('Strategy 1 - Attempting checkout of:', originalCommit.commit);
			await git.raw(['checkout', originalCommit.commit]);
			try {
				console.log('Strategy 1 - Attempting cherry-pick of:', replaceCommit.commit);
				await git.raw(['cherry-pick', '--minimal', replaceCommit.commit]);
				
				const newText = fs.readFileSync(filePath, 'utf-8');
				const newLines = newText.split('\n');
				return {
					confidence: 1,
					result: newLines,
					strategy: 'git-fallback'
				};
			} catch (cherryPickError) {
				console.error('Strategy 1 failed with merge conflict');
			}
		} catch (error) {
			console.error('Strategy 1 failed:', error);
		}

		try {
			await git.init();
			await git.addConfig('user.name', 'Temp');
			await git.addConfig('user.email', 'temp@example.com');

			fs.writeFileSync(filePath, searchText);
			await git.add('file.txt');
			const searchCommit = await git.commit('search');
			const searchHash = searchCommit.commit.replace(/^HEAD /, '');
			console.log('Strategy 2 - Search commit:', searchHash);

			fs.writeFileSync(filePath, replaceText);
			await git.add('file.txt');
			const replaceCommit = await git.commit('replace');
			const replaceHash = replaceCommit.commit.replace(/^HEAD /, '');
			console.log('Strategy 2 - Replace commit:', replaceHash);

			console.log('Strategy 2 - Attempting checkout of:', searchHash);
			await git.raw(['checkout', searchHash]);
			fs.writeFileSync(filePath, originalText);
			await git.add('file.txt');
			const originalCommit2 = await git.commit('original');
			console.log('Strategy 2 - Original commit:', originalCommit2.commit);

			try {
				console.log('Strategy 2 - Attempting cherry-pick of:', replaceHash);
				await git.raw(['cherry-pick', '--minimal', replaceHash]);
				
				const newText = fs.readFileSync(filePath, 'utf-8');
				const newLines = newText.split('\n');
				return {
					confidence: 1,
					result: newLines,
					strategy: 'git-fallback'
				};
			} catch (cherryPickError) {
				console.error('Strategy 2 failed with merge conflict');
			}
		} catch (error) {
			console.error('Strategy 2 failed:', error);
		}

		console.error('Git fallback failed');
		return { confidence: 0, result: content, strategy: 'git-fallback' };
	} catch (error) {
		console.error('Git fallback strategy failed:', error);
		return { confidence: 0, result: content, strategy: 'git-fallback' };
	} finally {
		if (tmpDir) {
			tmpDir.removeCallback();
		}
	}
}

// Main edit function that tries strategies sequentially
export async function applyEdit(
	hunk: Hunk, 
	content: string[], 
	matchPosition: number, 
	confidence: number, 
	debug: string = '',
	minConfidence: number = 0.9
): Promise<EditResult> {
	// Don't attempt regular edits if confidence is too low
	if (confidence < minConfidence && debug === '') {
		console.log(`Search confidence (${confidence}) below minimum threshold (${minConfidence}), trying git fallback...`);
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
