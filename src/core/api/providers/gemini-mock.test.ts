// Mock for @google/genai module to avoid ESM compatibility issues in tests

export class GoogleGenAI {
	constructor(_options: any) {
		// Mock constructor
	}

	models = {
		generateContentStream: async (_params: any) => {
			// Mock implementation that returns an async iterator
			return {
				async *[Symbol.asyncIterator]() {
					yield {
						text: "Mock response",
						candidates: [],
						usageMetadata: {
							promptTokenCount: 100,
							candidatesTokenCount: 50,
							thoughtsTokenCount: 0,
							cachedContentTokenCount: 0,
						},
					}
				},
			}
		},
		countTokens: async (_params: any) => {
			// Mock token counting
			return {
				totalTokens: 100,
			}
		},
	}
}

// Export mock types
export interface GenerateContentConfig {
	httpOptions?: any
	systemInstruction?: string
	temperature?: number
	thinkingConfig?: any
}

export interface GenerateContentResponseUsageMetadata {
	promptTokenCount?: number
	candidatesTokenCount?: number
	thoughtsTokenCount?: number
	cachedContentTokenCount?: number
}

export interface Part {
	thought?: boolean
	text?: string
}
