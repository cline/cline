import { AutocompleteLanguageInfo } from '../constants/AutocompleteLanguageInfo'
import { CompletionOptions } from '../types'

// TODO: Do we want to stop completions when reaching a `/src/` string?
const SRC_DIRECTORY = '/src/'
// Starcoder2 tends to output artifacts starting with the letter "t"
const PYTHON_ENCODING = '#- coding: utf-8'
const CODE_BLOCK_END = '```'

// const multilineStops: string[] = [DOUBLE_NEWLINE, WINDOWS_DOUBLE_NEWLINE];
const commonStops = [SRC_DIRECTORY, PYTHON_ENCODING, CODE_BLOCK_END]

export function getStopTokens(
    completionOptions: Partial<CompletionOptions> | undefined,
    lang: AutocompleteLanguageInfo,
    model: string
): string[] {
    const stopTokens = [
        ...(completionOptions?.stop || []),
        // ...multilineStops,
        ...commonStops,
    ]

    return stopTokens
}
