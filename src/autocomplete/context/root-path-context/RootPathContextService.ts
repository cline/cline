import { createHash } from 'crypto'

import { LRUCache } from 'lru-cache'
import Parser from 'web-tree-sitter'

import { getFullLanguageName, getQueryForFile, IGNORE_PATH_PATTERNS, LanguageName } from '../../util/treeSitter'
import { AstPath } from '../../util/ast'
import { ImportDefinitionsService } from '../ImportDefinitionsService'
import { AutocompleteCodeSnippet, AutocompleteSnippetType, AutocompleteSnippetWithScore } from '../../types'
import { gotoDefinition, readRangeInFile } from '../../../utils/vscode'

export class RootPathContextService {
    private cache = new LRUCache<string, AutocompleteSnippetWithScore[]>({
        max: 100,
    })

    constructor(private readonly importDefinitionsService: ImportDefinitionsService) {}

    private static getNodeId(node: Parser.SyntaxNode): string {
        return `${node.startIndex}`
    }

    private static TYPES_TO_USE = new Set([
        'arrow_function',
        'generator_function_declaration',
        'program',
        'function_declaration',
        'function_definition',
        'method_definition',
        'method_declaration',
        'class_declaration',
        'class_definition',
    ])

    /**
     * Key comes from hash of parent key and node type and node id.
     */
    private static keyFromNode(parentKey: string, astNode: Parser.SyntaxNode): string {
        return createHash('sha256')
            .update(parentKey)
            .update(astNode.type)
            .update(RootPathContextService.getNodeId(astNode))
            .digest('hex')
    }

    private async getSnippetsForNode(
        filepath: string,
        node: Parser.SyntaxNode
    ): Promise<AutocompleteSnippetWithScore[]> {
        const snippets: AutocompleteSnippetWithScore[] = []
        const language = getFullLanguageName(filepath)

        let query: Parser.Query | undefined
        switch (node.type) {
            case 'program':
                this.importDefinitionsService.get(filepath)
                break
            default:
                // const type = node.type;
                // console.log(getSyntaxTreeString(node));
                // debugger;

                query = await getQueryForFile(filepath, `root-path-context-queries/${language}/${node.type}.scm`)
                break
        }

        if (!query) {
            return snippets
        }

        const queries = query.matches(node).map(async (match) => {
            for (const item of match.captures) {
                try {
                    const endPosition = item.node.endPosition
                    const newSnippets = await this.getSnippets(filepath, endPosition, language)
                    snippets.push(...newSnippets)
                } catch (e) {
                    throw e
                }
            }
        })

        await Promise.all(queries)

        return snippets
    }

    private async getSnippets(
        filepath: string,
        endPosition: Parser.Point,
        language: LanguageName
    ): Promise<AutocompleteSnippetWithScore[]> {
        const definitions = await gotoDefinition({
            filepath,
            position: {
                line: endPosition.row,
                character: endPosition.column,
            },
        })
        const newSnippets = await Promise.all(
            definitions
                .filter((definition) => {
                    const isIgnoredPath = IGNORE_PATH_PATTERNS[language]?.some((pattern) =>
                        pattern.test(definition.filepath)
                    )

                    return !isIgnoredPath
                })
                .map(async (def) => ({
                    ...def,
                    contents: await readRangeInFile(def.filepath, def.range),
                }))
        )

        return newSnippets
    }

    async getContextForPath(
        filepath: string,
        astPath: AstPath
        // cursorIndex: number,
    ): Promise<AutocompleteCodeSnippet[]> {
        const snippets: AutocompleteCodeSnippet[] = []

        let parentKey = filepath
        for (const astNode of astPath.filter((node) => RootPathContextService.TYPES_TO_USE.has(node.type))) {
            const key = RootPathContextService.keyFromNode(parentKey, astNode)

            const foundInCache = this.cache.get(key)
            const newSnippets = foundInCache ?? (await this.getSnippetsForNode(filepath, astNode))

            const formattedSnippets: AutocompleteCodeSnippet[] = newSnippets.map((item) => ({
                filepath: item.filepath,
                content: item.contents,
                type: AutocompleteSnippetType.Code,
            }))

            snippets.push(...formattedSnippets)

            if (!foundInCache) {
                this.cache.set(key, newSnippets)
            }

            parentKey = key
        }

        return snippets
    }
}
