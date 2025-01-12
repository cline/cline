type PromptParams = Record<string, string | any[]>;

const generateDiagnosticText = (diagnostics?: any[]) => {
    if (!diagnostics?.length) return '';
    return `\nCurrent problems detected:\n${diagnostics.map(d => 
        `- [${d.source || 'Error'}] ${d.message}${d.code ? ` (${d.code})` : ''}`
    ).join('\n')}`;
};

const createPrompt = (template: string, params: PromptParams): string => {
    let result = template;
    for (const [key, value] of Object.entries(params)) {
        if (key === 'diagnostics') {
            result = result.replaceAll('${diagnosticText}', generateDiagnosticText(value as any[]));
        } else {
            result = result.replaceAll(`\${${key}}`, value as string);
        }
    }
    return result;
};

const EXPLAIN_TEMPLATE = `
Explain the following code from file path @/\${filePath}:

\`\`\`
\${selectedText}
\`\`\`

Please provide a clear and concise explanation of what this code does, including:
1. The purpose and functionality
2. Key components and their interactions
3. Important patterns or techniques used
`;

const FIX_TEMPLATE = `
Fix any issues in the following code from file path @/\${filePath}
\${diagnosticText}

\`\`\`
\${selectedText}
\`\`\`

Please:
1. Address all detected problems listed above (if any)
2. Identify any other potential bugs or issues
3. Provide corrected code
4. Explain what was fixed and why
`;

const IMPROVE_TEMPLATE = `
Improve the following code from file path @/\${filePath}:

\`\`\`
\${selectedText}
\`\`\`

Please suggest improvements for:
1. Code readability and maintainability
2. Performance optimization
3. Best practices and patterns
4. Error handling and edge cases

Provide the improved code along with explanations for each enhancement.
`;

export const explainCodePrompt = (params: PromptParams) => 
    createPrompt(EXPLAIN_TEMPLATE, params);

export const fixCodePrompt = (params: PromptParams) => 
    createPrompt(FIX_TEMPLATE, params);

export const improveCodePrompt = (params: PromptParams) => 
    createPrompt(IMPROVE_TEMPLATE, params);