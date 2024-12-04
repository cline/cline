import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "../api"
import { TerminalManager } from "../integrations/terminal/TerminalManager"
import { UrlContentFetcher } from "../services/browser/UrlContentFetcher"
import { BrowserSession } from "../services/browser/BrowserSession"
import { DiffViewProvider } from "../integrations/editor/DiffViewProvider"
import { ClineProvider } from "./webview/ClineProvider"
import { ClineMessage } from "../shared/ExtensionMessage"
import { ClineAskResponse } from "../shared/WebviewMessage"
import * as path from "path"
import * as os from "os"

export abstract class ClineBase {
    readonly taskId: string
    api: ApiHandler
    protected terminalManager: TerminalManager
    protected urlContentFetcher: UrlContentFetcher
    protected browserSession: BrowserSession
    protected diffViewProvider: DiffViewProvider
    customInstructions?: string
    alwaysAllowReadOnly: boolean
    apiConversationHistory: Anthropic.MessageParam[] = []
    clineMessages: ClineMessage[] = []
    protected askResponse?: ClineAskResponse
    protected askResponseText?: string
    protected askResponseImages?: string[]
    protected lastMessageTs?: number
    protected consecutiveMistakeCount: number = 0
    protected providerRef: WeakRef<ClineProvider>
    protected abort: boolean = false
    didFinishAborting = false
    abandoned = false
    protected didEditFile: boolean = false
    protected cwd: string

    constructor(
        provider: ClineProvider,
        apiConfiguration: any,
        customInstructions?: string,
        alwaysAllowReadOnly?: boolean,
        task?: string,
        images?: string[],
        historyItem?: any
    ) {
        this.providerRef = new WeakRef(provider)
        this.api = buildApiHandler(apiConfiguration)
        this.terminalManager = new TerminalManager()
        this.urlContentFetcher = new UrlContentFetcher(provider.context)
        this.browserSession = new BrowserSession(provider.context)
        this.cwd = process.env.VSCODE_CWD || path.join(os.homedir(), "Desktop")
        this.diffViewProvider = new DiffViewProvider(this.cwd)
        this.customInstructions = customInstructions
        this.alwaysAllowReadOnly = alwaysAllowReadOnly ?? false

        if (historyItem) {
            this.taskId = historyItem.id
            this.resumeTaskFromHistory()
        } else if (task || images) {
            this.taskId = Date.now().toString()
            this.startTask(task, images)
        } else {
            throw new Error("Either historyItem or task/images must be provided")
        }
    }

    protected abstract startTask(task?: string, images?: string[]): Promise<void>;
    protected abstract resumeTaskFromHistory(): Promise<void>;

    abortTask() {
        this.abort = true
        this.terminalManager.disposeAll()
        this.urlContentFetcher.closeBrowser()
        this.browserSession.closeBrowser()
    }
}

function buildApiHandler(config: any): ApiHandler {
    // Implementation needed
    return {} as ApiHandler
}
