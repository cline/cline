// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { setTimeout as setTimeoutPromise } from 'node:timers/promises'
import * as vscode from 'vscode'
import { Logger } from './services/logging/Logger'
import { createPostHogAPI } from './exports'
import './utils/path' // necessary to have access to String.prototype.toPosix
import { DIFF_VIEW_URI_SCHEME } from './integrations/editor/DiffViewProvider'
import assert from 'node:assert'
import { telemetryService } from './services/telemetry/TelemetryService'
import { PostHogProvider } from './core/webview/PostHogProvider'
import { CompletionProvider } from './autocomplete/CompletionProvider'
import {
    getStatusBarStatus,
    getStatusBarStatusFromQuickPickItemLabel,
    quickPickStatusText,
    setupStatusBar,
    StatusBarStatus,
} from './autocomplete/statusBar'
import { PostHogApiProvider } from './api/provider'
import { autocompleteDefaultModelId } from './shared/api'
import { CodeAnalyzer } from './analysis/codeAnalyzer'
import { debounce } from './utils/debounce'

/*
Built using https://github.com/microsoft/vscode-webview-ui-toolkit

Inspired by
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/default/weather-webview
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/tree/main/frameworks/hello-world-react-cra

*/

let outputChannel: vscode.OutputChannel

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('PostHog')
    context.subscriptions.push(outputChannel)

    Logger.initialize(outputChannel)
    Logger.log('PostHog extension activated')

    const sidebarProvider = new PostHogProvider(context, outputChannel)

    vscode.commands.executeCommand('setContext', 'posthog.isDevMode', IS_DEV && IS_DEV === 'true')

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(PostHogProvider.sideBarId, sidebarProvider, {
            webviewOptions: { retainContextWhenHidden: true },
        })
    )

    context.subscriptions.push(
        vscode.commands.registerCommand('posthog.plusButtonClicked', async () => {
            Logger.log('Plus button Clicked')
            await sidebarProvider.clearTask()
            await sidebarProvider.postStateToWebview()
            await sidebarProvider.postMessageToWebview({
                type: 'action',
                action: 'chatButtonClicked',
            })
        })
    )

    context.subscriptions.push(
        vscode.commands.registerCommand('posthog.mcpButtonClicked', () => {
            sidebarProvider.postMessageToWebview({
                type: 'action',
                action: 'mcpButtonClicked',
            })
        })
    )

    const openPostHogInNewTab = async () => {
        Logger.log('Opening PostHog in new tab')
        // (this example uses webviewProvider activation event which is necessary to deserialize cached webview, but since we use retainContextWhenHidden, we don't need to use that event)
        // https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
        const tabProvider = new PostHogProvider(context, outputChannel)
        //const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined
        const lastCol = Math.max(...vscode.window.visibleTextEditors.map((editor) => editor.viewColumn || 0))

        // Check if there are any visible text editors, otherwise open a new group to the right
        const hasVisibleEditors = vscode.window.visibleTextEditors.length > 0
        if (!hasVisibleEditors) {
            await vscode.commands.executeCommand('workbench.action.newGroupRight')
        }
        const targetCol = hasVisibleEditors ? Math.max(lastCol + 1, 1) : vscode.ViewColumn.Two

        const panel = vscode.window.createWebviewPanel(PostHogProvider.tabPanelId, 'PostHog', targetCol, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [context.extensionUri],
        })
        // TODO: use better svg icon with light and dark variants (see https://stackoverflow.com/questions/58365687/vscode-extension-iconpath)

        panel.iconPath = {
            light: vscode.Uri.joinPath(context.extensionUri, 'assets', 'icons', 'posthog-icon.png'),
            dark: vscode.Uri.joinPath(context.extensionUri, 'assets', 'icons', 'posthog-icon.png'),
        }
        tabProvider.resolveWebviewView(panel)

        // Lock the editor group so clicking on files doesn't open them over the panel
        await setTimeoutPromise(100)
        await vscode.commands.executeCommand('workbench.action.lockEditorGroup')
    }

    context.subscriptions.push(vscode.commands.registerCommand('posthog.popoutButtonClicked', openPostHogInNewTab))
    context.subscriptions.push(vscode.commands.registerCommand('posthog.openInNewTab', openPostHogInNewTab))

    const openSettingsPanel = async () => {
        const tabProvider = new PostHogProvider(context, outputChannel)
        const panel = vscode.window.createWebviewPanel('posthog.settings', 'PostHog Settings', vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
        })

        panel.iconPath = {
            light: vscode.Uri.joinPath(context.extensionUri, 'assets', 'icons', 'posthog-icon.png'),
            dark: vscode.Uri.joinPath(context.extensionUri, 'assets', 'icons', 'posthog-icon.png'),
        }

        tabProvider.resolveSettingsWebviewView(panel)
        await setTimeoutPromise(100)
        await vscode.commands.executeCommand('workbench.action.lockEditorGroup')
    }

    context.subscriptions.push(vscode.commands.registerCommand('posthog.settingsButtonClicked', openSettingsPanel))

    context.subscriptions.push(
        vscode.commands.registerCommand('posthog.historyButtonClicked', () => {
            sidebarProvider.postMessageToWebview({
                type: 'action',
                action: 'historyButtonClicked',
            })
        })
    )

    context.subscriptions.push(
        vscode.commands.registerCommand('posthog.openDocumentation', () => {
            vscode.env.openExternal(vscode.Uri.parse('https://posthog.com/docs'))
        })
    )

    // Tab autocomplete
    const state = await sidebarProvider.getState()
    const autocompleteEnabled = state.enableTabAutocomplete

    // Register inline completion provider
    setupStatusBar(autocompleteEnabled ? StatusBarStatus.Enabled : StatusBarStatus.Disabled)
    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(
            [{ pattern: '**' }],
            new CompletionProvider(context, async () => {
                // const completionApiProvider = await sidebarProvider.getGlobalState('completionApiProvider')
                // if (!completionApiProvider) {
                // 	throw new Error('No API completion provider found')
                // }
                // Default to codestral
                const state = await sidebarProvider.getState()
                return new PostHogApiProvider(
                    autocompleteDefaultModelId,
                    state.apiConfiguration.posthogHost,
                    state.apiConfiguration.posthogApiKey
                )
            })
        )
    )

    const registerCopyBufferSpy = (context: vscode.ExtensionContext) => {
        const typeDisposable = vscode.commands.registerCommand('editor.action.clipboardCopyAction', async (arg) =>
            doCopy(typeDisposable)
        )

        async function doCopy(typeDisposable: any) {
            typeDisposable.dispose() // must dispose to avoid endless loops

            await vscode.commands.executeCommand('editor.action.clipboardCopyAction')

            const clipboardText = await vscode.env.clipboard.readText()

            await context.workspaceState.update('posthog.copyBuffer', {
                text: clipboardText,
                copiedAt: new Date().toISOString(),
            })

            // re-register to continue intercepting copy commands
            typeDisposable = vscode.commands.registerCommand('editor.action.clipboardCopyAction', async () =>
                doCopy(typeDisposable)
            )
            context.subscriptions.push(typeDisposable)
        }

        context.subscriptions.push(typeDisposable)
    }
    registerCopyBufferSpy(context)

    /*
	We use the text document content provider API to show the left side for diff view by creating a virtual document for the original content. This makes it readonly so users know to edit the right side if they want to keep their changes.

	- This API allows you to create readonly documents in VSCode from arbitrary sources, and works by claiming an uri-scheme for which your provider then returns text contents. The scheme must be provided when registering a provider and cannot change afterwards.
	- Note how the provider doesn't create uris for virtual documents - its role is to provide contents given such an uri. In return, content providers are wired into the open document logic so that providers are always considered.
	https://code.visualstudio.com/api/extension-guides/virtual-documents
	*/
    const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
        provideTextDocumentContent(uri: vscode.Uri): string {
            return Buffer.from(uri.query, 'base64').toString('utf-8')
        }
    })()
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(DIFF_VIEW_URI_SCHEME, diffContentProvider)
    )

    // URI Handler
    const handleUri = async (uri: vscode.Uri) => {
        // useful for auth callbacks, doesn't do anything for now
        // console.log('URI Handler called with:', {
        //     path: uri.path,
        //     query: uri.query,
        //     scheme: uri.scheme,
        // })
        // const path = uri.path
        // const query = new URLSearchParams(uri.query.replace(/\+/g, '%2B'))
        // const visibleProvider = PostHogProvider.getVisibleInstance()
        // if (!visibleProvider) {
        //     return
        // }
        // switch (path) {
        //     default:
        //         break
        // }
    }
    context.subscriptions.push(vscode.window.registerUriHandler({ handleUri }))

    // Register size testing commands in development mode
    if (IS_DEV && IS_DEV === 'true') {
        // Use dynamic import to avoid loading the module in production
        import('./dev/commands/tasks')
            .then((module) => {
                const devTaskCommands = module.registerTaskCommands(context, sidebarProvider)
                context.subscriptions.push(...devTaskCommands)
                Logger.log('PostHog dev task commands registered')
            })
            .catch((error) => {
                Logger.log('Failed to register dev task commands: ' + error)
            })
    }

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'posthog.addToChat',
            async (range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) => {
                const editor = vscode.window.activeTextEditor
                if (!editor) {
                    return
                }

                // Use provided range if available, otherwise use current selection
                // (vscode command passes an argument in the first param by default, so we need to ensure it's a Range object)
                const textRange = range instanceof vscode.Range ? range : editor.selection
                const selectedText = editor.document.getText(textRange)

                if (!selectedText) {
                    return
                }

                // Get the file path and language ID
                const filePath = editor.document.uri.fsPath
                const languageId = editor.document.languageId

                // Send to sidebar provider
                await sidebarProvider.addSelectedCodeToChat(
                    selectedText,
                    filePath,
                    languageId,
                    Array.isArray(diagnostics) ? diagnostics : undefined
                )
            }
        )
    )

    context.subscriptions.push(
        vscode.commands.registerCommand('posthog.addTerminalOutputToChat', async () => {
            const terminal = vscode.window.activeTerminal
            if (!terminal) {
                return
            }

            // Save current clipboard content
            const tempCopyBuffer = await vscode.env.clipboard.readText()

            try {
                // Copy the *existing* terminal selection (without selecting all)
                await vscode.commands.executeCommand('workbench.action.terminal.copySelection')

                // Get copied content
                let terminalContents = (await vscode.env.clipboard.readText()).trim()

                // Restore original clipboard content
                await vscode.env.clipboard.writeText(tempCopyBuffer)

                if (!terminalContents) {
                    // No terminal content was copied (either nothing selected or some error)
                    return
                }

                // [Optional] Any additional logic to process multi-line content can remain here
                // For example:
                /*
				const lines = terminalContents.split("\n")
				const lastLine = lines.pop()?.trim()
				if (lastLine) {
					let i = lines.length - 1
					while (i >= 0 && !lines[i].trim().startsWith(lastLine)) {
						i--
					}
					terminalContents = lines.slice(Math.max(i, 0)).join("\n")
				}
				*/

                // Send to sidebar provider
                await sidebarProvider.addSelectedTerminalOutputToChat(terminalContents, terminal.name)
            } catch (error) {
                // Ensure clipboard is restored even if an error occurs
                await vscode.env.clipboard.writeText(tempCopyBuffer)
                console.error('Error getting terminal contents:', error)
                vscode.window.showErrorMessage('Failed to get terminal contents')
            }
        })
    )

    // Register code action provider
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            '*',
            new (class implements vscode.CodeActionProvider {
                public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix]

                provideCodeActions(
                    document: vscode.TextDocument,
                    range: vscode.Range,
                    context: vscode.CodeActionContext
                ): vscode.CodeAction[] {
                    // Expand range to include surrounding 3 lines
                    const expandedRange = new vscode.Range(
                        Math.max(0, range.start.line - 3),
                        0,
                        Math.min(document.lineCount - 1, range.end.line + 3),
                        document.lineAt(Math.min(document.lineCount - 1, range.end.line + 3)).text.length
                    )

                    const addAction = new vscode.CodeAction('Add to PostHog', vscode.CodeActionKind.QuickFix)
                    addAction.command = {
                        command: 'posthog.addToChat',
                        title: 'Add to PostHog',
                        arguments: [expandedRange, context.diagnostics],
                    }

                    const fixAction = new vscode.CodeAction('Fix with PostHog', vscode.CodeActionKind.QuickFix)
                    fixAction.command = {
                        command: 'posthog.fixWithPostHog',
                        title: 'Fix with PostHog',
                        arguments: [expandedRange, context.diagnostics],
                    }

                    // Only show actions when there are errors
                    if (context.diagnostics.length > 0) {
                        return [addAction, fixAction]
                    } else {
                        return []
                    }
                }
            })(),
            {
                providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
            }
        )
    )

    // Register the command handler
    context.subscriptions.push(
        vscode.commands.registerCommand('posthog.fixWithPostHog', async (range: vscode.Range, diagnostics: any[]) => {
            const editor = vscode.window.activeTextEditor
            if (!editor) {
                return
            }

            const selectedText = editor.document.getText(range)
            const filePath = editor.document.uri.fsPath
            const languageId = editor.document.languageId

            // Send to sidebar provider with diagnostics
            await sidebarProvider.fixWithPostHog(selectedText, filePath, languageId, diagnostics)
        })
    )

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'posthog.logAutocompleteOutcome',
            (completionId: string, completionProvider: CompletionProvider) => {
                completionProvider.accept(completionId)
            }
        )
    )

    context.subscriptions.push(
        vscode.commands.registerCommand('posthog.openTabAutocompleteConfigMenu', async () => {
            telemetryService.captureOpenTabAutocompleteConfigMenu()

            const config = vscode.workspace.getConfiguration('posthog')
            const quickPick = vscode.window.createQuickPick()

            // Toggle between Disabled, Paused, and Enabled
            const currentStatus = getStatusBarStatus()

            let targetStatus: StatusBarStatus | undefined
            // Toggle between Disabled and Enabled
            targetStatus =
                currentStatus === StatusBarStatus.Disabled ? StatusBarStatus.Enabled : StatusBarStatus.Disabled

            quickPick.items = [
                {
                    label: quickPickStatusText(targetStatus),
                },
            ]
            quickPick.onDidAccept(() => {
                const selectedOption = quickPick.selectedItems[0].label
                const targetStatus = getStatusBarStatusFromQuickPickItemLabel(selectedOption)

                if (targetStatus !== undefined) {
                    setupStatusBar(targetStatus)
                    sidebarProvider.updateGlobalState('enableTabAutocomplete', targetStatus === StatusBarStatus.Enabled)
                }
                quickPick.dispose()
            })
            quickPick.show()
        })
    )

    // Initialize code analyzer
    const analyzer = new CodeAnalyzer()

    // Create debounced analysis function
    const debouncedAnalyze = debounce(async () => {
        const usages = await analyzer.analyzeWorkspace()
        sidebarProvider.postMessageToWebview({
            type: 'usageUpdated',
            usage: usages,
        })
    }, 1000) // 1 second debounce

    // Listen for document change events
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(() => {
            debouncedAnalyze()
        })
    )

    // Initial analysis
    debouncedAnalyze()

    context.subscriptions.push(
        vscode.commands.registerCommand('posthog.analysisButtonClicked', () => {
            sidebarProvider.postMessageToWebview({
                type: 'action',
                action: 'analysisButtonClicked',
            })
        })
    )

    return createPostHogAPI(outputChannel, sidebarProvider)
}

// This method is called when your extension is deactivated
export function deactivate() {
    telemetryService.shutdown()
    Logger.log('PostHog extension deactivated')
}

// TODO: Find a solution for automatically removing DEV related content from production builds.
//  This type of code is fine in production to keep. We just will want to remove it from production builds
//  to bring down built asset sizes.
//
// This is a workaround to reload the extension when the source code changes
// since vscode doesn't support hot reload for extensions
const { IS_DEV, DEV_WORKSPACE_FOLDER } = process.env

if (IS_DEV && IS_DEV !== 'false') {
    assert(DEV_WORKSPACE_FOLDER, 'DEV_WORKSPACE_FOLDER must be set in development')
    const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(DEV_WORKSPACE_FOLDER, 'src/**/*')
    )

    watcher.onDidChange(({ scheme, path }) => {
        console.info(`${scheme} ${path} changed. Reloading VSCode...`)

        vscode.commands.executeCommand('workbench.action.reloadWindow')
    })
}
