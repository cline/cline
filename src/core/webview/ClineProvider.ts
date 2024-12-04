import * as vscode from "vscode"
import { findLast } from "../../shared/array"
import { ExtensionMessage } from "../../shared/ExtensionMessage"
import { WebviewMessage } from "../../shared/WebviewMessage"
import { buildApiHandler } from "../../api"
import { openFile, openImage } from "../../integrations/misc/open-file"
import { selectImages } from "../../integrations/misc/process-images"
import { openMention } from "../mentions"
import { ClineState } from "./state/ClineState"
import { TaskHistory } from "./task/TaskHistory"
import { ModelManager } from "./models/ModelManager"
import { WebviewManager } from "./WebviewManager"
import { ClineApi } from "../ClineApi"
import WorkspaceTracker from "../../integrations/workspace/WorkspaceTracker"
import pWaitFor from "p-wait-for"
import { getTheme } from "../../integrations/theme/getTheme"
import { HistoryItem } from "../../shared/HistoryItem"
import { GlobalStateKey } from "./state/ClineState"
import { ApiProvider } from "../../shared/api"

export class ClineProvider implements vscode.WebviewViewProvider {
    public static readonly sideBarId = "claude-dev.SidebarProvider"
    public static readonly tabPanelId = "claude-dev.TabPanelProvider"
    private static activeInstances: Set<ClineProvider> = new Set()
    private disposables: vscode.Disposable[] = []
    private view?: vscode.WebviewView | vscode.WebviewPanel
    private cline?: ClineApi
    private workspaceTracker?: WorkspaceTracker
    private readonly state: ClineState
    private readonly taskHistory: TaskHistory
    private readonly modelManager: ModelManager
    private readonly webviewManager: WebviewManager
    private latestAnnouncementId = "oct-28-2024"

    constructor(
        readonly context: vscode.ExtensionContext,
        private readonly outputChannel: vscode.OutputChannel,
    ) {
        this.outputChannel.appendLine("ClineProvider instantiated")
        ClineProvider.activeInstances.add(this)
        this.state = new ClineState(context)
        this.taskHistory = new TaskHistory(context, this.state)
        this.modelManager = new ModelManager(context)
        this.webviewManager = new WebviewManager(context, (message) => this.handleWebviewMessage(message))
        this.workspaceTracker = new WorkspaceTracker(this)
    }

    // Methods used by exports/index.ts and extension.ts
    async updateCustomInstructions(instructions?: string) {
        await this.state.updateGlobalState("customInstructions", instructions || undefined)
        if (this.cline) {
            this.cline.customInstructions = instructions || undefined
        }
        await this.postStateToWebview()
    }

    async getGlobalState(key: GlobalStateKey) {
        return await this.state.getGlobalState(key)
    }

    async handleOpenRouterCallback(code: string) {
        const apiKey = await this.modelManager.handleOpenRouterCallback(code)
        const openrouter: ApiProvider = "openrouter"
        await this.state.updateGlobalState("apiProvider", openrouter)
        await this.state.storeSecret("openRouterApiKey", apiKey)
        await this.postStateToWebview()
        if (this.cline) {
            this.cline.api = buildApiHandler({ apiProvider: openrouter, openRouterApiKey: apiKey })
        }
    }

    async dispose() {
        this.outputChannel.appendLine("Disposing ClineProvider...")
        await this.clearTask()
        this.outputChannel.appendLine("Cleared task")
        if (this.view && "dispose" in this.view) {
            this.view.dispose()
            this.outputChannel.appendLine("Disposed webview")
        }
        while (this.disposables.length) {
            const x = this.disposables.pop()
            if (x) {
                x.dispose()
            }
        }
        this.workspaceTracker?.dispose()
        this.workspaceTracker = undefined
        this.outputChannel.appendLine("Disposed all disposables")
        ClineProvider.activeInstances.delete(this)
    }

    public static getVisibleInstance(): ClineProvider | undefined {
        return findLast(Array.from(this.activeInstances), (instance) => instance.view?.visible === true)
    }

    resolveWebviewView(webviewView: vscode.WebviewView | vscode.WebviewPanel): void | Thenable<void> {
        this.outputChannel.appendLine("Resolving webview view")
        this.view = webviewView

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri],
        }
        webviewView.webview.html = this.webviewManager.getHtmlContent(webviewView.webview)

        this.webviewManager.setupMessageListener(webviewView.webview, this.disposables)
        this.webviewManager.setupVisibilityListener(webviewView, (m) => this.postMessageToWebview(m), this.disposables)
        this.webviewManager.setupThemeListener((m) => this.postMessageToWebview(m), this.disposables)

        webviewView.onDidDispose(
            async () => {
                await this.dispose()
            },
            null,
            this.disposables,
        )

        this.clearTask()
        this.outputChannel.appendLine("Webview view resolved")
    }

    async postMessageToWebview(message: ExtensionMessage) {
        await this.view?.webview.postMessage(message)
    }

    async postStateToWebview() {
        const state = await this.getStateToPostToWebview()
        this.postMessageToWebview({ type: "state", state })
    }

    private async getStateToPostToWebview() {
        const { apiConfiguration, lastShownAnnouncementId, customInstructions, alwaysAllowReadOnly, taskHistory } =
            await this.state.getState()
        return {
            version: this.context.extension?.packageJSON?.version ?? "",
            apiConfiguration,
            customInstructions,
            alwaysAllowReadOnly,
            uriScheme: vscode.env.uriScheme,
            clineMessages: this.cline?.clineMessages || [],
            taskHistory: (taskHistory || []).filter((item) => item.ts && item.task).sort((a, b) => b.ts - a.ts),
            shouldShowAnnouncement: lastShownAnnouncementId !== this.latestAnnouncementId,
        }
    }

    async clearTask() {
        this.cline?.abortTask()
        this.cline = undefined
    }

    async initClineWithTask(task?: string, images?: string[]) {
        await this.clearTask()
        const { apiConfiguration, customInstructions, alwaysAllowReadOnly } = await this.state.getState()
        this.cline = new ClineApi(this, apiConfiguration, customInstructions, alwaysAllowReadOnly, task, images)
    }

    async initClineWithHistoryItem(historyItem: any) {
        await this.clearTask()
        const { apiConfiguration, customInstructions, alwaysAllowReadOnly } = await this.state.getState()
        this.cline = new ClineApi(
            this,
            apiConfiguration,
            customInstructions,
            alwaysAllowReadOnly,
            undefined,
            undefined,
            historyItem,
        )
    }

    async updateTaskHistory(item: HistoryItem): Promise<HistoryItem[]> {
        return await this.taskHistory.updateTaskHistory(item)
    }

    private async handleWebviewMessage(message: WebviewMessage) {
        switch (message.type) {
            case "webviewDidLaunch":
                this.postStateToWebview()
                this.workspaceTracker?.initializeFilePaths()
                const theme = await getTheme()
                await this.postMessageToWebview({ type: "theme", text: JSON.stringify(theme) })
                
                const openRouterModels = await this.modelManager.readOpenRouterModels()
                if (openRouterModels) {
                    await this.postMessageToWebview({ type: "openRouterModels", openRouterModels })
                }
                
                const refreshedModels = await this.modelManager.refreshOpenRouterModels()
                if (refreshedModels) {
                    const { apiConfiguration } = await this.state.getState()
                    if (apiConfiguration.openRouterModelId) {
                        await this.state.updateGlobalState(
                            "openRouterModelInfo",
                            refreshedModels[apiConfiguration.openRouterModelId],
                        )
                        await this.postStateToWebview()
                    }
                }
                break

            case "newTask":
                await this.initClineWithTask(message.text, message.images)
                break

            case "apiConfiguration":
                if (message.apiConfiguration) {
                    const {
                        apiProvider,
                        apiModelId,
                        apiKey,
                        openRouterApiKey,
                        awsAccessKey,
                        awsSecretKey,
                        awsSessionToken,
                        awsRegion,
                        awsUseCrossRegionInference,
                        vertexProjectId,
                        vertexRegion,
                        openAiBaseUrl,
                        openAiApiKey,
                        openAiModelId,
                        ollamaModelId,
                        ollamaBaseUrl,
                        lmStudioModelId,
                        lmStudioBaseUrl,
                        anthropicBaseUrl,
                        geminiApiKey,
                        openAiNativeApiKey,
                        azureApiVersion,
                        openRouterModelId,
                        openRouterModelInfo,
                    } = message.apiConfiguration

                    await this.state.updateGlobalState("apiProvider", apiProvider)
                    await this.state.updateGlobalState("apiModelId", apiModelId)
                    await this.state.storeSecret("apiKey", apiKey)
                    await this.state.storeSecret("openRouterApiKey", openRouterApiKey)
                    await this.state.storeSecret("awsAccessKey", awsAccessKey)
                    await this.state.storeSecret("awsSecretKey", awsSecretKey)
                    await this.state.storeSecret("awsSessionToken", awsSessionToken)
                    await this.state.updateGlobalState("awsRegion", awsRegion)
                    await this.state.updateGlobalState("awsUseCrossRegionInference", awsUseCrossRegionInference)
                    await this.state.updateGlobalState("vertexProjectId", vertexProjectId)
                    await this.state.updateGlobalState("vertexRegion", vertexRegion)
                    await this.state.updateGlobalState("openAiBaseUrl", openAiBaseUrl)
                    await this.state.storeSecret("openAiApiKey", openAiApiKey)
                    await this.state.updateGlobalState("openAiModelId", openAiModelId)
                    await this.state.updateGlobalState("ollamaModelId", ollamaModelId)
                    await this.state.updateGlobalState("ollamaBaseUrl", ollamaBaseUrl)
                    await this.state.updateGlobalState("lmStudioModelId", lmStudioModelId)
                    await this.state.updateGlobalState("lmStudioBaseUrl", lmStudioBaseUrl)
                    await this.state.updateGlobalState("anthropicBaseUrl", anthropicBaseUrl)
                    await this.state.storeSecret("geminiApiKey", geminiApiKey)
                    await this.state.storeSecret("openAiNativeApiKey", openAiNativeApiKey)
                    await this.state.updateGlobalState("azureApiVersion", azureApiVersion)
                    await this.state.updateGlobalState("openRouterModelId", openRouterModelId)
                    await this.state.updateGlobalState("openRouterModelInfo", openRouterModelInfo)

                    if (this.cline) {
                        this.cline.api = buildApiHandler(message.apiConfiguration)
                    }
                }
                await this.postStateToWebview()
                break

            case "customInstructions":
                await this.state.updateGlobalState("customInstructions", message.text || undefined)
                if (this.cline) {
                    this.cline.customInstructions = message.text || undefined
                }
                await this.postStateToWebview()
                break

            case "alwaysAllowReadOnly":
                await this.state.updateGlobalState("alwaysAllowReadOnly", message.bool ?? undefined)
                if (this.cline) {
                    this.cline.alwaysAllowReadOnly = message.bool ?? false
                }
                await this.postStateToWebview()
                break

            case "askResponse":
                this.cline?.handleWebviewAskResponse(message.askResponse!, message.text, message.images)
                break

            case "clearTask":
                await this.clearTask()
                await this.postStateToWebview()
                break

            case "didShowAnnouncement":
                await this.state.updateGlobalState("lastShownAnnouncementId", this.latestAnnouncementId)
                await this.postStateToWebview()
                break

            case "selectImages":
                const images = await selectImages()
                await this.postMessageToWebview({ type: "selectedImages", images })
                break

            case "exportCurrentTask":
                if (this.cline?.taskId) {
                    await this.taskHistory.exportTaskWithId(this.cline.taskId)
                }
                break

            case "showTaskWithId":
                await this.showTaskWithId(message.text!)
                break

            case "deleteTaskWithId":
                await this.taskHistory.deleteTaskWithId(message.text!)
                await this.postStateToWebview()
                break

            case "exportTaskWithId":
                await this.taskHistory.exportTaskWithId(message.text!)
                break

            case "resetState":
                await this.state.resetState()
                if (this.cline) {
                    this.cline.abortTask()
                    this.cline = undefined
                }
                await this.postStateToWebview()
                await this.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
                break

            case "requestOllamaModels":
                const ollamaModels = await this.modelManager.getOllamaModels(message.text)
                this.postMessageToWebview({ type: "ollamaModels", ollamaModels })
                break

            case "requestLmStudioModels":
                const lmStudioModels = await this.modelManager.getLmStudioModels(message.text)
                this.postMessageToWebview({ type: "lmStudioModels", lmStudioModels })
                break

            case "refreshOpenRouterModels":
                await this.modelManager.refreshOpenRouterModels()
                break

            case "openImage":
                openImage(message.text!)
                break

            case "openFile":
                openFile(message.text!)
                break

            case "openMention":
                openMention(message.text)
                break

            case "cancelTask":
                if (this.cline) {
                    const { historyItem } = await this.taskHistory.getTaskWithId(this.cline.taskId)
                    this.cline.abortTask()
                    await pWaitFor(() => this.cline === undefined || this.cline.didFinishAborting, {
                        timeout: 3_000,
                    }).catch(() => {
                        console.error("Failed to abort task")
                    })
                    if (this.cline) {
                        this.cline.abandoned = true
                    }
                    await this.initClineWithHistoryItem(historyItem)
                }
                break
        }
    }

    private async showTaskWithId(id: string) {
        if (id !== this.cline?.taskId) {
            const { historyItem } = await this.taskHistory.getTaskWithId(id)
            await this.initClineWithHistoryItem(historyItem)
        }
        await this.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
    }
}
