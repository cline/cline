import { DiffStrategy } from "../types"

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

    constructor(fuzzyThreshold?: number) {
        // Default to exact matching (1.0) unless fuzzy threshold specified
        this.fuzzyThreshold = fuzzyThreshold ?? 1.0;
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
- start_line: (required) The line number where the search block starts.
- end_line: (required) The line number where the search block ends.

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

Search/Replace content:
\`\`\`
<<<<<<< SEARCH
def calculate_total(items):
    total = 0
    for item in items:
        total += item
    return total
=======
def calculate_total(items):
    """Calculate total with 10% markup"""
    return sum(item * 1.1 for item in items)
>>>>>>> REPLACE
\`\`\`

Usage:
<apply_diff>
<path>File path here</path>
<diff>
Your search/replace content here
</diff>
<start_line>1</start_line>
<end_line>5</end_line>
</apply_diff>`
    }

    applyDiff(originalContent: string, diffContent: string, startLine?: number, endLine?: number): string | false {
        // Extract the search and replace blocks
        const match = diffContent.match(/<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/);
        if (!match) {
            return false;
        }

        const [_, searchContent, replaceContent] = match;
        
        // Detect line ending from original content
        const lineEnding = originalContent.includes('\r\n') ? '\r\n' : '\n';
        
        // Split content into lines, handling both \n and \r\n
        const searchLines = searchContent.split(/\r?\n/);
        const replaceLines = replaceContent.split(/\r?\n/);
        const originalLines = originalContent.split(/\r?\n/);
        
        // First try exact line range if provided
        let matchIndex = -1;
        let bestMatchScore = 0;
        
        if (startLine !== undefined && endLine !== undefined) {
            // Convert to 0-based index
            const exactStartIndex = startLine - 1;
            const exactEndIndex = endLine - 1;

            // Check exact range first
            const originalChunk = originalLines.slice(exactStartIndex, exactEndIndex + 1).join('\n');
            const searchChunk = searchLines.join('\n');
            
            const similarity = getSimilarity(originalChunk, searchChunk);
            if (similarity >= this.fuzzyThreshold) {
                matchIndex = exactStartIndex;
                bestMatchScore = similarity;
            }
        }

        // If no match found in exact range, try expanded range
        if (matchIndex === -1) {
            let searchStartIndex = 0;
            let searchEndIndex = originalLines.length;

            if (startLine !== undefined || endLine !== undefined) {
                // Convert to 0-based index and add buffer
                if (startLine !== undefined) {
                    searchStartIndex = Math.max(0, startLine - 6);
                }
                if (endLine !== undefined) {
                    searchEndIndex = Math.min(originalLines.length, endLine + 5);
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
                }
            }
        }

        // Require similarity to meet threshold
        if (matchIndex === -1 || bestMatchScore < this.fuzzyThreshold) {
            return false;
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
            const matchedIndent = originalIndents[0];
            
            // Get the current line's indentation relative to the search content
            const currentIndentMatch = line.match(/^[\t ]*/);
            const currentIndent = currentIndentMatch ? currentIndentMatch[0] : '';
            const searchBaseIndent = searchIndents[0] || '';
            
            // Calculate the relative indentation from the search content
            const relativeIndent = currentIndent.slice(searchBaseIndent.length);
            
            // Apply the matched indentation plus any relative indentation
            return matchedIndent + relativeIndent + line.trim();
        });

        // Construct the final content
        const beforeMatch = originalLines.slice(0, matchIndex);
        const afterMatch = originalLines.slice(matchIndex + searchLines.length);
        
        return [...beforeMatch, ...indentedReplaceLines, ...afterMatch].join(lineEnding);
    }
}
