// Mock for the `@google/genai` module to avoid ESM-in-CommonJS compatibility
// issues in the VS Code integration test build (the `out/` tree runs as
// CommonJS). Loaded by test-setup.js, which intercepts `require("@google/genai")`.
//
// Previously colocated as apps/vscode/src/core/api/providers/gemini-mock.test.ts
// alongside the legacy Gemini provider; kept as a standalone test fixture after
// the legacy provider handlers were removed.

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
