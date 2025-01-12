type PromptParams = Record<string, string | any[]>;

const generateDiagnosticText = (diagnostics?: any[]) => {
    if (!diagnostics?.length) return '';
    return `\nCurrent problems detected:\n${diagnostics.map(d =>
        `- [${d.source || 'Error'}] ${d.message}${d.code ? ` (${d.code})` : ''}`
    ).join('\n')}`;
};

export const createPrompt = (template: string, params: PromptParams): string => {
    let result = template;
    for (const [key, value] of Object.entries(params)) {
        if (key === 'diagnostics') {
            result = result.replaceAll('${diagnosticText}', generateDiagnosticText(value as any[]));
        } else {
            result = result.replaceAll(`\${${key}}`, value as string);
        }
    }

    // Replace any remaining user_input placeholders with empty string
    result = result.replaceAll('${userInput}', '');

    return result;
};

export const EXPLAIN_TEMPLATE = `
Explain the following code from file path @/\${filePath}:
\${userInput}

\`\`\`
\${selectedText}
\`\`\`

Please provide a clear and concise explanation of what this code does, including:
1. The purpose and functionality
2. Key components and their interactions
3. Important patterns or techniques used
`;

export const FIX_TEMPLATE = `
Fix any issues in the following code from file path @/\${filePath}
\${diagnosticText}
\${userInput}

\`\`\`
\${selectedText}
\`\`\`

Please:
1. Address all detected problems listed above (if any)
2. Identify any other potential bugs or issues
3. Provide corrected code
4. Explain what was fixed and why
`;

export const IMPROVE_TEMPLATE = `
Improve the following code from file path @/\${filePath}:
\${userInput}

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

// Get template based on prompt type
export const defaultTemplates = {
    'EXPLAIN': EXPLAIN_TEMPLATE,
    'FIX': FIX_TEMPLATE,
    'IMPROVE': IMPROVE_TEMPLATE
}