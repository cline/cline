// Support prompts
type PromptParams = Record<string, string | any[]>

const generateDiagnosticText = (diagnostics?: any[]) => {
	if (!diagnostics?.length) return ""
	return `\nCurrent problems detected:\n${diagnostics
		.map((d) => `- [${d.source || "Error"}] ${d.message}${d.code ? ` (${d.code})` : ""}`)
		.join("\n")}`
}

export const createPrompt = (template: string, params: PromptParams): string => {
	let result = template
	for (const [key, value] of Object.entries(params)) {
		if (key === "diagnostics") {
			result = result.replaceAll("${diagnosticText}", generateDiagnosticText(value as any[]))
		} else {
			result = result.replaceAll(`\${${key}}`, value as string)
		}
	}

	// Replace any remaining user_input placeholders with empty string
	result = result.replaceAll("${userInput}", "")

	return result
}

const EXPLAIN_TEMPLATE = `Explain the following code from file path @/\${filePath}:
\${userInput}

\`\`\`
\${selectedText}
\`\`\`

Please provide a clear and concise explanation of what this code does, including:
1. The purpose and functionality
2. Key components and their interactions
3. Important patterns or techniques used
`

const FIX_TEMPLATE = `Fix any issues in the following code from file path @/\${filePath}
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
`

const IMPROVE_TEMPLATE = `Improve the following code from file path @/\${filePath}:
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
`

const ENHANCE_TEMPLATE = `Generate an enhanced version of this prompt (reply with only the enhanced prompt - no conversation, explanations, lead-in, bullet points, placeholders, or surrounding quotes):

\${userInput}`

// Get template based on prompt type
const defaultTemplates = {
	EXPLAIN: EXPLAIN_TEMPLATE,
	FIX: FIX_TEMPLATE,
	IMPROVE: IMPROVE_TEMPLATE,
	ENHANCE: ENHANCE_TEMPLATE,
} as const

type SupportPromptType = keyof typeof defaultTemplates

export const supportPrompt = {
	default: defaultTemplates,
	get: (customSupportPrompts: Record<string, any> | undefined, type: SupportPromptType): string => {
		return customSupportPrompts?.[type] ?? defaultTemplates[type]
	},
	create: (type: SupportPromptType, params: PromptParams, customSupportPrompts?: Record<string, any>): string => {
		const template = supportPrompt.get(customSupportPrompts, type)
		return createPrompt(template, params)
	},
} as const

export type { SupportPromptType }

// User-friendly labels for support prompt types
export const supportPromptLabels: Record<SupportPromptType, string> = {
	FIX: "Fix Issues",
	EXPLAIN: "Explain Code",
	IMPROVE: "Improve Code",
	ENHANCE: "Enhance Prompt",
} as const

export type CustomSupportPrompts = {
	[key: string]: string | undefined
}
