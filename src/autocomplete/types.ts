import Parser from "web-tree-sitter"
import { AutocompleteLanguageInfo } from "./constants/AutocompleteLanguageInfo"
import { AutocompleteCodeSnippet } from "./snippets/types"
import {
	ChatCompletion,
	ChatCompletionChunk,
	ChatCompletionCreateParamsNonStreaming,
	ChatCompletionCreateParamsStreaming,
	Completion,
	CompletionCreateParamsNonStreaming,
	CompletionCreateParamsStreaming,
	CreateEmbeddingResponse,
	EmbeddingCreateParams,
	Model,
} from "openai/resources/index.mjs"

export type GetLspDefinitionsFunction = (
	filepath: string,
	contents: string,
	cursorIndex: number,
	lang: AutocompleteLanguageInfo,
) => Promise<AutocompleteCodeSnippet[]>

export interface TabAutocompleteOptions {
	disable: boolean
	maxPromptTokens: number
	debounceDelay: number
	maxSuffixPercentage: number
	prefixPercentage: number
	transform?: boolean
	template?: string
	multilineCompletions: "always" | "never" | "auto"
	slidingWindowPrefixPercentage: number
	slidingWindowSize: number
	useCache: boolean
	onlyMyCode: boolean
	useRecentlyEdited: boolean
	disableInFiles?: string[]
	useImports?: boolean
	showWhateverWeHaveAtXMs?: number
	// true = enabled, false = disabled, number = enabled with priority
	experimental_includeClipboard: boolean | number
	experimental_includeRecentlyVisitedRanges: boolean | number
	experimental_includeRecentlyEditedRanges: boolean | number
	experimental_includeDiff: boolean | number
}

export interface Position {
	line: number
	character: number
}

export interface Range {
	start: Position
	end: Position
}

export interface RangeInFile {
	filepath: string
	range: Range
}

export interface SymbolWithRange extends RangeInFile {
	name: string
	type: Parser.SyntaxNode["type"]
	content: string
}

export type FileSymbolMap = Record<string, SymbolWithRange[]>

export interface RangeInFileWithContents {
	filepath: string
	range: {
		start: { line: number; character: number }
		end: { line: number; character: number }
	}
	contents: string
}

export interface Location {
	filepath: string
	position: Position
}

export interface RangeInFileWithContents {
	filepath: string
	range: {
		start: { line: number; character: number }
		end: { line: number; character: number }
	}
	contents: string
}

export type AutocompleteSnippetWithScore = RangeInFileWithContents & {
	score?: number
}

export type TextMessagePart = {
	type: "text"
	text: string
}

export type ImageMessagePart = {
	type: "imageUrl"
	imageUrl: { url: string }
}

export type MessagePart = TextMessagePart | ImageMessagePart

export type MessageContent = string | MessagePart[]

export interface ToolCall {
	id: string
	type: "function"
	function: {
		name: string
		arguments: string
	}
}

export interface ToolCallDelta {
	id?: string
	type?: "function"
	function?: {
		name?: string
		arguments?: string
	}
}

export interface ToolResultChatMessage {
	role: "tool"
	content: string
	toolCallId: string
}

export interface UserChatMessage {
	role: "user"
	content: MessageContent
}

export interface ThinkingChatMessage {
	role: "thinking"
	content: MessageContent
	signature?: string
	redactedThinking?: string
	toolCalls?: ToolCallDelta[]
}

export interface AssistantChatMessage {
	role: "assistant"
	content: MessageContent
	toolCalls?: ToolCallDelta[]
}

export interface SystemChatMessage {
	role: "system"
	content: string
}

export type ChatMessage = UserChatMessage | AssistantChatMessage | ThinkingChatMessage | SystemChatMessage | ToolResultChatMessage

export interface FimCreateParamsStreaming extends CompletionCreateParamsStreaming {
	suffix: string
}

export interface RerankCreateParams {
	query: string
	documents: string[]
	model: string
	top_k?: number
}

export interface CreateRerankItem {
	relevance_score: number
	index: number
}

export interface CreateRerankResponse {
	object: "list"
	data: CreateRerankItem[]
	model: string
	usage: {
		total_tokens: number
	}
}

export interface BaseLlmApi {
	// Chat, no stream
	chatCompletionNonStream(body: ChatCompletionCreateParamsNonStreaming, signal: AbortSignal): Promise<ChatCompletion>

	// Chat, stream
	chatCompletionStream(body: ChatCompletionCreateParamsStreaming, signal: AbortSignal): AsyncGenerator<ChatCompletionChunk>

	// Completion, no stream
	completionNonStream(body: CompletionCreateParamsNonStreaming, signal: AbortSignal): Promise<Completion>

	// Completion, stream
	completionStream(body: CompletionCreateParamsStreaming, signal: AbortSignal): AsyncGenerator<Completion>

	// FIM, stream
	fimStream(body: FimCreateParamsStreaming, signal: AbortSignal): AsyncGenerator<ChatCompletionChunk>

	// Embeddings
	embed(body: EmbeddingCreateParams): Promise<CreateEmbeddingResponse>

	// Reranking
	rerank(body: RerankCreateParams): Promise<CreateRerankResponse>

	// List Models
	list(): Promise<Model[]>
}

export type DiffLineType = "new" | "old" | "same"

export interface DiffLine {
	type: DiffLineType
	line: string
}
