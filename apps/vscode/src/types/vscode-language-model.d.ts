// Ambient augmentation of the `vscode` module for the Language Model (LM) API.
//
// Cline does not bump its VSCode engine requirement / @types/vscode version to
// pick up the Language Model API typings, so we declare the subset we use here.
// This was previously colocated in the now-removed legacy VS Code LM provider
// handler; it is kept as a standalone ambient declaration because live code
// (e.g. the getVsCodeLmModels gRPC handler, vsCodeSelectorUtils, and the
// vscode-lm message transform) still depends on these types.
//
// Extracted from:
// https://github.com/microsoft/vscode/blob/131ee0ef660d600cd0a7e6058375b281553abe20/src/vscode-dts/vscode.d.ts

declare module "vscode" {
	enum LanguageModelChatMessageRole {
		User = 1,
		Assistant = 2,
	}
	enum LanguageModelChatToolMode {
		Auto = 1,
		Required = 2,
	}
	interface LanguageModelChatSelector {
		vendor?: string
		family?: string
		version?: string
		id?: string
	}
	interface LanguageModelChatTool {
		name: string
		description: string
		inputSchema?: object
	}
	interface LanguageModelChatRequestOptions {
		justification?: string
		modelOptions?: { [name: string]: any }
		tools?: LanguageModelChatTool[]
		toolMode?: LanguageModelChatToolMode
	}
	class LanguageModelTextPart {
		value: string
		constructor(value: string)
	}
	class LanguageModelToolCallPart {
		callId: string
		name: string
		input: object
		constructor(callId: string, name: string, input: object)
	}
	interface LanguageModelChatResponse {
		stream: AsyncIterable<LanguageModelTextPart | LanguageModelToolCallPart | unknown>
		text: AsyncIterable<string>
	}
	interface LanguageModelChat {
		readonly name: string
		readonly id: string
		readonly vendor: string
		readonly family: string
		readonly version: string
		readonly maxInputTokens: number

		sendRequest(
			messages: LanguageModelChatMessage[],
			options?: LanguageModelChatRequestOptions,
			token?: CancellationToken,
		): Thenable<LanguageModelChatResponse>
		countTokens(text: string | LanguageModelChatMessage, token?: CancellationToken): Thenable<number>
	}
	class LanguageModelPromptTsxPart {
		value: unknown
		constructor(value: unknown)
	}
	class LanguageModelToolResultPart {
		callId: string
		content: Array<LanguageModelTextPart | LanguageModelPromptTsxPart | unknown>
		constructor(callId: string, content: Array<LanguageModelTextPart | LanguageModelPromptTsxPart | unknown>)
	}
	class LanguageModelChatMessage {
		static User(
			content: string | Array<LanguageModelTextPart | LanguageModelToolResultPart>,
			name?: string,
		): LanguageModelChatMessage
		static Assistant(
			content: string | Array<LanguageModelTextPart | LanguageModelToolCallPart>,
			name?: string,
		): LanguageModelChatMessage

		role: LanguageModelChatMessageRole
		content: Array<LanguageModelTextPart | LanguageModelToolResultPart | LanguageModelToolCallPart>
		name: string | undefined

		constructor(
			role: LanguageModelChatMessageRole,
			content: string | Array<LanguageModelTextPart | LanguageModelToolResultPart | LanguageModelToolCallPart>,
			name?: string,
		)
	}
	namespace lm {
		function selectChatModels(selector?: LanguageModelChatSelector): Thenable<LanguageModelChat[]>
	}
}
