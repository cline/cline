import { DiffStrategy, DiffResult } from "../types"
import { addLineNumbers } from "../../../integrations/misc/extract-text"

const BUFFER_LINES = 5; // Number of extra context lines to show before and after matches

function levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    // Initialize matrix
    for (let i = 0; i <= a.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= b.length; j++) {
        matrix[0][j] = j;
    }

    // Fill matrix
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            if (a[i-1] === b[j-1]) {
                matrix[i][j] = matrix[i-1][j-1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i-1][j-1] + 1, // substitution
                    matrix[i][j-1] + 1,   // insertion
                    matrix[i-1][j] + 1    // deletion
                );
            }
        }
    }

    return matrix[a.length][b.length];
}

function getSimilarity(original: string, search: string): number {
    if (original === '' || search === '') {
        return 1;
    }

    // Normalize strings by removing extra whitespace but preserve case
    const normalizeStr = (str: string) => str.replace(/\s+/g, ' ').trim();
    
    const normalizedOriginal = normalizeStr(original);
    const normalizedSearch = normalizeStr(search);
    
    if (normalizedOriginal === normalizedSearch) { return 1; }
    
    // Calculate Levenshtein distance
    const distance = levenshteinDistance(normalizedOriginal, normalizedSearch);
    
    // Calculate similarity ratio (0 to 1, where 1 is exact match)
    const maxLength = Math.max(normalizedOriginal.length, normalizedSearch.length);
    return 1 - (distance / maxLength);
}

export class SearchReplaceDiffStrategy implements DiffStrategy {
    private fuzzyThreshold: number;
    public debugEnabled: boolean;

    constructor(fuzzyThreshold?: number, debugEnabled?: boolean) {
        // Default to exact matching (1.0) unless fuzzy threshold specified
        this.fuzzyThreshold = fuzzyThreshold ?? 1.0;
        this.debugEnabled = debugEnabled ?? false;
    }

    getToolDescription(cwd: string): string {
        return `## apply_diff
Description: Request to replace existing code using a search and replace block.
This tool allows for precise, surgical replaces to files by specifying exactly what content to search for and what to replace it with.
The tool will maintain proper indentation and formatting while making changes.
Only a single operation is allowed per tool use.
The SEARCH section must exactly match existing content including whitespace and indentation.
If you're not confident in the exact content to search for, use the read_file tool first to get the exact content.

Parameters:
- path: (required) The path of the file to modify (relative to the current working directory ${cwd})
- diff: (required) The search/replace block defining the changes.
- start_line: (required) The line number where the search block starts (inclusive).
- end_line: (required) The line number where the search block ends (inclusive).

Diff format:
\`\`\`
<<<<<<< SEARCH
[exact content to find including whitespace]
=======
[new content to replace with]
>>>>>>> REPLACE
\`\`\`

Example:

Original file:
\`\`\`
1 | def calculate_total(items):
2 |     total = 0
3 |     for item in items:
4 |         total += item
5 |     return total
\`\`\`

1. Search/replace a specific chunk of code:
\`\`\`
<apply_diff>
<path>File path here</path>
<diff>
<<<<<<< SEARCH
    total = 0
    for item in items:
        total += item
    return total
=======
    """Calculate total with 10% markup"""
    return sum(item * 1.1 for item in items)
>>>>>>> REPLACE
</diff>
<start_line>2</start_line>
<end_line>5</end_line>
</apply_diff>
\`\`\`

Result:
\`\`\`
1 | def calculate_total(items):
2 |     """Calculate total with 10% markup"""
3 |     return sum(item * 1.1 for item in items)
\`\`\`

2. Insert code at a specific line (start_line and end_line must be the same, and the content gets inserted before whatever is currently at that line):
\`\`\`
<apply_diff>
<path>File path here</path>
<diff>
<<<<<<< SEARCH
=======
    """TODO: Write a test for this"""
>>>>>>> REPLACE
</diff>
<start_line>2</start_line>
<end_line>2</end_line>
</apply_diff>
\`\`\`

Result:
\`\`\`
1 | def calculate_total(items):
2 |     """TODO: Write a test for this"""
3 |     """Calculate total with 10% markup"""
4 |     return sum(item * 1.1 for item in items)
\`\`\`

3. Delete code at a specific line range:
\`\`\`
<apply_diff>
<path>File path here</path>
<diff>
<<<<<<< SEARCH
    total = 0
    for item in items:
        total += item
    return total
=======
>>>>>>> REPLACE
</diff>
<start_line>2</start_line>
<end_line>5</end_line>
</apply_diff>
\`\`\`

Result:
\`\`\`
1 | def calculate_total(items):
\`\`\`
`
    }

    applyDiff(originalContent: string, diffContent: string, startLine?: number, endLine?: number): DiffResult {
        // Extract the search and replace blocks
        const match = diffContent.match(/<<<<<<< SEARCH\n([\s\S]*?)\n?=======\n([\s\S]*?)\n?>>>>>>> REPLACE/);
        if (!match) {
            const debugInfo = this.debugEnabled ? `\n\nDebug Info:\n- Expected Format: <<<<<<< SEARCH\\n[search content]\\n=======\\n[replace content]\\n>>>>>>> REPLACE\n- Tip: Make sure to include both SEARCH and REPLACE sections with correct markers` : '';

            return {
                success: false,
                error: `Invalid diff format - missing required SEARCH/REPLACE sections${debugInfo}`
            };
        }

        let [_, searchContent, replaceContent] = match;

        // Detect line ending from original content
        const lineEnding = originalContent.includes('\r\n') ? '\r\n' : '\n';

        // Strip line numbers from search and replace content if every line starts with a line number
        const hasLineNumbers = (content: string) => {
            const lines = content.split(/\r?\n/);
            return lines.length > 0 && lines.every(line => /^\d+\s+\|(?!\|)/.test(line));
        };

        if (hasLineNumbers(searchContent) && hasLineNumbers(replaceContent)) {
            const stripLineNumbers = (content: string) => {
                return content.replace(/^\d+\s+\|(?!\|)/gm, '');
            };

            searchContent = stripLineNumbers(searchContent);
            replaceContent = stripLineNumbers(replaceContent);
        }
        
        // Split content into lines, handling both \n and \r\n
        const searchLines = searchContent === '' ? [] : searchContent.split(/\r?\n/);
        const replaceLines = replaceContent === '' ? [] : replaceContent.split(/\r?\n/);
        const originalLines = originalContent.split(/\r?\n/);
        
        // First try exact line range if provided
        let matchIndex = -1;
        let bestMatchScore = 0;
        let bestMatchContent = "";
        
        if (startLine && endLine) {
            // Convert to 0-based index
            const exactStartIndex = startLine - 1;
            const exactEndIndex = endLine - 1;

            if (exactStartIndex < 0 || exactEndIndex > originalLines.length || exactStartIndex > exactEndIndex) {
                const debugInfo = this.debugEnabled ? `\n\nDebug Info:\n- Requested Range: lines ${startLine}-${endLine}\n- File Bounds: lines 1-${originalLines.length}` : '';
    
                // Log detailed debug information
                console.log('Invalid Line Range Debug:', {
                    requestedRange: { start: startLine, end: endLine },
                    fileBounds: { start: 1, end: originalLines.length }
                });

                return {
                    success: false,
                    error: `Line range ${startLine}-${endLine} is invalid (file has ${originalLines.length} lines)${debugInfo}`,
                };
            }

            // Check exact range first
            const originalChunk = originalLines.slice(exactStartIndex, exactEndIndex + 1).join('\n');
            const searchChunk = searchLines.join('\n');
            
            const similarity = getSimilarity(originalChunk, searchChunk);
            if (similarity >= this.fuzzyThreshold) {
                matchIndex = exactStartIndex;
                bestMatchScore = similarity;
                bestMatchContent = originalChunk;
            }
        }

        // If no match found in exact range, try expanded range
        if (matchIndex === -1) {
            let searchStartIndex = 0;
            let searchEndIndex = originalLines.length;

            if (startLine || endLine) {
                // Convert to 0-based index and add buffer
                if (startLine) {
                    searchStartIndex = Math.max(0, startLine - (BUFFER_LINES + 1));
                }
                if (endLine) {
                    searchEndIndex = Math.min(originalLines.length, endLine + BUFFER_LINES);
                }
            }

            // Find the search content in the expanded range using fuzzy matching
            for (let i = searchStartIndex; i <= searchEndIndex - searchLines.length; i++) {
                // Join the lines and calculate overall similarity
                const originalChunk = originalLines.slice(i, i + searchLines.length).join('\n');
                const searchChunk = searchLines.join('\n');

                const similarity = getSimilarity(originalChunk, searchChunk);
                if (similarity > bestMatchScore) {
                    bestMatchScore = similarity;
                    matchIndex = i;
                    bestMatchContent = originalChunk;
                }
            }
        }

        // Require similarity to meet threshold
        if (matchIndex === -1 || bestMatchScore < this.fuzzyThreshold) {
            const searchChunk = searchLines.join('\n');
            const originalContentSection = startLine !== undefined && endLine !== undefined
                ? `\n\nOriginal Content:\n${addLineNumbers(
                    originalLines.slice(
                        Math.max(0, startLine - 1 - BUFFER_LINES),
                        Math.min(originalLines.length, endLine + BUFFER_LINES)
                    ).join('\n'),
                    Math.max(1, startLine - BUFFER_LINES)
                )}`
                : `\n\nOriginal Content:\n${addLineNumbers(originalLines.join('\n'))}`;

            const bestMatchSection = bestMatchContent
                ? `\n\nBest Match Found:\n${addLineNumbers(bestMatchContent, matchIndex + 1)}`
                : `\n\nBest Match Found:\n(no match)`;

            const debugInfo = this.debugEnabled ? `\n\nDebug Info:\n- Similarity Score: ${Math.floor(bestMatchScore * 100)}%\n- Required Threshold: ${Math.floor(this.fuzzyThreshold * 100)}%\n- Search Range: ${startLine && endLine ? `lines ${startLine}-${endLine}` : 'start to end'}\n\nSearch Content:\n${searchChunk}${bestMatchSection}${originalContentSection}` : '';

            const lineRange = startLine || endLine ?
                ` at ${startLine ? `start: ${startLine}` : 'start'} to ${endLine ? `end: ${endLine}` : 'end'}` : '';
            return {
                success: false,
                error: `No sufficiently similar match found${lineRange} (${Math.floor(bestMatchScore * 100)}% similar, needs ${Math.floor(this.fuzzyThreshold * 100)}%)${debugInfo}`
            };
        }

        // Get the matched lines from the original content
        const matchedLines = originalLines.slice(matchIndex, matchIndex + searchLines.length);
        
        // Get the exact indentation (preserving tabs/spaces) of each line
        const originalIndents = matchedLines.map(line => {
            const match = line.match(/^[\t ]*/);
            return match ? match[0] : '';
        });

        // Get the exact indentation of each line in the search block
        const searchIndents = searchLines.map(line => {
            const match = line.match(/^[\t ]*/);
            return match ? match[0] : '';
        });

        // Apply the replacement while preserving exact indentation
        const indentedReplaceLines = replaceLines.map((line, i) => {
            // Get the matched line's exact indentation
            const matchedIndent = originalIndents[0] || '';
            
            // Get the current line's indentation relative to the search content
            const currentIndentMatch = line.match(/^[\t ]*/);
            const currentIndent = currentIndentMatch ? currentIndentMatch[0] : '';
            const searchBaseIndent = searchIndents[0] || '';
            
            // Calculate the relative indentation level
            const searchBaseLevel = searchBaseIndent.length;
            const currentLevel = currentIndent.length;
            const relativeLevel = currentLevel - searchBaseLevel;
            
            // If relative level is negative, remove indentation from matched indent
            // If positive, add to matched indent
            const finalIndent = relativeLevel < 0
                ? matchedIndent.slice(0, Math.max(0, matchedIndent.length + relativeLevel))
                : matchedIndent + currentIndent.slice(searchBaseLevel);
            
            return finalIndent + line.trim();
        });

        // Construct the final content
        const beforeMatch = originalLines.slice(0, matchIndex);
        const afterMatch = originalLines.slice(matchIndex + searchLines.length);
        
        const finalContent = [...beforeMatch, ...indentedReplaceLines, ...afterMatch].join(lineEnding);
        return {
            success: true,
            content: finalContent
        };
    }
}