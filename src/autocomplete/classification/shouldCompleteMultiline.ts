import { AutocompleteLanguageInfo } from '../constants/AutocompleteLanguageInfo'
import { AutocompleteHelperVars } from '../util/AutocompleteHelperVars'

function shouldCompleteMultilineBasedOnLanguage(language: AutocompleteLanguageInfo, prefix: string, suffix: string) {
    return language.useMultiline?.({ prefix, suffix }) ?? true
}

export function shouldCompleteMultiline(helper: AutocompleteHelperVars) {
    switch (helper.options.multilineCompletions) {
        case 'always':
            return true
        case 'never':
            return false
        default:
            break
    }

    // Always single-line if an intellisense option is selected
    if (helper.input.selectedCompletionInfo) {
        return true
    }

    // Don't complete multi-line for single-line comments
    if (
        helper.lang.singleLineComment &&
        helper.fullPrefix.split('\n').slice(-1)[0]?.trimStart().startsWith(helper.lang.singleLineComment)
    ) {
        return false
    }

    return shouldCompleteMultilineBasedOnLanguage(helper.lang, helper.prunedPrefix, helper.prunedSuffix)
}
