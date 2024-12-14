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
Description: Request to replace existing code using search and replace blocks.
This tool allows for precise, surgical replaces to files by specifying exactly what content to search for and what to replace it with.
The tool will maintain proper indentation and formatting while making changes.
Only a single operation is allowed per tool use.
The SEARCH section must exactly match existing content including whitespace and indentation.
If you're not confident in the exact content to search for, use the read_file tool first to get the exact content.

Parameters:
- path: (required) The path of the file to modify (relative to the current working directory ${cwd})
- diff: (required) The search/replace blocks defining the changes.

Format:
1. First line must be the file path
2. Followed by search/replace blocks:
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
def calculate_total(items):
    total = 0
    for item in items:
        total += item
    return total
\`\`\`

Search/Replace content:
\`\`\`
main.py
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
</apply_diff>`
    }

    applyDiff(originalContent: string, diffContent: string): string | false {
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
        
        // Find the search content in the original using fuzzy matching
        let matchIndex = -1;
        let bestMatchScore = 0;
        
        for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
            // Join the lines and calculate overall similarity
            const originalChunk = originalLines.slice(i, i + searchLines.length).join('\n');
            const searchChunk = searchLines.join('\n');
            
            const similarity = getSimilarity(originalChunk, searchChunk);
            if (similarity > bestMatchScore) {
                bestMatchScore = similarity;
                matchIndex = i;
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
            // Get the corresponding original and search indentations
            const originalIndent = originalIndents[Math.min(i, originalIndents.length - 1)];
            const searchIndent = searchIndents[Math.min(i, searchIndents.length - 1)];
            
            // Get the current line's indentation
            const currentIndentMatch = line.match(/^[\t ]*/);
            const currentIndent = currentIndentMatch ? currentIndentMatch[0] : '';
            
            // Get the corresponding search line's indentation
            const searchLineIndex = Math.min(i, searchLines.length - 1);
            const searchLineIndent = searchIndents[searchLineIndex];

            // Get the corresponding original line's indentation
            const originalLineIndex = Math.min(i, originalIndents.length - 1);
            const originalLineIndent = originalIndents[originalLineIndex];

            // If this line has the same indentation as its corresponding search line,
            // use the original indentation
            if (currentIndent === searchLineIndent) {
                return originalLineIndent + line.trim();
            }

            // Otherwise, preserve the original indentation structure
            const indentChar = originalLineIndent.charAt(0) || '\t';
            const indentLevel = Math.floor(originalLineIndent.length / indentChar.length);

            // Calculate the relative indentation from the search line
            const searchLevel = Math.floor(searchLineIndent.length / indentChar.length);
            const currentLevel = Math.floor(currentIndent.length / indentChar.length);
            const relativeLevel = currentLevel - searchLevel;

            // Apply the relative indentation to the original level
            const targetLevel = Math.max(0, indentLevel + relativeLevel);
            return indentChar.repeat(targetLevel) + line.trim();
        });
        
        // Construct the final content
        const beforeMatch = originalLines.slice(0, matchIndex);
        const afterMatch = originalLines.slice(matchIndex + searchLines.length);
        
        return [...beforeMatch, ...indentedReplaceLines, ...afterMatch].join(lineEnding);
    }
}
