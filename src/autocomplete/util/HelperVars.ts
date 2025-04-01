import { countTokens, pruneLinesFromBottom, pruneLinesFromTop, pruneWithBinarySearch } from '../../llm/countTokens'
import { getWorkspaceDirs, readFile } from '../../utils/vscode'
import { AutocompleteLanguageInfo, languageForFilepath } from '../constants/AutocompleteLanguageInfo'
import { constructInitialPrefixSuffix } from '../templating/constructPrefixSuffix'
import { TabAutocompleteOptions } from '../types'

import { AstPath, getAst, getTreePathAtCursor } from './ast'
import { AutocompleteInput } from './types'

/**
 * A collection of variables that are often accessed throughout the autocomplete pipeline
 * It's noisy to re-calculate all the time or inject them into each function
 */
export class HelperVars {
    lang: AutocompleteLanguageInfo
    treePath: AstPath | undefined
    workspaceUris: string[] = []

    private _fileContents: string | undefined
    private _fileLines: string[] | undefined
    private _fullPrefix: string | undefined
    private _fullSuffix: string | undefined
    private _prunedPrefix: string | undefined
    private _prunedSuffix: string | undefined

    private constructor(
        public readonly input: AutocompleteInput,
        public readonly options: TabAutocompleteOptions,
        public readonly modelName: string
    ) {
        this.lang = languageForFilepath(input.filepath)
    }

    private async init() {
        // Don't do anything if already initialized
        if (this._fileContents !== undefined) {
            return
        }

        this.workspaceUris = await getWorkspaceDirs()

        this._fileContents = this.input.manuallyPassFileContents ?? (await readFile(this.filepath))

        this._fileLines = this._fileContents.split('\n')

        // Construct full prefix/suffix (a few edge cases handled in here)
        const { prefix: fullPrefix, suffix: fullSuffix } = await constructInitialPrefixSuffix(this.input)
        this._fullPrefix = fullPrefix
        this._fullSuffix = fullSuffix
        const { prunedPrefix, prunedSuffix } = this.prunePrefixSuffix()
        this._prunedPrefix = prunedPrefix
        this._prunedSuffix = prunedSuffix
        try {
            const ast = await getAst(this.filepath, fullPrefix + fullSuffix)
            if (ast) {
                this.treePath = await getTreePathAtCursor(ast, fullPrefix.length)
            }
        } catch (e) {
            console.error('Failed to parse AST', e)
        }
    }

    static async create(
        input: AutocompleteInput,
        options: TabAutocompleteOptions,
        modelName: string
    ): Promise<HelperVars> {
        const instance = new HelperVars(input, options, modelName)
        await instance.init()
        return instance
    }

    prunePrefixSuffix() {
        const maxPrefixTokens = this.options.maxPromptTokens * this.options.prefixPercentage

        // Use binary search for prefix pruning - keep bottom portion
        const prunedPrefix = pruneWithBinarySearch(
            this.fullPrefix,
            maxPrefixTokens,
            this.modelName,
            true // fromBottom = true to keep the most recent content
        )

        // Calculate remaining tokens for suffix
        const prefixTokenCount = countTokens(prunedPrefix, this.modelName)
        const maxSuffixTokens = Math.min(
            this.options.maxPromptTokens - prefixTokenCount,
            this.options.maxPromptTokens * this.options.maxSuffixPercentage
        )

        // Use binary search for suffix pruning - keep top portion
        const prunedSuffix = pruneWithBinarySearch(
            this.fullSuffix,
            maxSuffixTokens,
            this.modelName,
            false // fromBottom = false to keep the content closest to cursor
        )

        return {
            prunedPrefix,
            prunedSuffix,
        }
    }

    // Fast access
    get filepath() {
        return this.input.filepath
    }
    get pos() {
        return this.input.pos
    }

    get prunedCaretWindow() {
        return this.prunedPrefix + this.prunedSuffix
    }

    // Getters for lazy access
    get fileContents(): string {
        if (this._fileContents === undefined) {
            throw new Error('HelperVars must be initialized before accessing fileContents')
        }
        return this._fileContents
    }

    get fileLines(): string[] {
        if (this._fileLines === undefined) {
            throw new Error('HelperVars must be initialized before accessing fileLines')
        }
        return this._fileLines
    }

    get fullPrefix(): string {
        if (this._fullPrefix === undefined) {
            throw new Error('HelperVars must be initialized before accessing fullPrefix')
        }
        return this._fullPrefix
    }

    get fullSuffix(): string {
        if (this._fullSuffix === undefined) {
            throw new Error('HelperVars must be initialized before accessing fullSuffix')
        }
        return this._fullSuffix
    }

    get prunedPrefix(): string {
        if (this._prunedPrefix === undefined) {
            throw new Error('HelperVars must be initialized before accessing prunedPrefix')
        }
        return this._prunedPrefix
    }

    get prunedSuffix(): string {
        if (this._prunedSuffix === undefined) {
            throw new Error('HelperVars must be initialized before accessing prunedSuffix')
        }
        return this._prunedSuffix
    }
}
