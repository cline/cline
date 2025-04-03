import { AutocompleteCodeSnippet, AutocompleteSnippetType } from '../types'
import { AutocompleteHelperVars } from '../util/AutocompleteHelperVars'

import { ImportDefinitionsService } from './ImportDefinitionsService'
import { RootPathContextService } from './root-path-context/RootPathContextService'

const rx = /[\s.,\/#!$%\^&\*;:{}=\-_`~()\[\]]/g
function getSymbolsForSnippet(snippet: string): Set<string> {
    const symbols = snippet
        .split(rx)
        .map((s) => s.trim())
        .filter((s) => s !== '')
    return new Set(symbols)
}

export class ContextRetrievalService {
    private importDefinitionsService: ImportDefinitionsService
    private rootPathContextService: RootPathContextService

    constructor() {
        this.importDefinitionsService = new ImportDefinitionsService()
        this.rootPathContextService = new RootPathContextService(this.importDefinitionsService)
    }

    public async getSnippetsFromImportDefinitions(helper: AutocompleteHelperVars): Promise<AutocompleteCodeSnippet[]> {
        if (helper.options.useImports === false) {
            return []
        }

        const importSnippets: AutocompleteCodeSnippet[] = []
        const fileInfo = this.importDefinitionsService.get(helper.filepath)
        if (fileInfo) {
            const { imports } = fileInfo
            // Look for imports of any symbols around the current range
            const textAroundCursor =
                helper.fullPrefix.split('\n').slice(-5).join('\n') +
                helper.fullSuffix.split('\n').slice(0, 3).join('\n')
            const symbols = Array.from(getSymbolsForSnippet(textAroundCursor)).filter(
                (symbol) => !helper.lang.topLevelKeywords.includes(symbol)
            )
            for (const symbol of symbols) {
                const rifs = imports[symbol]
                if (Array.isArray(rifs)) {
                    const snippets: AutocompleteCodeSnippet[] = rifs.map((rif) => {
                        return {
                            filepath: rif.filepath,
                            content: rif.contents,
                            type: AutocompleteSnippetType.Code,
                        }
                    })

                    importSnippets.push(...snippets)
                }
            }
        }

        return importSnippets
    }

    public async getRootPathSnippets(helper: AutocompleteHelperVars): Promise<AutocompleteCodeSnippet[]> {
        if (!helper.treePath) {
            return []
        }

        return this.rootPathContextService.getContextForPath(helper.filepath, helper.treePath)
    }
}
