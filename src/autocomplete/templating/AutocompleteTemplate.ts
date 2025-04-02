// Fill in the middle prompts

import { getLastNUriRelativePathParts, getShortestUniqueRelativeUriPaths } from '../../utils/uri.js'
import { AutocompleteSnippetType, AutocompleteTemplate } from '../types.js'

export const codestralMultifileFimTemplate: AutocompleteTemplate = {
    compilePrefixSuffix: (prefix, suffix, filepath, reponame, snippets, workspaceUris): [string, string] => {
        function getFileName(snippet: { uri: string; uniquePath: string }) {
            return snippet.uri.startsWith('file://') ? snippet.uniquePath : snippet.uri
        }

        if (snippets.length === 0) {
            if (suffix.trim().length === 0 && prefix.trim().length === 0) {
                return [`+++++ ${getLastNUriRelativePathParts(workspaceUris, filepath, 2)}\n${prefix}`, suffix]
            }
            return [prefix, suffix]
        }

        const relativePaths = getShortestUniqueRelativeUriPaths(
            [
                ...snippets.map((snippet) => ('filepath' in snippet ? snippet.filepath : 'file:///Untitled.txt')),
                filepath,
            ],
            workspaceUris
        )

        const otherFiles = snippets
            .map((snippet, i) => {
                if (snippet.type === AutocompleteSnippetType.Diff) {
                    return snippet.content
                }

                return `+++++ ${getFileName(relativePaths[i])} \n${snippet.content}`
            })
            .join('\n\n')

        return [`${otherFiles}\n\n+++++ ${getFileName(relativePaths[relativePaths.length - 1])}\n${prefix}`, suffix]
    },
    template: (prefix: string, suffix: string): string => {
        return `[SUFFIX]${suffix}[PREFIX]${prefix}`
    },
    completionOptions: {
        stop: ['[PREFIX]', '[SUFFIX]', '\n+++++ '],
    },
}
