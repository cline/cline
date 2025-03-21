/**
 * Predefined header templates for OpenAI-compatible API providers
 */

export interface HeaderTemplate {
	name: string
	description: string
	headers: Record<string, string>
}

/**
 * Collection of predefined header templates for OpenAI-compatible endpoints
 */
export const OPENAI_HEADER_TEMPLATES: Record<string, HeaderTemplate> = {
	openWebUI: {
		name: "Open WebUI",
		description: "Authentication for Open WebUI instances",
		headers: {
			Authorization: "Bearer ${apiKey}",
		},
	},
	azureApiGateway: {
		name: "Azure API Gateway",
		description: "Custom authentication for Azure API Management Gateway",
		headers: {
			"Api-Key": "${apiKey}",
			"Ocp-Apim-Subscription-Key": "${subscriptionKey}",
		},
	},
	// Can add more templates as needed
}

/**
 * Process template variables in headers
 * @param template The template to process
 * @param variables The variables to substitute
 * @returns Processed headers with variables replaced
 */
export function processHeaderTemplate(template: HeaderTemplate, variables: Record<string, string>): Record<string, string> {
	const processedHeaders: Record<string, string> = {}

	for (const [key, value] of Object.entries(template.headers)) {
		let processedValue = value

		// Replace template variables
		for (const [varName, varValue] of Object.entries(variables)) {
			const placeholder = `\${${varName}}`
			processedValue = processedValue.replace(placeholder, varValue)
		}

		processedHeaders[key] = processedValue
	}

	return processedHeaders
}
