import { CodeBlock, MergeResult, MERGE_MARKERS } from "./types";

export class CodeMerger {
    /**
     * Parse content to find SEARCH/REPLACE blocks
     * Handles various code fence formats and ensures blocks are properly formatted
     */
    findCodeBlocks(content: string): CodeBlock[] {
        const blocks: CodeBlock[] = [];
        const lines = content.split('\n');
        let i = 0;

        while (i < lines.length) {
            // Look for a filename followed by a code fence (handles various formats)
            const currentLine = lines[i]?.trim() || '';
            const nextLine = lines[i + 1]?.trim() || '';
            const isCodeFence = nextLine.startsWith('```') || nextLine.startsWith('~~~');
            
            if (currentLine && isCodeFence) {
                const filename = currentLine;
                i += 2; // Skip filename and code fence

                // Look for the start marker
                if (i < lines.length && lines[i].trim() === MERGE_MARKERS.HEAD) {
                    // Collect original code
                    const original: string[] = [];
                    i++;
                    while (i < lines.length && lines[i].trim() !== MERGE_MARKERS.DIVIDER) {
                        if (i >= lines.length) {
                            throw new Error(`Malformed SEARCH/REPLACE block in ${filename}: Missing divider marker`);
                        }
                        original.push(lines[i]);
                        i++;
                    }

                    if (original.length === 0) {
                        throw new Error(`Empty SEARCH block in ${filename}: SEARCH section must contain content to match`);
                    }

                    // Skip divider
                    i++;

                    // Collect new code
                    const newCode: string[] = [];
                    while (i < lines.length && lines[i].trim() !== MERGE_MARKERS.TAIL) {
                        if (i >= lines.length) {
                            throw new Error(`Malformed SEARCH/REPLACE block in ${filename}: Missing end marker`);
                        }
                        newCode.push(lines[i]);
                        i++;
                    }

                    // Skip tail marker and closing code fence
                    i += 2;

                    blocks.push({
                        filename,
                        original: original.join('\n'),
                        new: newCode.join('\n')
                    });
                }
            }
            i++;
        }

        return blocks;
    }

    /**
     * Apply the code change to the file content
     * Enforces exact matches for SEARCH blocks to prevent accidental changes
     */
    async applyCodeChange(
        filename: string,
        content: string,
        searchText: string,
        replaceText: string
    ): Promise<MergeResult> {
        try {
            // For new files, just return the new content
            if (!searchText.trim()) {
                return {
                    success: true,
                    content: replaceText
                };
            }

            // Normalize line endings to prevent matching issues
            const normalizedContent = content.replace(/\r\n/g, '\n');
            const normalizedSearch = searchText.replace(/\r\n/g, '\n');

            // First try exact match (most reliable)
            const exactMatch = normalizedContent.includes(normalizedSearch);
            if (exactMatch) {
                // Use the first occurrence only
                const parts = normalizedContent.split(normalizedSearch);
                const result = parts[0] + replaceText + parts.slice(1).join(normalizedSearch);
                
                // Ensure we preserve the original line endings
                return {
                    success: true,
                    content: content.includes('\r\n') ? result.replace(/\n/g, '\r\n') : result
                };
            }

            // If no exact match, try matching with normalized whitespace
            const contentLines = normalizedContent.split('\n');
            const searchLines = normalizedSearch.split('\n');

            // Ensure search text isn't empty
            if (searchLines.length === 0 || searchLines.every(line => !line.trim())) {
                return {
                    success: false,
                    error: `Empty SEARCH block in ${filename}: SEARCH section must contain content to match`
                };
            }

            // Try to find the match with context
            for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
                const matches = searchLines.every((searchLine, j) => {
                    const contentLine = contentLines[i + j];
                    // First try exact match
                    if (contentLine === searchLine) {
                        return true;
                    }
                    // Then try with normalized whitespace
                    if (contentLine.trim() === searchLine.trim()) {
                        return true;
                    }
                    return false;
                });

                if (matches) {
                    const before = contentLines.slice(0, i);
                    const after = contentLines.slice(i + searchLines.length);
                    const result = [...before, replaceText, ...after].join('\n');
                    
                    // Ensure we preserve the original line endings
                    return {
                        success: true,
                        content: content.includes('\r\n') ? result.replace(/\n/g, '\r\n') : result
                    };
                }
            }

            // If still no match, try to find the closest match
            let bestMatchIndex = -1;
            let bestMatchScore = 0;
            const searchTextJoined = searchLines.join('\n');

            for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
                const contentSlice = contentLines.slice(i, i + searchLines.length).join('\n');
                let score = 0;
                for (let j = 0; j < Math.min(searchTextJoined.length, contentSlice.length); j++) {
                    if (searchTextJoined[j] === contentSlice[j]) {
                        score++;
                    }
                }
                if (score > bestMatchScore) {
                    bestMatchScore = score;
                    bestMatchIndex = i;
                }
            }

            // If we found a close match, suggest it in the error message
            const closeMatch = bestMatchIndex !== -1 
                ? contentLines.slice(bestMatchIndex, bestMatchIndex + searchLines.length).join('\n')
                : '';

            return {
                success: false,
                error: `Could not find exact match for SEARCH block in ${filename}. SEARCH section must exactly match the file content.

Check for:
1. Extra or missing whitespace
2. Different line endings
3. Incorrect indentation
4. Missing or extra blank lines

Your search text:
${searchTextJoined}

Closest match found:
${closeMatch}

Make sure your SEARCH block exactly matches the file content.`
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred'
            };
        }
    }
}
