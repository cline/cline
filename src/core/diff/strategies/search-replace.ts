import { DiffStrategy, DiffResult } from "../types"

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
IMPORTANT: The read_file tool returns the file content with line numbers prepended to each line. However, DO NOT include line numbers in the SEARCH and REPLACE sections of the diff content.

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

    applyDiff(originalContent: string, diffContent: string, startLine?: number, endLine?: number): DiffResult {
        // Extract the search and replace blocks
        const match = diffContent.match(/<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/);
        if (!match) {
            // Log detailed format information
            console.log('Invalid Diff Format Debug:', {
                expectedFormat: "<<<<<<< SEARCH\\n[search content]\\n=======\\n[replace content]\\n>>>>>>> REPLACE",
                tip: "Make sure to include both SEARCH and REPLACE sections with correct markers"
            });

            return {
                success: false,
                error: "Invalid diff format - missing required SEARCH/REPLACE sections"
            };
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
        let bestMatchContent = "";
        
        if (startLine !== undefined && endLine !== undefined) {
            // Convert to 0-based index
            const exactStartIndex = startLine - 1;
            const exactEndIndex = endLine - 1;

            if (exactStartIndex < 0 || exactEndIndex >= originalLines.length) {
                // Log detailed debug information
                console.log('Invalid Line Range Debug:', {
                    requestedRange: { start: startLine, end: endLine },
                    fileBounds: { start: 1, end: originalLines.length }
                });

                return {
                    success: false,
                    error: `Line range ${startLine}-${endLine} is invalid (file has ${originalLines.length} lines)`,
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
                    bestMatchContent = originalChunk;
                }
            }
        }

        // Require similarity to meet threshold
        if (matchIndex === -1 || bestMatchScore < this.fuzzyThreshold) {
            const searchChunk = searchLines.join('\n');
            // Log detailed debug information to console
            console.log('Search/Replace Debug Info:', {
                similarity: bestMatchScore,
                threshold: this.fuzzyThreshold,
                searchContent: searchChunk,
                bestMatch: bestMatchContent || undefined
            });

            return {
                success: false,
                error: `No sufficiently similar match found${startLine !== undefined ? ` near lines ${startLine}-${endLine}` : ''} (${Math.round(bestMatchScore * 100)}% similar, needs ${Math.round(this.fuzzyThreshold * 100)}%)`
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
            const matchedIndent = originalIndents[0];
            
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