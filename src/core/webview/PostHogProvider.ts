import { Anthropic } from '@anthropic-ai/sdk'
import axios from 'axios'
import crypto from 'crypto'
import { execa } from 'execa'
import fs from 'fs/promises'
import os from 'os'
import pWaitFor from 'p-wait-for'
import * as path from 'path'
import * as vscode from 'vscode'
import { openFile, openImage } from '../../integrations/misc/open-file'
import { fetchOpenGraphData, isImageUrl } from '../../integrations/misc/link-preview'
import { selectImages } from '../../integrations/misc/process-images'
import { getTheme } from '../../integrations/theme/getTheme'
import WorkspaceTracker from '../../integrations/workspace/WorkspaceTracker'
import { McpHub } from '../../services/mcp/McpHub'
import { UserInfo } from '../../shared/UserInfo'
import {
    anthropicDefaultModelId,
    ApiConfiguration,
    ApiProvider,
    CompletionApiProvider,
    ModelInfo,
} from '../../shared/api'
import { findLast } from '../../shared/array'
import { AutoApprovalSettings, DEFAULT_AUTO_APPROVAL_SETTINGS } from '../../shared/AutoApprovalSettings'
import { BrowserSettings, DEFAULT_BROWSER_SETTINGS } from '../../shared/BrowserSettings'
import { ChatContent } from '../../shared/ChatContent'
import { ChatSettings, DEFAULT_CHAT_SETTINGS } from '../../shared/ChatSettings'
import { ExtensionMessage, ExtensionState, Invoke, Platform } from '../../shared/ExtensionMessage'
import { HistoryItem } from '../../shared/HistoryItem'
import { PostHogCheckpointRestore, WebviewMessage } from '../../shared/WebviewMessage'
import { fileExistsAtPath } from '../../utils/fs'
import { searchCommits } from '../../utils/git'
import { PostHog } from '../PostHog'
import { openMention } from '../mentions'
import { getNonce } from './getNonce'
import { getUri } from './getUri'
import { telemetryService } from '../../services/telemetry/TelemetryService'
import { TelemetrySetting } from '../../shared/TelemetrySetting'
import { cleanupLegacyCheckpoints } from '../../integrations/checkpoints/CheckpointMigration'
import CheckpointTracker from '../../integrations/checkpoints/CheckpointTracker'
import { getTotalTasksSize } from '../../utils/storage'
import { GlobalFileNames } from '../../global-constants'
import { setTimeout as setTimeoutPromise } from 'node:timers/promises'
import { getStatusBarStatus, setupStatusBar, StatusBarStatus } from '../../autocomplete/statusBar'
import { PostHogApiProvider } from '../../api/provider'
/*
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/blob/main/default/weather-webview/src/providers/WeatherViewProvider.ts

https://github.com/KumarVariable/vscode-extension-sidebar-html/blob/master/src/customSidebarViewProvider.ts
*/

type SecretKey = 'posthogApiKey'
type GlobalStateKey =
    | 'apiProvider'
    | 'completionApiProvider'
    | 'apiModelId'
    | 'customInstructions'
    | 'taskHistory'
    | 'autoApprovalSettings'
    | 'browserSettings'
    | 'chatSettings'
    | 'userInfo'
    | 'previousModeApiProvider'
    | 'previousModeModelId'
    | 'previousModeThinkingEnabled'
    | 'previousModeModelInfo'
    | 'telemetrySetting'
    | 'thinkingEnabled'
    | 'planActSeparateModelsSetting'
    | 'enableTabAutocomplete'

export class PostHogProvider implements vscode.WebviewViewProvider {
    public static readonly sideBarId = 'posthog.SidebarProvider' // used in package.json as the view's id. This value cannot be changed due to how vscode caches views based on their id, and updating the id would break existing instances of the extension.
    public static readonly tabPanelId = 'posthog.TabPanelProvider'
    private static activeInstances: Set<PostHogProvider> = new Set()
    private disposables: vscode.Disposable[] = []
    private view?: vscode.WebviewView | vscode.WebviewPanel
    private posthog?: PostHog
    workspaceTracker?: WorkspaceTracker
    mcpHub?: McpHub

    constructor(
        readonly context: vscode.ExtensionContext,
        private readonly outputChannel: vscode.OutputChannel
    ) {
        this.outputChannel.appendLine('PostHogProvider instantiated')
        PostHogProvider.activeInstances.add(this)
        this.workspaceTracker = new WorkspaceTracker(this)
        this.mcpHub = new McpHub(this)

        // Clean up legacy checkpoints
        cleanupLegacyCheckpoints(this.context.globalStorageUri.fsPath, this.outputChannel).catch((error) => {
            console.error('Failed to cleanup legacy checkpoints:', error)
        })
    }

    /*
    VSCode extensions use the disposable pattern to clean up resources when the sidebar/editor tab is closed by the user or system. This applies to event listening, commands, interacting with the UI, etc.
    - https://vscode-docs.readthedocs.io/en/stable/extensions/patterns-and-principles/
    - https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
    */
    async dispose() {
        this.outputChannel.appendLine('Disposing PostHogProvider...')
        await this.clearTask()
        this.outputChannel.appendLine('Cleared task')
        if (this.view && 'dispose' in this.view) {
            this.view.dispose()
            this.outputChannel.appendLine('Disposed webview')
        }
        while (this.disposables.length) {
            const x = this.disposables.pop()
            if (x) {
                x.dispose()
            }
        }
        this.workspaceTracker?.dispose()
        this.workspaceTracker = undefined
        this.mcpHub?.dispose()
        this.mcpHub = undefined
        this.outputChannel.appendLine('Disposed all disposables')
        PostHogProvider.activeInstances.delete(this)
    }

    // Auth methods
    async handleSignOut() {
        try {
            await this.updateGlobalState('apiProvider', 'openrouter')
            await this.postStateToWebview()
            vscode.window.showInformationMessage('Successfully logged out of PostHog')
        } catch (error) {
            vscode.window.showErrorMessage('Logout failed')
        }
    }

    async setUserInfo(info?: { displayName: string | null; email: string | null; photoURL: string | null }) {
        await this.updateGlobalState('userInfo', info)
    }

    public static getVisibleInstance(): PostHogProvider | undefined {
        return findLast(Array.from(this.activeInstances), (instance) => instance.view?.visible === true)
    }

    async resolveWebviewView(webviewView: vscode.WebviewView | vscode.WebviewPanel) {
        this.outputChannel.appendLine('Resolving webview view')
        this.view = webviewView

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri],
        }

        webviewView.webview.html =
            this.context.extensionMode === vscode.ExtensionMode.Development
                ? await this.getHMRHtmlContent(webviewView.webview)
                : this.getHtmlContent(webviewView.webview)

        // Sets up an event listener to listen for messages passed from the webview view context
        // and executes code based on the message that is received
        this.setWebviewMessageListener(webviewView.webview)

        // Logs show up in bottom panel > Debug Console
        //console.log("registering listener")

        // Listen for when the panel becomes visible
        // https://github.com/microsoft/vscode-discussions/discussions/840
        if ('onDidChangeViewState' in webviewView) {
            // WebviewView and WebviewPanel have all the same properties except for this visibility listener
            // panel
            webviewView.onDidChangeViewState(
                () => {
                    if (this.view?.visible) {
                        this.postMessageToWebview({
                            type: 'action',
                            action: 'didBecomeVisible',
                        })
                    }
                },
                null,
                this.disposables
            )
        } else if ('onDidChangeVisibility' in webviewView) {
            // sidebar
            webviewView.onDidChangeVisibility(
                () => {
                    if (this.view?.visible) {
                        this.postMessageToWebview({
                            type: 'action',
                            action: 'didBecomeVisible',
                        })
                    }
                },
                null,
                this.disposables
            )
        }

        // Listen for when the view is disposed
        // This happens when the user closes the view or when the view is closed programmatically
        webviewView.onDidDispose(
            async () => {
                await this.dispose()
            },
            null,
            this.disposables
        )

        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(
            async (e) => {
                if (e && e.affectsConfiguration('workbench.colorTheme')) {
                    // Sends latest theme name to webview
                    await this.postMessageToWebview({
                        type: 'theme',
                        text: JSON.stringify(await getTheme()),
                    })
                }
            },
            null,
            this.disposables
        )

        // if the extension is starting a new session, clear previous task state
        this.clearTask()

        this.outputChannel.appendLine('Webview view resolved')
    }
    async resolveSettingsWebviewView(webviewView: vscode.WebviewView | vscode.WebviewPanel) {
        this.outputChannel.appendLine('Resolving webview view')
        this.view = webviewView

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri],
        }

        webviewView.webview.html =
            this.context.extensionMode === vscode.ExtensionMode.Development
                ? await this.getHMRHtmlContent(webviewView.webview)
                : this.getHtmlContent(webviewView.webview)

        // Sets up an event listener to listen for messages passed from the webview view context
        // and executes code based on the message that is received
        this.setWebviewMessageListener(webviewView.webview)

        // Logs show up in bottom panel > Debug Console
        //console.log("registering listener")

        // Listen for when the panel becomes visible
        // https://github.com/microsoft/vscode-discussions/discussions/840
        if ('onDidChangeViewState' in webviewView) {
            // WebviewView and WebviewPanel have all the same properties except for this visibility listener
            // panel
            webviewView.onDidChangeViewState(
                () => {
                    if (this.view?.visible) {
                        this.postMessageToWebview({
                            type: 'action',
                            action: 'didBecomeVisible',
                        })
                        // Automatically open settings panel when view becomes visible
                        this.postMessageToWebview({
                            type: 'action',
                            action: 'settingsButtonClicked',
                        })
                    }
                },
                null,
                this.disposables
            )
        } else if ('onDidChangeVisibility' in webviewView) {
            // sidebar
            webviewView.onDidChangeVisibility(
                () => {
                    if (this.view?.visible) {
                        this.postMessageToWebview({
                            type: 'action',
                            action: 'didBecomeVisible',
                        })
                        // Automatically open settings panel when view becomes visible
                        this.postMessageToWebview({
                            type: 'action',
                            action: 'settingsButtonClicked',
                        })
                    }
                },
                null,
                this.disposables
            )
        }

        // Listen for when the view is disposed
        // This happens when the user closes the view or when the view is closed programmatically
        webviewView.onDidDispose(
            async () => {
                await this.dispose()
            },
            null,
            this.disposables
        )

        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(
            async (e) => {
                if (e && e.affectsConfiguration('workbench.colorTheme')) {
                    // Sends latest theme name to webview
                    await this.postMessageToWebview({
                        type: 'theme',
                        text: JSON.stringify(await getTheme()),
                    })
                }
            },
            null,
            this.disposables
        )

        // if the extension is starting a new session, clear previous task state
        this.clearTask()

        // Automatically open settings panel when webview is first initialized
        await this.postMessageToWebview({
            type: 'action',
            action: 'settingsButtonClicked',
        })

        this.outputChannel.appendLine('Webview view resolved')
    }

    async initPostHogWithTask(task?: string, images?: string[]) {
        await this.clearTask() // ensures that an existing task doesn't exist before starting a new one, although this shouldn't be possible since user must clear task before starting a new one
        const { apiConfiguration, customInstructions, autoApprovalSettings, browserSettings, chatSettings } =
            await this.getState()
        this.posthog = new PostHog(
            this,
            apiConfiguration,
            autoApprovalSettings,
            browserSettings,
            chatSettings,
            customInstructions,
            task,
            images
        )
    }

    async initPostHogWithHistoryItem(historyItem: HistoryItem) {
        await this.clearTask()
        const { apiConfiguration, customInstructions, autoApprovalSettings, browserSettings, chatSettings } =
            await this.getState()
        this.posthog = new PostHog(
            this,
            apiConfiguration,
            autoApprovalSettings,
            browserSettings,
            chatSettings,
            customInstructions,
            undefined,
            undefined,
            historyItem
        )
    }

    // Send any JSON serializable data to the react app
    async postMessageToWebview(message: ExtensionMessage) {
        await this.view?.webview.postMessage(message)
    }

    /**
     * Defines and returns the HTML that should be rendered within the webview panel.
     *
     * @remarks This is also the place where references to the React webview build files
     * are created and inserted into the webview HTML.
     *
     * @param webview A reference to the extension webview
     * @param extensionUri The URI of the directory containing the extension
     * @returns A template string literal containing the HTML that should be
     * rendered within the webview panel
     */
    private getHtmlContent(webview: vscode.Webview): string {
        // Get the local path to main script run in the webview,
        // then convert it to a uri we can use in the webview.

        // The CSS file from the React build output
        const stylesUri = getUri(webview, this.context.extensionUri, ['webview-ui', 'build', 'assets', 'index.css'])
        // The JS file from the React build output
        const scriptUri = getUri(webview, this.context.extensionUri, ['webview-ui', 'build', 'assets', 'index.js'])

        // The codicon font from the React build output
        // https://github.com/microsoft/vscode-extension-samples/blob/main/webview-codicons-sample/src/extension.ts
        // we installed this package in the extension so that we can access it how its intended from the extension (the font file is likely bundled in vscode), and we just import the css fileinto our react app we don't have access to it
        // don't forget to add font-src ${webview.cspSource};
        const codiconsUri = getUri(webview, this.context.extensionUri, [
            'node_modules',
            '@vscode',
            'codicons',
            'dist',
            'codicon.css',
        ])

        // const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "assets", "main.js"))

        // const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "assets", "reset.css"))
        // const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "assets", "vscode.css"))

        // // Same for stylesheet
        // const stylesheetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "assets", "main.css"))

        // Use a nonce to only allow a specific script to be run.
        /*
                content security policy of your webview to only allow scripts that have a specific nonce
                create a content security policy meta tag so that only loading scripts with a nonce is allowed
                As your extension grows you will likely want to add custom styles, fonts, and/or images to your webview. If you do, you will need to update the content security policy meta tag to explicity allow for these resources. E.g.
                                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">
        - 'unsafe-inline' is required for styles due to vscode-webview-toolkit's dynamic style injection
        - since we pass base64 images to the webview, we need to specify img-src ${webview.cspSource} data:;

                in meta tag we add nonce attribute: A cryptographic nonce (only used once) to allow scripts. The server must generate a unique nonce value each time it transmits a policy. It is critical to provide a nonce that cannot be guessed as bypassing a resource's policy is otherwise trivial.
                */
        const nonce = getNonce()

        // Tip: Install the es6-string-html VS Code extension to enable code highlighting below
        return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
            <meta name="theme-color" content="#000000">
            <link rel="stylesheet" type="text/css" href="${stylesUri}">
            <link href="${codiconsUri}" rel="stylesheet" />
						<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src https://*.posthog.com; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}' 'unsafe-eval';">
            <title>PostHog</title>
          </head>
          <body>
            <noscript>You need to enable JavaScript to run this app.</noscript>
            <div id="root"></div>
            <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
          </body>
        </html>
      `
    }

    /**
     * Connects to the local Vite dev server to allow HMR, with fallback to the bundled assets
     *
     * @param webview A reference to the extension webview
     * @returns A template string literal containing the HTML that should be
     * rendered within the webview panel
     */
    private async getHMRHtmlContent(webview: vscode.Webview): Promise<string> {
        const localPort = 25463
        const localServerUrl = `localhost:${localPort}`

        // Check if local dev server is running.
        try {
            await axios.get(`http://${localServerUrl}`)
        } catch (error) {
            vscode.window.showErrorMessage(
                "PostHog: Local webview dev server is not running, HMR will not work. Please run 'npm run dev:webview' before launching the extension to enable HMR. Using bundled assets."
            )

            return this.getHtmlContent(webview)
        }

        const nonce = getNonce()
        const stylesUri = getUri(webview, this.context.extensionUri, ['webview-ui', 'build', 'assets', 'index.css'])
        const codiconsUri = getUri(webview, this.context.extensionUri, [
            'node_modules',
            '@vscode',
            'codicons',
            'dist',
            'codicon.css',
        ])

        const scriptEntrypoint = 'src/main.tsx'
        const scriptUri = `http://${localServerUrl}/${scriptEntrypoint}`

        const reactRefresh = /*html*/ `
			<script nonce="${nonce}" type="module">
				import RefreshRuntime from "http://${localServerUrl}/@react-refresh"
				RefreshRuntime.injectIntoGlobalHook(window)
				window.$RefreshReg$ = () => {}
				window.$RefreshSig$ = () => (type) => type
				window.__vite_plugin_react_preamble_installed__ = true
			</script>
		`

        const csp = [
            "default-src 'none'",
            `font-src ${webview.cspSource}`,
            `style-src ${webview.cspSource} 'unsafe-inline' https://* http://${localServerUrl} http://0.0.0.0:${localPort}`,
            `img-src ${webview.cspSource} https: data:`,
            `script-src 'unsafe-eval' https://* http://${localServerUrl} http://0.0.0.0:${localPort} 'nonce-${nonce}'`,
            `connect-src https://* ws://${localServerUrl} ws://0.0.0.0:${localPort} http://${localServerUrl} http://0.0.0.0:${localPort}`,
        ]

        return /*html*/ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
					<meta http-equiv="Content-Security-Policy" content="${csp.join('; ')}">
					<link rel="stylesheet" type="text/css" href="${stylesUri}">
					<link href="${codiconsUri}" rel="stylesheet" />
					<title>PostHog</title>
				</head>
				<body>
					<div id="root"></div>
					${reactRefresh}
					<script type="module" src="${scriptUri}"></script>
				</body>
			</html>
		`
    }

    /**
     * Sets up an event listener to listen for messages passed from the webview context and
     * executes code based on the message that is received.
     *
     * @param webview A reference to the extension webview
     */
    private setWebviewMessageListener(webview: vscode.Webview) {
        webview.onDidReceiveMessage(
            async (message: WebviewMessage) => {
                switch (message.type) {
                    case 'webviewDidLaunch':
                        this.postStateToWebview()
                        this.workspaceTracker?.populateFilePaths() // don't await
                        getTheme().then((theme) =>
                            this.postMessageToWebview({
                                type: 'theme',
                                text: JSON.stringify(theme),
                            })
                        )

                        // If user already opted in to telemetry, enable telemetry service
                        this.getStateToPostToWebview().then((state) => {
                            const { telemetrySetting } = state
                            const isOptedIn = telemetrySetting === 'enabled'
                            telemetryService.updateTelemetryState(isOptedIn)
                        })
                        break
                    case 'newTask':
                        // Code that should run in response to the hello message command
                        //vscode.window.showInformationMessage(message.text!)

                        // Send a message to our webview.
                        // You can send any JSON serializable data.
                        // Could also do this in extension .ts
                        //this.postMessageToWebview({ type: "text", text: `Extension: ${Date.now()}` })
                        // initializing new instance of PostHog will make sure that any agentically running promises in old instance don't affect our new task. this essentially creates a fresh slate for the new task
                        await this.initPostHogWithTask(message.text, message.images)
                        break
                    case 'apiConfiguration':
                        if (message.apiConfiguration) {
                            await this.updateApiConfiguration(message.apiConfiguration)
                        }
                        await this.postStateToWebview()
                        break
                    case 'autoApprovalSettings':
                        if (message.autoApprovalSettings) {
                            await this.updateGlobalState('autoApprovalSettings', message.autoApprovalSettings)
                            if (this.posthog) {
                                this.posthog.autoApprovalSettings = message.autoApprovalSettings
                            }
                            await this.postStateToWebview()
                        }
                        break
                    case 'browserSettings':
                        if (message.browserSettings) {
                            await this.updateGlobalState('browserSettings', message.browserSettings)
                            if (this.posthog) {
                                this.posthog.updateBrowserSettings(message.browserSettings)
                            }
                            await this.postStateToWebview()
                        }
                        break
                    case 'togglePlanActMode':
                        if (message.chatSettings) {
                            await this.togglePlanActModeWithChatSettings(message.chatSettings, message.chatContent)
                        }
                        break
                    case 'optionsResponse':
                        await this.postMessageToWebview({
                            type: 'invoke',
                            invoke: 'sendMessage',
                            text: message.text,
                        })
                        break
                    // case "relaunchChromeDebugMode":
                    // 	if (this.posthog) {
                    // 		this.posthog.browserSession.relaunchChromeDebugMode()
                    // 	}
                    // 	break
                    case 'askResponse':
                        this.posthog?.handleWebviewAskResponse(message.askResponse!, message.text, message.images)
                        break
                    case 'clearTask':
                        // newTask will start a new task with a given task text, while clear task resets the current session and allows for a new task to be started
                        await this.clearTask()
                        await this.postStateToWebview()
                        break
                    case 'selectImages':
                        const images = await selectImages()
                        await this.postMessageToWebview({
                            type: 'selectedImages',
                            images,
                        })
                        break
                    case 'showTaskWithId':
                        this.showTaskWithId(message.text!)
                        break
                    case 'deleteTaskWithId':
                        this.deleteTaskWithId(message.text!)
                        break
                    case 'resetState':
                        await this.resetState()
                        break
                    case 'openImage':
                        openImage(message.text!)
                        break
                    case 'openInBrowser':
                        if (message.url) {
                            vscode.env.openExternal(vscode.Uri.parse(message.url))
                        }
                        break
                    case 'fetchOpenGraphData':
                        this.fetchOpenGraphData(message.text!)
                        break
                    case 'checkIsImageUrl':
                        this.checkIsImageUrl(message.text!)
                        break
                    case 'openFile':
                        openFile(message.text!)
                        break
                    case 'openMention':
                        openMention(message.text)
                        break
                    case 'checkpointDiff': {
                        if (message.number) {
                            await this.posthog?.presentMultifileDiff(message.number, false)
                        }
                        break
                    }
                    case 'checkpointRestore': {
                        await this.cancelTask() // we cannot alter message history say if the task is active, as it could be in the middle of editing a file or running a command, which expect the ask to be responded to rather than being superceded by a new message eg add deleted_api_reqs
                        // cancel task waits for any open editor to be reverted and starts a new posthog instance
                        if (message.number) {
                            // wait for messages to be loaded
                            await pWaitFor(() => this.posthog?.isInitialized === true, {
                                timeout: 3_000,
                            }).catch(() => {
                                console.error('Failed to init new posthog instance')
                            })
                            // NOTE: cancelTask awaits abortTask, which awaits diffViewProvider.revertChanges, which reverts any edited files, allowing us to reset to a checkpoint rather than running into a state where the revertChanges function is called alongside or after the checkpoint reset
                            await this.posthog?.restoreCheckpoint(
                                message.number,
                                message.text! as PostHogCheckpointRestore
                            )
                        }
                        break
                    }
                    case 'taskCompletionViewChanges': {
                        if (message.number) {
                            await this.posthog?.presentMultifileDiff(message.number, true)
                        }
                        break
                    }
                    case 'cancelTask':
                        this.cancelTask()
                        break
                    case 'getLatestState':
                        await this.postStateToWebview()
                        break
                    case 'showMcpView': {
                        await this.postMessageToWebview({ type: 'action', action: 'mcpButtonClicked' })
                        break
                    }
                    case 'openMcpSettings': {
                        const mcpSettingsFilePath = await this.mcpHub?.getMcpSettingsFilePath()
                        if (mcpSettingsFilePath) {
                            openFile(mcpSettingsFilePath)
                        }
                        break
                    }
                    case 'toggleMcpServer': {
                        try {
                            await this.mcpHub?.toggleServerDisabled(message.serverName!, message.disabled!)
                        } catch (error) {
                            console.error(`Failed to toggle MCP server ${message.serverName}:`, error)
                        }
                        break
                    }
                    case 'toggleToolAutoApprove': {
                        try {
                            await this.mcpHub?.toggleToolAutoApprove(
                                message.serverName!,
                                message.toolName!,
                                message.autoApprove!
                            )
                        } catch (error) {
                            console.error(`Failed to toggle auto-approve for tool ${message.toolName}:`, error)
                        }
                        break
                    }
                    case 'requestTotalTasksSize': {
                        this.refreshTotalTasksSize()
                        break
                    }
                    case 'restartMcpServer': {
                        try {
                            await this.mcpHub?.restartConnection(message.text!)
                        } catch (error) {
                            console.error(`Failed to retry connection for ${message.text}:`, error)
                        }
                        break
                    }
                    case 'deleteMcpServer': {
                        if (message.serverName) {
                            this.mcpHub?.deleteServer(message.serverName)
                        }
                        break
                    }
                    case 'fetchLatestMcpServersFromHub': {
                        this.mcpHub?.sendLatestMcpServers()
                        break
                    }
                    case 'searchCommits': {
                        const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0)
                        if (cwd) {
                            try {
                                const commits = await searchCommits(message.text || '', cwd)
                                await this.postMessageToWebview({
                                    type: 'commitSearchResults',
                                    commits,
                                })
                            } catch (error) {
                                console.error(`Error searching commits: ${JSON.stringify(error)}`)
                            }
                        }
                        break
                    }
                    case 'updateMcpTimeout': {
                        try {
                            if (message.serverName && message.timeout) {
                                await this.mcpHub?.updateServerTimeout(message.serverName, message.timeout)
                            }
                        } catch (error) {
                            console.error(`Failed to update timeout for server ${message.serverName}:`, error)
                        }
                        break
                    }
                    case 'openExtensionSettings': {
                        const settingsFilter = message.text || ''
                        await vscode.commands.executeCommand(
                            'workbench.action.openSettings',
                            `@ext:posthog.posthog-extension ${settingsFilter}`.trim() // trim whitespace if no settings filter
                        )
                        break
                    }
                    case 'invoke': {
                        if (message.text) {
                            await this.postMessageToWebview({
                                type: 'invoke',
                                invoke: message.text as Invoke,
                            })
                        }
                        break
                    }
                    // telemetry
                    case 'openSettings': {
                        await this.postMessageToWebview({
                            type: 'action',
                            action: 'settingsButtonClicked',
                        })
                        break
                    }
                    case 'telemetrySetting': {
                        if (message.telemetrySetting) {
                            await this.updateTelemetrySetting(message.telemetrySetting)
                        }
                        await this.postStateToWebview()
                        break
                    }
                    case 'updateSettings': {
                        // api config
                        if (message.apiConfiguration) {
                            await this.updateApiConfiguration(message.apiConfiguration)
                        }

                        // custom instructions
                        await this.updateCustomInstructions(message.customInstructionsSetting)

                        // telemetry setting
                        if (message.telemetrySetting) {
                            await this.updateTelemetrySetting(message.telemetrySetting)
                        }

                        // enable tab autocomplete
                        if (message.enableTabAutocomplete !== undefined) {
                            await this.toggleEnableTabAutocomplete(message.enableTabAutocomplete)
                        }

                        // plan act setting
                        await this.updateGlobalState(
                            'planActSeparateModelsSetting',
                            message.planActSeparateModelsSetting
                        )

                        // after settings are updated, post state to webview
                        await this.postStateToWebview()

                        await this.postMessageToWebview({ type: 'didUpdateSettings' })
                        break
                    }
                    case 'clearAllTaskHistory': {
                        await this.deleteAllTaskHistory()
                        await this.postStateToWebview()
                        this.refreshTotalTasksSize()
                        this.postMessageToWebview({ type: 'relinquishControl' })
                        break
                    }
                    // Add more switch case statements here as more webview message commands
                    // are created within the webview context (i.e. inside media/main.js)
                }
            },
            null,
            this.disposables
        )
    }

    async updateTelemetrySetting(telemetrySetting: TelemetrySetting) {
        await this.updateGlobalState('telemetrySetting', telemetrySetting)
        const isOptedIn = telemetrySetting === 'enabled'
        telemetryService.updateTelemetryState(isOptedIn)
    }

    async toggleEnableTabAutocomplete(enableTabAutocomplete: boolean) {
        console.log('toggleEnableTabAutocomplete', enableTabAutocomplete)
        await this.updateGlobalState('enableTabAutocomplete', enableTabAutocomplete)
        telemetryService.captureAutocompleteEnabled()
        if (enableTabAutocomplete) {
            setupStatusBar(StatusBarStatus.Enabled)
        } else {
            setupStatusBar(StatusBarStatus.Disabled)
        }
    }

    async togglePlanActModeWithChatSettings(chatSettings: ChatSettings, chatContent?: ChatContent) {
        const didSwitchToActMode = chatSettings.mode === 'act'

        // Capture mode switch telemetry | Capture regardless of if we know the taskId
        telemetryService.captureModeSwitch(this.posthog?.taskId ?? '0', chatSettings.mode)

        // Get previous model info that we will revert to after saving current mode api info
        const {
            apiConfiguration,
            previousModeApiProvider: newApiProvider,
            previousModeModelId: newModelId,
            previousModeModelInfo: newModelInfo,
            previousModeThinkingEnabled: thinkingEnabled,
            planActSeparateModelsSetting,
        } = await this.getState()

        const shouldSwitchModel = planActSeparateModelsSetting === true

        if (shouldSwitchModel) {
            // Save the last model used in this mode
            await this.updateGlobalState('previousModeApiProvider', apiConfiguration.apiProvider)
            await this.updateGlobalState('previousModeThinkingEnabled', apiConfiguration.thinkingEnabled)
            switch (apiConfiguration.apiProvider) {
                case 'anthropic':
                    await this.updateGlobalState('previousModeModelId', apiConfiguration.apiModelId)
                    break
            }

            // Restore the model used in previous mode
            if (newApiProvider || newModelId || thinkingEnabled !== undefined) {
                await this.updateGlobalState('apiProvider', newApiProvider)
                await this.updateGlobalState('thinkingEnabled', thinkingEnabled)
                switch (newApiProvider) {
                    case 'anthropic':
                        await this.updateGlobalState('apiModelId', newModelId)
                        break
                }

                if (this.posthog) {
                    const { apiConfiguration: updatedApiConfiguration } = await this.getState()
                    this.posthog.api = new PostHogApiProvider(
                        updatedApiConfiguration.apiModelId,
                        updatedApiConfiguration.posthogApiKey,
                        updatedApiConfiguration.thinkingEnabled
                    )
                }
            }
        }

        await this.updateGlobalState('chatSettings', chatSettings)
        await this.postStateToWebview()

        if (this.posthog) {
            this.posthog.updateChatSettings(chatSettings)
            if (this.posthog.isAwaitingPlanResponse && didSwitchToActMode) {
                this.posthog.didRespondToPlanAskBySwitchingMode = true
                // Use chatContent if provided, otherwise use default message
                await this.postMessageToWebview({
                    type: 'invoke',
                    invoke: 'sendMessage',
                    text: chatContent?.message || 'PLAN_MODE_TOGGLE_RESPONSE',
                    images: chatContent?.images,
                })
            } else {
                this.cancelTask()
            }
        }
    }

    async cancelTask() {
        if (this.posthog) {
            const { historyItem } = await this.getTaskWithId(this.posthog.taskId)
            try {
                await this.posthog.abortTask()
            } catch (error) {
                console.error('Failed to abort task', error)
            }
            await pWaitFor(
                () =>
                    this.posthog === undefined ||
                    this.posthog.isStreaming === false ||
                    this.posthog.didFinishAbortingStream ||
                    this.posthog.isWaitingForFirstChunk, // if only first chunk is processed, then there's no need to wait for graceful abort (closes edits, browser, etc)
                {
                    timeout: 3_000,
                }
            ).catch(() => {
                console.error('Failed to abort task')
            })
            if (this.posthog) {
                // 'abandoned' will prevent this posthog instance from affecting future posthog instance gui. this may happen if its hanging on a streaming request
                this.posthog.abandoned = true
            }
            await this.initPostHogWithHistoryItem(historyItem) // clears task again, so we need to abortTask manually above
            // await this.postStateToWebview() // new PostHog instance will post state when it's ready. having this here sent an empty messages array to webview leading to virtuoso having to reload the entire list
        }
    }

    async updateCustomInstructions(instructions?: string) {
        // User may be clearing the field
        await this.updateGlobalState('customInstructions', instructions || undefined)
        if (this.posthog) {
            this.posthog.customInstructions = instructions || undefined
        }
    }

    async updateApiConfiguration(apiConfiguration: ApiConfiguration) {
        const { apiProvider, apiModelId, posthogApiKey, thinkingEnabled } = apiConfiguration
        await this.updateGlobalState('apiProvider', apiProvider)
        await this.updateGlobalState('apiModelId', apiModelId)
        await this.storeSecret('posthogApiKey', posthogApiKey)
        await this.updateGlobalState('thinkingEnabled', thinkingEnabled)
        if (this.posthog && apiModelId) {
            this.posthog.api = new PostHogApiProvider(apiModelId, posthogApiKey)
        }
    }

    // MCP

    async getDocumentsPath(): Promise<string> {
        if (process.platform === 'win32') {
            try {
                const { stdout: docsPath } = await execa('powershell', [
                    '-NoProfile', // Ignore user's PowerShell profile(s)
                    '-Command',
                    '[System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::MyDocuments)',
                ])
                const trimmedPath = docsPath.trim()
                if (trimmedPath) {
                    return trimmedPath
                }
            } catch (err) {
                console.error('Failed to retrieve Windows Documents path. Falling back to homedir/Documents.')
            }
        } else if (process.platform === 'linux') {
            try {
                // First check if xdg-user-dir exists
                await execa('which', ['xdg-user-dir'])

                // If it exists, try to get XDG documents path
                const { stdout } = await execa('xdg-user-dir', ['DOCUMENTS'])
                const trimmedPath = stdout.trim()
                if (trimmedPath) {
                    return trimmedPath
                }
            } catch {
                // Log error but continue to fallback
                console.error('Failed to retrieve XDG Documents path. Falling back to homedir/Documents.')
            }
        }

        // Default fallback for all platforms
        return path.join(os.homedir(), 'Documents')
    }

    async ensureMcpServersDirectoryExists(): Promise<string> {
        const userDocumentsPath = await this.getDocumentsPath()
        const mcpServersDir = path.join(userDocumentsPath, 'PostHog', 'MCP')
        try {
            await fs.mkdir(mcpServersDir, { recursive: true })
        } catch (error) {
            return '~/Documents/PostHog/MCP' // in case creating a directory in documents fails for whatever reason (e.g. permissions) - this is fine since this path is only ever used in the system prompt
        }
        return mcpServersDir
    }

    async ensureSettingsDirectoryExists(): Promise<string> {
        const settingsDir = path.join(this.context.globalStorageUri.fsPath, 'settings')
        await fs.mkdir(settingsDir, { recursive: true })
        return settingsDir
    }

    // Context menus and code actions

    getFileMentionFromPath(filePath: string) {
        const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0)
        if (!cwd) {
            return '@/' + filePath
        }
        const relativePath = path.relative(cwd, filePath)
        return '@/' + relativePath
    }

    // 'Add to PostHog' context menu in editor and code action
    async addSelectedCodeToChat(code: string, filePath: string, languageId: string, diagnostics?: vscode.Diagnostic[]) {
        // Ensure the sidebar view is visible
        await vscode.commands.executeCommand('posthog.SidebarProvider.focus')
        await setTimeoutPromise(100)

        // Post message to webview with the selected code
        const fileMention = this.getFileMentionFromPath(filePath)

        let input = `${fileMention}\n\`\`\`\n${code}\n\`\`\``
        if (diagnostics) {
            const problemsString = this.convertDiagnosticsToProblemsString(diagnostics)
            input += `\nProblems:\n${problemsString}`
        }

        await this.postMessageToWebview({
            type: 'addToInput',
            text: input,
        })

        console.log('addSelectedCodeToChat', code, filePath, languageId)
    }

    // 'Add to PostHog' context menu in Terminal
    async addSelectedTerminalOutputToChat(output: string, terminalName: string) {
        // Ensure the sidebar view is visible
        await vscode.commands.executeCommand('posthog.SidebarProvider.focus')
        await setTimeoutPromise(100)

        // Post message to webview with the selected terminal output
        // await this.postMessageToWebview({
        //     type: "addSelectedTerminalOutput",
        //     output,
        //     terminalName
        // })

        await this.postMessageToWebview({
            type: 'addToInput',
            text: `Terminal output:\n\`\`\`\n${output}\n\`\`\``,
        })

        console.log('addSelectedTerminalOutputToChat', output, terminalName)
    }

    // 'Fix with PostHog' in code actions
    async fixWithPostHog(code: string, filePath: string, languageId: string, diagnostics: vscode.Diagnostic[]) {
        // Ensure the sidebar view is visible
        await vscode.commands.executeCommand('posthog.SidebarProvider.focus')
        await setTimeoutPromise(100)

        const fileMention = this.getFileMentionFromPath(filePath)
        const problemsString = this.convertDiagnosticsToProblemsString(diagnostics)
        await this.initPostHogWithTask(
            `Fix the following code in ${fileMention}\n\`\`\`\n${code}\n\`\`\`\n\nProblems:\n${problemsString}`
        )

        console.log('fixWithPostHog', code, filePath, languageId, diagnostics, problemsString)
    }

    convertDiagnosticsToProblemsString(diagnostics: vscode.Diagnostic[]) {
        let problemsString = ''
        for (const diagnostic of diagnostics) {
            let label: string
            switch (diagnostic.severity) {
                case vscode.DiagnosticSeverity.Error:
                    label = 'Error'
                    break
                case vscode.DiagnosticSeverity.Warning:
                    label = 'Warning'
                    break
                case vscode.DiagnosticSeverity.Information:
                    label = 'Information'
                    break
                case vscode.DiagnosticSeverity.Hint:
                    label = 'Hint'
                    break
                default:
                    label = 'Diagnostic'
            }
            const line = diagnostic.range.start.line + 1 // VSCode lines are 0-indexed
            const source = diagnostic.source ? `${diagnostic.source} ` : ''
            problemsString += `\n- [${source}${label}] Line ${line}: ${diagnostic.message}`
        }
        problemsString = problemsString.trim()
        return problemsString
    }

    // Task history

    async getTaskWithId(id: string): Promise<{
        historyItem: HistoryItem
        taskDirPath: string
        apiConversationHistoryFilePath: string
        uiMessagesFilePath: string
        apiConversationHistory: Anthropic.MessageParam[]
    }> {
        const history = ((await this.getGlobalState('taskHistory')) as HistoryItem[] | undefined) || []
        const historyItem = history.find((item) => item.id === id)
        if (historyItem) {
            const taskDirPath = path.join(this.context.globalStorageUri.fsPath, 'tasks', id)
            const apiConversationHistoryFilePath = path.join(taskDirPath, GlobalFileNames.apiConversationHistory)
            const uiMessagesFilePath = path.join(taskDirPath, GlobalFileNames.uiMessages)
            const fileExists = await fileExistsAtPath(apiConversationHistoryFilePath)
            if (fileExists) {
                const apiConversationHistory = JSON.parse(await fs.readFile(apiConversationHistoryFilePath, 'utf8'))
                return {
                    historyItem,
                    taskDirPath,
                    apiConversationHistoryFilePath,
                    uiMessagesFilePath,
                    apiConversationHistory,
                }
            }
        }
        // if we tried to get a task that doesn't exist, remove it from state
        // FIXME: this seems to happen sometimes when the json file doesnt save to disk for some reason
        await this.deleteTaskFromState(id)
        throw new Error('Task not found')
    }

    async showTaskWithId(id: string) {
        if (id !== this.posthog?.taskId) {
            // non-current task
            const { historyItem } = await this.getTaskWithId(id)
            await this.initPostHogWithHistoryItem(historyItem) // clears existing task
        }
        await this.postMessageToWebview({
            type: 'action',
            action: 'chatButtonClicked',
        })
    }

    async deleteAllTaskHistory() {
        await this.clearTask()
        await this.updateGlobalState('taskHistory', undefined)
        try {
            // Remove all contents of tasks directory
            const taskDirPath = path.join(this.context.globalStorageUri.fsPath, 'tasks')
            if (await fileExistsAtPath(taskDirPath)) {
                await fs.rm(taskDirPath, { recursive: true, force: true })
            }
            // Remove checkpoints directory contents
            const checkpointsDirPath = path.join(this.context.globalStorageUri.fsPath, 'checkpoints')
            if (await fileExistsAtPath(checkpointsDirPath)) {
                await fs.rm(checkpointsDirPath, { recursive: true, force: true })
            }
        } catch (error) {
            vscode.window.showErrorMessage(
                `Encountered error while deleting task history, there may be some files left behind. Error: ${error instanceof Error ? error.message : String(error)}`
            )
        }
        // await this.postStateToWebview()
    }

    async refreshTotalTasksSize() {
        getTotalTasksSize(this.context.globalStorageUri.fsPath)
            .then((newTotalSize) => {
                this.postMessageToWebview({
                    type: 'totalTasksSize',
                    totalTasksSize: newTotalSize,
                })
            })
            .catch((error) => {
                console.error('Error calculating total tasks size:', error)
            })
    }

    async deleteTaskWithId(id: string) {
        console.info('deleteTaskWithId: ', id)

        try {
            if (id === this.posthog?.taskId) {
                await this.clearTask()
                console.debug('cleared task')
            }

            const { taskDirPath, apiConversationHistoryFilePath, uiMessagesFilePath } = await this.getTaskWithId(id)

            const updatedTaskHistory = await this.deleteTaskFromState(id)

            // Delete the task files
            const apiConversationHistoryFileExists = await fileExistsAtPath(apiConversationHistoryFilePath)
            if (apiConversationHistoryFileExists) {
                await fs.unlink(apiConversationHistoryFilePath)
            }
            const uiMessagesFileExists = await fileExistsAtPath(uiMessagesFilePath)
            if (uiMessagesFileExists) {
                await fs.unlink(uiMessagesFilePath)
            }
            const legacyMessagesFilePath = path.join(taskDirPath, 'claude_messages.json')
            if (await fileExistsAtPath(legacyMessagesFilePath)) {
                await fs.unlink(legacyMessagesFilePath)
            }

            await fs.rmdir(taskDirPath) // succeeds if the dir is empty

            if (updatedTaskHistory.length === 0) {
                await this.deleteAllTaskHistory()
            }
        } catch (error) {
            console.debug(`Error deleting task:`, error)
        }

        this.refreshTotalTasksSize()
    }

    async deleteTaskFromState(id: string) {
        // Remove the task from history
        const taskHistory = ((await this.getGlobalState('taskHistory')) as HistoryItem[] | undefined) || []
        const updatedTaskHistory = taskHistory.filter((task) => task.id !== id)
        await this.updateGlobalState('taskHistory', updatedTaskHistory)

        // Notify the webview that the task has been deleted
        await this.postStateToWebview()

        return updatedTaskHistory
    }

    async postStateToWebview() {
        const state = await this.getStateToPostToWebview()
        this.postMessageToWebview({ type: 'state', state })
    }

    async getStateToPostToWebview(): Promise<ExtensionState> {
        const {
            apiConfiguration,
            customInstructions,
            taskHistory,
            autoApprovalSettings,
            browserSettings,
            chatSettings,
            userInfo,
            telemetrySetting,
            planActSeparateModelsSetting,
            enableTabAutocomplete,
        } = await this.getState()

        return {
            version: this.context.extension?.packageJSON?.version ?? '',
            apiConfiguration,
            customInstructions,
            uriScheme: vscode.env.uriScheme,
            currentTaskItem: this.posthog?.taskId
                ? (taskHistory || []).find((item) => item.id === this.posthog?.taskId)
                : undefined,
            checkpointTrackerErrorMessage: this.posthog?.checkpointTrackerErrorMessage,
            posthogMessages: this.posthog?.posthogMessages || [],
            taskHistory: (taskHistory || [])
                .filter((item) => item.ts && item.task)
                .sort((a, b) => b.ts - a.ts)
                .slice(0, 100), // for now we're only getting the latest 100 tasks, but a better solution here is to only pass in 3 for recent task history, and then get the full task history on demand when going to the task history view (maybe with pagination?)
            platform: process.platform as Platform,
            autoApprovalSettings,
            browserSettings,
            chatSettings,
            userInfo,
            telemetrySetting,
            planActSeparateModelsSetting,
            vscMachineId: vscode.env.machineId,
            enableTabAutocomplete: enableTabAutocomplete ?? false,
        }
    }

    async clearTask() {
        this.posthog?.abortTask()
        this.posthog = undefined // removes reference to it, so once promises end it will be garbage collected
    }

    // Caching mechanism to keep track of webview messages + API conversation history per provider instance

    /*
    Now that we use retainContextWhenHidden, we don't have to store a cache of posthog messages in the user's state, but we could to reduce memory footprint in long conversations.

    - We have to be careful of what state is shared between PostHogProvider instances since there could be multiple instances of the extension running at once. For example when we cached posthog messages using the same key, two instances of the extension could end up using the same key and overwriting each other's messages.
    - Some state does need to be shared between the instances, i.e. the API key--however there doesn't seem to be a good way to notify the other instances that the API key has changed.

    We need to use a unique identifier for each PostHogProvider instance's message cache since we could be running several instances of the extension outside of just the sidebar i.e. in editor panels.

    // conversation history to send in API requests

    /*
    It seems that some API messages do not comply with vscode state requirements. Either the Anthropic library is manipulating these values somehow in the backend in a way thats creating cyclic references, or the API returns a function or a Symbol as part of the message content.
    VSCode docs about state: "The value must be JSON-stringifyable ... value — A value. MUST not contain cyclic references."
    For now we'll store the conversation history in memory, and if we need to store in state directly we'd need to do a manual conversion to ensure proper json stringification.
    */

    // getApiConversationHistory(): Anthropic.MessageParam[] {
    // 	// const history = (await this.getGlobalState(
    // 	// 	this.getApiConversationHistoryStateKey()
    // 	// )) as Anthropic.MessageParam[]
    // 	// return history || []
    // 	return this.apiConversationHistory
    // }

    // setApiConversationHistory(history: Anthropic.MessageParam[] | undefined) {
    // 	// await this.updateGlobalState(this.getApiConversationHistoryStateKey(), history)
    // 	this.apiConversationHistory = history || []
    // }

    // addMessageToApiConversationHistory(message: Anthropic.MessageParam): Anthropic.MessageParam[] {
    // 	// const history = await this.getApiConversationHistory()
    // 	// history.push(message)
    // 	// await this.setApiConversationHistory(history)
    // 	// return history
    // 	this.apiConversationHistory.push(message)
    // 	return this.apiConversationHistory
    // }

    /*
    Storage
    https://dev.to/kompotkot/how-to-use-secretstorage-in-your-vscode-extensions-2hco
    https://www.eliostruyf.com/devhack-code-extension-storage-options/
    */

    async getState() {
        const [
            storedApiProvider,
            storedCompletionApiProvider,
            storedApiModelId,
            posthogApiKey,
            customInstructions,
            taskHistory,
            autoApprovalSettings,
            browserSettings,
            chatSettings,
            userInfo,
            previousModeApiProvider,
            previousModeModelId,
            previousModeModelInfo,
            previousModeThinkingEnabled,
            telemetrySetting,
            thinkingEnabled,
            planActSeparateModelsSettingRaw,
            enableTabAutocomplete,
        ] = await Promise.all([
            this.getGlobalState('apiProvider') as Promise<ApiProvider | undefined>,
            this.getGlobalState('completionApiProvider') as Promise<CompletionApiProvider | undefined>,
            this.getGlobalState('apiModelId') as Promise<string | undefined>,
            this.getSecret('posthogApiKey') as Promise<string | undefined>,
            this.getGlobalState('customInstructions') as Promise<string | undefined>,
            this.getGlobalState('taskHistory') as Promise<HistoryItem[] | undefined>,
            this.getGlobalState('autoApprovalSettings') as Promise<AutoApprovalSettings | undefined>,
            this.getGlobalState('browserSettings') as Promise<BrowserSettings | undefined>,
            this.getGlobalState('chatSettings') as Promise<ChatSettings | undefined>,
            this.getGlobalState('userInfo') as Promise<UserInfo | undefined>,
            this.getGlobalState('previousModeApiProvider') as Promise<ApiProvider | undefined>,
            this.getGlobalState('previousModeModelId') as Promise<string | undefined>,
            this.getGlobalState('previousModeModelInfo') as Promise<ModelInfo | undefined>,
            this.getGlobalState('previousModeThinkingEnabled') as Promise<boolean | undefined>,
            this.getGlobalState('telemetrySetting') as Promise<TelemetrySetting | undefined>,
            this.getGlobalState('thinkingEnabled') as Promise<boolean | undefined>,
            this.getGlobalState('planActSeparateModelsSetting') as Promise<boolean | undefined>,
            this.getGlobalState('enableTabAutocomplete') as Promise<boolean | undefined>,
        ])

        let apiProvider: ApiProvider
        if (storedApiProvider) {
            apiProvider = storedApiProvider
        } else {
            // Either new user or legacy user that doesn't have the apiProvider stored in state
            apiProvider = 'anthropic'
        }
        let apiModelId: string
        if (storedApiModelId) {
            apiModelId = storedApiModelId
        } else {
            apiModelId = anthropicDefaultModelId
        }
        let completionApiProvider: CompletionApiProvider
        if (storedCompletionApiProvider) {
            completionApiProvider = storedCompletionApiProvider
        } else {
            completionApiProvider = 'codestral'
        }

        // Plan/Act separate models setting is a boolean indicating whether the user wants to use different models for plan and act. Existing users expect this to be enabled, while we want new users to opt in to this being disabled by default.
        // On win11 state sometimes initializes as empty string instead of undefined
        let planActSeparateModelsSetting: boolean | undefined = undefined
        if (planActSeparateModelsSettingRaw === true || planActSeparateModelsSettingRaw === false) {
            planActSeparateModelsSetting = planActSeparateModelsSettingRaw
        } else {
            // default to true for existing users
            if (storedApiProvider) {
                planActSeparateModelsSetting = true
            } else {
                // default to false for new users
                planActSeparateModelsSetting = false
            }
            // this is a special case where it's a new state, but we want it to default to different values for existing and new users.
            // persist so next time state is retrieved it's set to the correct value.
            await this.updateGlobalState('planActSeparateModelsSetting', planActSeparateModelsSetting)
        }

        return {
            apiConfiguration: {
                apiProvider,
                completionApiProvider,
                apiModelId,
                posthogApiKey,
                thinkingEnabled,
            },
            customInstructions,
            taskHistory,
            autoApprovalSettings: autoApprovalSettings || DEFAULT_AUTO_APPROVAL_SETTINGS, // default value can be 0 or empty string
            browserSettings: browserSettings || DEFAULT_BROWSER_SETTINGS,
            chatSettings: chatSettings || DEFAULT_CHAT_SETTINGS,
            userInfo,
            previousModeApiProvider,
            previousModeModelId,
            previousModeModelInfo,
            previousModeThinkingEnabled,
            telemetrySetting: telemetrySetting || 'unset',
            planActSeparateModelsSetting,
            enableTabAutocomplete,
        }
    }

    async updateTaskHistory(item: HistoryItem): Promise<HistoryItem[]> {
        const history = ((await this.getGlobalState('taskHistory')) as HistoryItem[]) || []
        const existingItemIndex = history.findIndex((h) => h.id === item.id)
        if (existingItemIndex !== -1) {
            history[existingItemIndex] = item
        } else {
            history.push(item)
        }
        await this.updateGlobalState('taskHistory', history)
        return history
    }

    // global

    async updateGlobalState(key: GlobalStateKey, value: any) {
        await this.context.globalState.update(key, value)
    }

    async getGlobalState(key: GlobalStateKey) {
        return await this.context.globalState.get(key)
    }

    // private async clearState() {
    // 	this.context.workspaceState.keys().forEach((key) => {
    // 		this.context.workspaceState.update(key, undefined)
    // 	})
    // 	this.context.globalState.keys().forEach((key) => {
    // 		this.context.globalState.update(key, undefined)
    // 	})
    // 	this.context.secrets.delete("apiKey")
    // }

    // secrets

    private async storeSecret(key: SecretKey, value?: string) {
        if (value) {
            await this.context.secrets.store(key, value)
        } else {
            await this.context.secrets.delete(key)
        }
    }

    async getSecret(key: SecretKey) {
        return await this.context.secrets.get(key)
    }

    // Open Graph Data

    async fetchOpenGraphData(url: string) {
        try {
            // Use the fetchOpenGraphData function from link-preview.ts
            const ogData = await fetchOpenGraphData(url)

            // Send the data back to the webview
            await this.postMessageToWebview({
                type: 'openGraphData',
                openGraphData: ogData,
                url: url,
            })
        } catch (error) {
            console.error(`Error fetching Open Graph data for ${url}:`, error)
            // Send an error response
            await this.postMessageToWebview({
                type: 'openGraphData',
                error: `Failed to fetch Open Graph data: ${error}`,
                url: url,
            })
        }
    }

    // Check if a URL is an image
    async checkIsImageUrl(url: string) {
        try {
            // Check if the URL is an image
            const isImage = await isImageUrl(url)

            // Send the result back to the webview
            await this.postMessageToWebview({
                type: 'isImageUrlResult',
                isImage,
                url,
            })
        } catch (error) {
            console.error(`Error checking if URL is an image: ${url}`, error)
            // Send an error response
            await this.postMessageToWebview({
                type: 'isImageUrlResult',
                isImage: false,
                url,
            })
        }
    }

    // dev

    async resetState() {
        vscode.window.showInformationMessage('Resetting state...')
        for (const key of this.context.globalState.keys()) {
            await this.context.globalState.update(key, undefined)
        }
        const secretKeys: SecretKey[] = ['posthogApiKey']
        for (const key of secretKeys) {
            await this.storeSecret(key, undefined)
        }
        if (this.posthog) {
            this.posthog.abortTask()
            this.posthog = undefined
        }
        vscode.window.showInformationMessage('State reset')
        await this.postStateToWebview()
        await this.postMessageToWebview({
            type: 'action',
            action: 'chatButtonClicked',
        })
    }
}
