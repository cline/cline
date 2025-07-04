/**
 * Mock implementation of @google/genai for unit testing
 * This avoids ESM/CommonJS compatibility issues during tests
 */

// Mock for GoogleGenAI class
export class GoogleGenAI {
	constructor(options?: any) {
		// Mock constructor
	}

	models = {
		generateContentStream: async function* (options: any) {
			// Mock streaming response
			yield {
				text: "Mock response",
				usageMetadata: {
					promptTokenCount: 100,
					candidatesTokenCount: 50,
					thoughtsTokenCount: 0,
					cachedContentTokenCount: 0,
				},
			}
		},
		countTokens: async (options: any) => {
			// Mock token counting
			return { totalTokens: 100 }
		},
	}
}

// Mock for Part interface
export interface Part {
	text?: string
	thought?: string
}

// Mock for GenerateContentConfig interface
export interface GenerateContentConfig {
	httpOptions?: any
	systemInstruction?: string
	temperature?: number
	thinkingConfig?: {
		thinkingBudget: number
		includeThoughts: boolean
	}
}

// Mock for GenerateContentResponseUsageMetadata interface
export interface GenerateContentResponseUsageMetadata {
	promptTokenCount?: number
	candidatesTokenCount?: number
	thoughtsTokenCount?: number
	cachedContentTokenCount?: number
}

// Export everything that might be imported from @google/genai
export default {
	GoogleGenAI,
}
