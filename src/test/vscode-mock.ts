// Mock implementation of VSCode API for unit tests
export enum LanguageModelChatMessageRole {
	User = 1,
	Assistant = 2,
}

export enum LanguageModelChatToolMode {
	Auto = 1,
	Required = 2,
}

export class LanguageModelTextPart {
	value: string
	constructor(value: string) {
		this.value = value
	}
}

export class LanguageModelToolCallPart {
	callId: string
	name: string
	input: object
	constructor(callId: string, name: string, input: object) {
		this.callId = callId
		this.name = name
		this.input = input
	}
}

export class LanguageModelPromptTsxPart {
	value: unknown
	constructor(value: unknown) {
		this.value = value
	}
}

export class LanguageModelToolResultPart {
	callId: string
	content: Array<LanguageModelTextPart | LanguageModelPromptTsxPart | unknown>
	constructor(callId: string, content: Array<LanguageModelTextPart | LanguageModelPromptTsxPart | unknown>) {
		this.callId = callId
		this.content = content
	}
}

export class LanguageModelChatMessage {
	role: LanguageModelChatMessageRole
	content: Array<LanguageModelTextPart | LanguageModelToolResultPart | LanguageModelToolCallPart>
	name: string | undefined

	constructor(
		role: LanguageModelChatMessageRole,
		content: string | Array<LanguageModelTextPart | LanguageModelToolResultPart | LanguageModelToolCallPart>,
		name?: string,
	) {
		this.role = role
		this.name = name

		if (typeof content === "string") {
			this.content = [new LanguageModelTextPart(content)]
		} else {
			this.content = content
		}
	}

	static User(
		content: string | Array<LanguageModelTextPart | LanguageModelToolResultPart>,
		name?: string,
	): LanguageModelChatMessage {
		return new LanguageModelChatMessage(LanguageModelChatMessageRole.User, content, name)
	}

	static Assistant(
		content: string | Array<LanguageModelTextPart | LanguageModelToolCallPart>,
		name?: string,
	): LanguageModelChatMessage {
		return new LanguageModelChatMessage(LanguageModelChatMessageRole.Assistant, content, name)
	}
}

// Mock other VSCode APIs that might be needed
export const workspace = {
	onDidChangeConfiguration: () => ({ dispose: () => {} }),
}

export const lm = {
	selectChatModels: async () => [],
}

export class CancellationTokenSource {
	token = { isCancellationRequested: false }
	cancel() {}
	dispose() {}
}

export class CancellationError extends Error {
	constructor(message?: string) {
		super(message)
		this.name = "CancellationError"
	}
}
