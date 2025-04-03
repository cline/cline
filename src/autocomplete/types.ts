import Parser from 'web-tree-sitter'
import { AutocompleteLanguageInfo } from './constants/AutocompleteLanguageInfo'
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
} from 'openai/resources/index.mjs'

export interface TabAutocompleteOptions {
    disable: boolean
    maxPromptTokens: number
    debounceDelay: number
    maxSuffixPercentage: number
    prefixPercentage: number
    transform?: boolean
    template?: string
    multilineCompletions: 'always' | 'never' | 'auto'
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
    type: Parser.SyntaxNode['type']
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

export type DiffLineType = 'new' | 'old' | 'same'

export interface DiffLine {
    type: DiffLineType
    line: string
}

export enum AutocompleteSnippetType {
    Code = 'code',
    Diff = 'diff',
    Clipboard = 'clipboard',
}

interface BaseAutocompleteSnippet {
    content: string
    type: AutocompleteSnippetType
}

export interface AutocompleteCodeSnippet extends BaseAutocompleteSnippet {
    filepath: string
    type: AutocompleteSnippetType.Code
}

export interface AutocompleteDiffSnippet extends BaseAutocompleteSnippet {
    type: AutocompleteSnippetType.Diff
}

export interface AutocompleteClipboardSnippet extends BaseAutocompleteSnippet {
    type: AutocompleteSnippetType.Clipboard
    copiedAt: string
}

export type AutocompleteSnippet = AutocompleteCodeSnippet | AutocompleteDiffSnippet | AutocompleteClipboardSnippet

export interface AutocompleteTemplate {
    compilePrefixSuffix?: (
        prefix: string,
        suffix: string,
        filepath: string,
        reponame: string,
        snippets: AutocompleteSnippet[],
        workspaceUris: string[]
    ) => [string, string]
    template:
        | string
        | ((
              prefix: string,
              suffix: string,
              filepath: string,
              reponame: string,
              language: string,
              snippets: AutocompleteSnippet[],
              workspaceUris: string[]
          ) => string)
    completionOptions?: Partial<CompletionOptions>
}

export interface CompletionOptions {
    stop?: string[]
}

export type RecentlyEditedRange = RangeInFile & {
    timestamp: number
    lines: string[]
    symbols: Set<string>
}

export interface AutocompleteInput {
    isUntitledFile: boolean
    completionId: string
    filepath: string
    pos: Position
    recentlyVisitedRanges: AutocompleteCodeSnippet[]
    recentlyEditedRanges: RecentlyEditedRange[]
    // Used for notebook files
    manuallyPassFileContents?: string
    // Used for VS Code git commit input box
    manuallyPassPrefix?: string
    selectedCompletionInfo?: {
        text: string
        range: Range
    }
    injectDetails?: string
}

export interface AutocompleteOutcome extends TabAutocompleteOptions {
    accepted?: boolean
    time: number
    prefix: string
    suffix: string
    prompt: string
    completion: string
    modelProvider: string
    modelName: string
    completionOptions: any
    cacheHit: boolean
    numLines: number
    filepath: string
    gitRepo?: string
    completionId: string
    uniqueId: string
    timestamp: number
}
