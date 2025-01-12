export const explainCodePrompt = (filePath: string, selectedText: string) => `
Explain the following code from file path @/${filePath}:

\`\`\`
${selectedText}
\`\`\`

Please provide a clear and concise explanation of what this code does, including:
1. The purpose and functionality
2. Key components and their interactions
3. Important patterns or techniques used
`;

export const fixCodePrompt = (filePath: string, selectedText: string, diagnostics?: any[]) => {
    const diagnosticText = diagnostics && diagnostics.length > 0
        ? `\nCurrent problems detected:
${diagnostics.map(d => `- [${d.source || 'Error'}] ${d.message}${d.code ? ` (${d.code})` : ''}`).join('\n')}`
        : '';

    return `
Fix any issues in the following code from file path @/${filePath}
${diagnosticText}

\`\`\`
${selectedText}
\`\`\`

Please:
1. Address all detected problems listed above (if any)
2. Identify any other potential bugs or issues
3. Provide corrected code
4. Explain what was fixed and why
`;
};

export const improveCodePrompt = (filePath: string, selectedText: string) => `
Improve the following code from file path @/${filePath}:

\`\`\`
${selectedText}
\`\`\`

Please suggest improvements for:
1. Code readability and maintainability
2. Performance optimization
3. Best practices and patterns
4. Error handling and edge cases

Provide the improved code along with explanations for each enhancement.
`;