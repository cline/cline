import * as vscode from 'vscode'
import * as URI from 'uri-js'
import { RangeInFile, Location, Range } from '../autocomplete/types'
import { machineIdSync } from 'node-machine-id'

const MAX_BYTES = 100000

export async function readFile(fileUri: string): Promise<string> {
    try {
        const uri = vscode.Uri.parse(fileUri)

        // First, check whether it's a notebook document
        // Need to iterate over the cells to get full contents
        const notebook =
            vscode.workspace.notebookDocuments.find((doc) => URI.equal(doc.uri.toString(), uri.toString())) ??
            (uri.path.endsWith('ipynb') ? await vscode.workspace.openNotebookDocument(uri) : undefined)
        if (notebook) {
            return notebook
                .getCells()
                .map((cell) => cell.document.getText())
                .join('\n\n')
        }

        // Check whether it's an open document
        const openTextDocument = vscode.workspace.textDocuments.find((doc) =>
            URI.equal(doc.uri.toString(), uri.toString())
        )
        if (openTextDocument !== undefined) {
            return openTextDocument.getText()
        }

        const fileStats = await vscode.workspace.fs.stat(uri)
        if (fileStats.size > 10 * MAX_BYTES) {
            return ''
        }

        const bytes = await vscode.workspace.fs.readFile(uri)

        // Truncate the buffer to the first MAX_BYTES
        const truncatedBytes = bytes.slice(0, MAX_BYTES)
        const contents = new TextDecoder().decode(truncatedBytes)
        return contents
    } catch (e) {
        return ''
    }
}

export function onDidChangeActiveTextEditor(callback: (uri: string) => void): void {
    vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
            callback(editor.document.uri.toString())
        }
    })
}

export async function getWorkspaceDirs(): Promise<string[]> {
    return vscode.workspace.workspaceFolders?.map((folder) => folder.uri.toString()) || []
}

const MAX_CACHE_SIZE = 500
const gotoCache = new Map<string, RangeInFile[]>()

export async function gotoDefinition(location: Location): Promise<RangeInFile[]> {
    const input = {
        uri: vscode.Uri.parse(location.filepath),
        line: location.position.line,
        character: location.position.character,
        name: 'vscode.executeDefinitionProvider',
    }
    const cacheKey = `${input.name}${input.uri.toString()}${input.line}${input.character}`
    const cached = gotoCache.get(cacheKey)
    if (cached) {
        return cached
    }

    try {
        const definitions = (await vscode.commands.executeCommand(
            input.name,
            input.uri,
            new vscode.Position(input.line, input.character)
        )) as any

        const results = definitions
            .filter((d: any) => (d.targetUri || d.uri) && (d.targetRange || d.range))
            .map((d: any) => ({
                filepath: (d.targetUri || d.uri).toString(),
                range: d.targetRange || d.range,
            }))

        // Add to cache
        if (gotoCache.size >= MAX_CACHE_SIZE) {
            // Remove the oldest item from the cache
            const oldestKey = gotoCache.keys().next().value
            if (oldestKey) {
                gotoCache.delete(oldestKey)
            }
        }
        gotoCache.set(cacheKey, results)

        return results
    } catch (e) {
        console.warn(`Error executing ${input.name}:`, e)
        return []
    }
}

export async function readRangeInFile(fileUri: string, range: Range): Promise<string> {
    const _range = new vscode.Range(
        new vscode.Position(range.start.line, range.start.character),
        new vscode.Position(range.end.line, range.end.character)
    )
    const contents = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.parse(fileUri)))
    const lines = contents.split('\n')
    return `${lines.slice(_range.start.line, _range.end.line).join('\n')}\n${lines[
        _range.end.line < lines.length - 1 ? _range.end.line : lines.length - 1
    ].slice(0, _range.end.character)}`
}

export async function getClipboardContent(context: vscode.ExtensionContext) {
    return context.workspaceState.get('posthog.copyBuffer', {
        text: '',
        copiedAt: new Date('1900-01-01').toISOString(),
    })
}

function splitDiff(diffString: string): string[] {
    const fileDiffHeaderRegex = /(?=diff --git a\/.* b\/.*)/

    const diffs = diffString.split(fileDiffHeaderRegex)

    if (diffs[0].trim() === '') {
        diffs.shift()
    }

    return diffs
}

function getRepositories() {
    const extension = vscode.extensions.getExtension('vscode.git')
    if (
        typeof extension === 'undefined' ||
        !extension.isActive ||
        typeof vscode.workspace.workspaceFolders === 'undefined'
    ) {
        return undefined
    }

    try {
        const git = extension.exports.getAPI(1)
        return git.repositories
    } catch (e) {
        console.warn('Git not found: ', e)
        return undefined
    }
}

export async function getDiff(includeUnstaged: boolean): Promise<string[]> {
    const diffs: string[] = []

    const repos = getRepositories()

    try {
        if (repos) {
            for (const repo of repos) {
                const staged = await repo.diff(true)

                diffs.push(staged)
                if (includeUnstaged) {
                    const unstaged = await repo.diff(false)
                    diffs.push(unstaged)
                }
            }
        }

        return diffs.flatMap((diff) => splitDiff(diff))
    } catch (e) {
        console.error(e)
        return []
    }
}

export async function getRepo(dir: string) {
    // Use the native git extension to get the branch name
    const extension = vscode.extensions.getExtension('vscode.git')
    if (
        typeof extension === 'undefined' ||
        !extension.isActive ||
        typeof vscode.workspace.workspaceFolders === 'undefined'
    ) {
        return undefined
    }

    try {
        const git = extension.exports.getAPI(1)
        return git.getRepository(vscode.Uri.parse(dir)) ?? undefined
    } catch (e) {
        console.warn('Git not found: ', e)
        return undefined
    }
}

export async function getRepoName(dir: string): Promise<string | undefined> {
    const repo = await getRepo(dir)
    const remotes = repo?.state.remotes
    if (!remotes) {
        return undefined
    }
    const remote = remotes?.find((r: any) => r.name === 'origin') ?? remotes?.[0]
    if (!remote) {
        return undefined
    }
    const ownerAndRepo = remote.fetchUrl?.replace('.git', '').split('/').slice(-2)
    return ownerAndRepo?.join('/')
}

export function getUniqueId() {
    const id = vscode.env.machineId
    if (id === 'someValue.machineId') {
        return machineIdSync()
    }
    return vscode.env.machineId
}
