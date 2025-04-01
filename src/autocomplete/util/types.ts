import { AutocompleteCodeSnippet } from '../snippets/types'
import { Position, RangeInFile, TabAutocompleteOptions, Range } from '../types'

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
