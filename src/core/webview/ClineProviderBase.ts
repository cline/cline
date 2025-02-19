import * as vscode from "vscode"
import { Cline } from "../Cline"
import WorkspaceTracker from "../../integrations/workspace/WorkspaceTracker"
import { McpHub } from "../../services/mcp/McpHub"
import { FirebaseAuthManager } from "../../services/auth/FirebaseAuthManager"
import { StateManager } from "../state/StateManager"
import { WebviewMessageHandler } from "./WebviewMessageHandler"
import { IClineProvider } from "./IClineProvider"
import { ExtensionMessage, ExtensionState } from "../../shared/ExtensionMessage"
import { GlobalStateKey, SecretKey } from "../../types/state"
import { HistoryItem } from "../../shared/HistoryItem"
import { ApiConfiguration } from "../../api/types"

export abstract class ClineProviderBase implements vscode.WebviewViewProvider, IClineProvider {
	public static readonly sideBarId = "claude-dev.SidebarProvider"
	public static readonly tabPanelId = "claude-dev.TabPanelProvider"
	private static activeInstances: Set<IClineProvider> = new Set()
	protected disposables: vscode.Disposable[] = []
	protected view?: vscode.WebviewView | vscode.WebviewPanel
	protected cline?: Cline
	workspaceTracker?: WorkspaceTracker
	mcpHub?: McpHub
	protected stateManager: StateManager
	protected messageHandler: WebviewMessageHandler
	protected authManager: FirebaseAuthManager
	readonly latestAnnouncementId = "jan-20-2025"

	constructor(
		readonly context: vscode.ExtensionContext,
		protected readonly outputChannel: vscode.OutputChannel,
	) {
		this.outputChannel.appendLine("ClineProvider instantiated")
		ClineProviderBase.activeInstances.add(this)

		this.stateManager = new StateManager(context)
		this.messageHandler = new WebviewMessageHandler(this, this.stateManager)

		// Initialize these after messageHandler since they depend on IClineProvider
		this.workspaceTracker = new WorkspaceTracker(this)
		this.mcpHub = new McpHub(this)
		this.authManager = new FirebaseAuthManager(this)
	}

	// Methods that need to be accessible to WebviewMessageHandler
	getCline(): Cline | undefined {
		return this.cline
	}

	setCline(cline: Cline | undefined) {
		this.cline = cline
	}

	getLatestAnnouncementId(): string {
		return this.latestAnnouncementId
	}

	// Required abstract methods that must be implemented by ClineProvider
	abstract resolveWebviewView(webviewView: vscode.WebviewView | vscode.WebviewPanel): void | Thenable<void>
	abstract dispose(): Promise<void>
	abstract handleSignOut(): Promise<void>
	abstract setAuthToken(token?: string): Promise<void>
	abstract setUserInfo(info?: { displayName: string | null; email: string | null; photoURL: string | null }): Promise<void>
	abstract postMessageToWebview(message: ExtensionMessage): Promise<void>
	abstract postStateToWebview(): Promise<void>
	abstract getState(): Promise<{
		apiConfiguration: ApiConfiguration
		lastShownAnnouncementId?: string
		customInstructions?: string
		taskHistory?: HistoryItem[]
		autoApprovalSettings: any
		browserSettings: any
		chatSettings: any
		userInfo?: any
		authToken?: string
	}>
	abstract updateGlobalState(key: GlobalStateKey, value: any): Promise<void>
	abstract getGlobalState(key: GlobalStateKey): Promise<any>
	abstract storeSecret(key: SecretKey, value?: string): Promise<void>
	abstract getSecret(key: SecretKey): Promise<any>

	// Required method for task management
	abstract clearTask(): Promise<void>

	// Additional required abstract methods
	abstract initClineWithTask(task?: string, images?: string[]): Promise<void>
	abstract initClineWithHistoryItem(historyItem: HistoryItem): Promise<void>
	abstract updateCustomInstructions(instructions?: string): Promise<void>
	abstract cancelTask(): Promise<void>
	abstract getTaskWithId(id: string): Promise<{
		historyItem: HistoryItem
		taskDirPath: string
		apiConversationHistoryFilePath: string
		uiMessagesFilePath: string
		apiConversationHistory: any[]
	}>
	abstract deleteTaskWithId(id: string): Promise<void>

	// Protected abstract methods that ClineProvider must implement
	protected abstract fileExists(path: string): Promise<boolean>
	protected abstract deleteTaskFromState(id: string): Promise<void>

	// Public abstract methods that ClineProvider must implement
	abstract getStateToWebview(): Promise<ExtensionState>
	protected abstract getHtmlContent(webview: vscode.Webview): string
}
