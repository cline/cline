import * as vscode from "vscode"
import { Cline } from "../Cline"
import { GlobalStateKey, SecretKey } from "../../types/state"
import { HistoryItem } from "../../shared/HistoryItem"
import { ExtensionMessage } from "../../shared/ExtensionMessage"
import { ApiConfiguration } from "../../shared/api"
import WorkspaceTracker from "../../integrations/workspace/WorkspaceTracker"

export interface IClineProvider {
	workspaceTracker?: WorkspaceTracker
	readonly context: vscode.ExtensionContext
	getCline(): Cline | undefined
	setCline(cline: Cline | undefined): void
	getLatestAnnouncementId(): string
	dispose(): Promise<void>
	handleSignOut(): Promise<void>
	setAuthToken(token?: string): Promise<void>
	setUserInfo(info?: { displayName: string | null; email: string | null; photoURL: string | null }): Promise<void>
	postMessageToWebview(message: ExtensionMessage): Promise<void>
	postStateToWebview(): Promise<void>
	getState(): Promise<{
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
	updateGlobalState(key: GlobalStateKey, value: any): Promise<void>
	getGlobalState(key: GlobalStateKey): Promise<any>
	storeSecret(key: SecretKey, value?: string): Promise<void>
	getSecret(key: SecretKey): Promise<any>

	// Additional required methods
	clearTask(): Promise<void>
	initClineWithTask(task?: string, images?: string[]): Promise<void>
	initClineWithHistoryItem(historyItem: HistoryItem): Promise<void>
	updateCustomInstructions(instructions?: string): Promise<void>
	cancelTask(): Promise<void>
	getTaskWithId(id: string): Promise<{
		historyItem: HistoryItem
		taskDirPath: string
		apiConversationHistoryFilePath: string
		uiMessagesFilePath: string
		apiConversationHistory: any[]
	}>
	deleteTaskWithId(id: string): Promise<void>
}
