import Handlebars from 'handlebars'

import { AutocompleteLanguageInfo } from '../constants/AutocompleteLanguageInfo'
import { HelperVars } from '../util/HelperVars'

import { SnippetPayload } from '../snippets'
import { AutocompleteTemplate, getTemplateForModel } from './AutocompleteTemplate'
import { getSnippets } from './filtering'
import { formatSnippets } from './formatting'
import { getStopTokens } from './getStopTokens'
import { getUriPathBasename } from '../../utils/uri'
import { CompletionOptions } from '../api/mistral'

function getTemplate(helper: HelperVars): AutocompleteTemplate {
    if (helper.options.template) {
        return {
            template: helper.options.template,
            completionOptions: {},
            compilePrefixSuffix: undefined,
        }
    }
    return getTemplateForModel(helper.modelName)
}

function renderStringTemplate(
    template: string,
    prefix: string,
    suffix: string,
    lang: AutocompleteLanguageInfo,
    filepath: string,
    reponame: string
) {
    const filename = getUriPathBasename(filepath)
    const compiledTemplate = Handlebars.compile(template)

    return compiledTemplate({
        prefix,
        suffix,
        filename,
        reponame,
        language: lang.name,
    })
}

export function renderPrompt({
    snippetPayload,
    workspaceDirs,
    helper,
}: {
    snippetPayload: SnippetPayload
    workspaceDirs: string[]
    helper: HelperVars
}): {
    prompt: string
    prefix: string
    suffix: string
    completionOptions: Partial<CompletionOptions> | undefined
} {
    // If prefix is manually passed
    let prefix = helper.input.manuallyPassPrefix || helper.prunedPrefix
    let suffix = helper.input.manuallyPassPrefix ? '' : helper.prunedSuffix
    if (suffix === '') {
        suffix = '\n'
    }

    const reponame = getUriPathBasename(workspaceDirs[0] ?? 'myproject')

    const { template, compilePrefixSuffix, completionOptions } = getTemplate(helper)

    const snippets = getSnippets(helper, snippetPayload)

    // Some models have prompts that need two passes. This lets us pass the compiled prefix/suffix
    // into either the 2nd template to generate a raw string, or to pass prefix, suffix to a FIM endpoint
    if (compilePrefixSuffix) {
        ;[prefix, suffix] = compilePrefixSuffix(
            prefix,
            suffix,
            helper.filepath,
            reponame,
            snippets,
            helper.workspaceUris
        )
    } else {
        const formattedSnippets = formatSnippets(helper, snippets, workspaceDirs)
        prefix = [formattedSnippets, prefix].join('\n')
    }

    const prompt =
        // Templates can be passed as a Handlebars template string or a function
        typeof template === 'string'
            ? renderStringTemplate(template, prefix, suffix, helper.lang, helper.filepath, reponame)
            : template(prefix, suffix, helper.filepath, reponame, helper.lang.name, snippets, helper.workspaceUris)

    const stopTokens = getStopTokens(completionOptions, helper.lang, helper.modelName)

    return {
        prompt,
        prefix,
        suffix,
        completionOptions: {
            ...completionOptions,
            stop: stopTokens,
        },
    }
}
