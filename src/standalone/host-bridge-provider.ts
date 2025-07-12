import * as proto from "@shared/proto/index"

/**
 * Streaming response handler type for host bridge services
 */
export type StreamingResponseHandler = (response: any, isLast?: boolean, sequenceNumber?: number) => Promise<void>

/**
 * Interface for workspace service implementation
 */
export interface WorkspaceService {
	getWorkspacePaths(request: proto.host.GetWorkspacePathsRequest): Promise<proto.host.GetWorkspacePathsResponse>
	searchFiles(request: proto.host.SearchFilesRequest): Promise<proto.host.SearchFilesResponse>
	openTextDocument(request: proto.host.OpenTextDocumentRequest): Promise<proto.host.OpenTextDocumentResponse>
}

/**
 * Interface for window service implementation
 */
export interface WindowService {
	showTextDocument(request: proto.host.ShowTextDocumentRequest): Promise<proto.host.TextEditorInfo>
	showOpenDialogue(request: proto.host.ShowOpenDialogueRequest): Promise<proto.host.SelectedResources>
	getActiveTextEditor(request: proto.host.GetActiveTextEditorRequest): Promise<proto.host.ActiveTextEditorInfo>
	getVisibleTextEditors(request: proto.host.GetVisibleTextEditorsRequest): Promise<proto.host.VisibleTextEditorsInfo>
	showErrorMessage(request: proto.host.ShowErrorMessageRequest): Promise<proto.host.ShowMessageResponse>
	showInformationMessage(request: proto.host.ShowInformationMessageRequest): Promise<proto.host.ShowMessageResponse>
	showWarningMessage(request: proto.host.ShowWarningMessageRequest): Promise<proto.host.ShowMessageResponse>
	showInputBox(request: proto.host.ShowInputBoxRequest): Promise<proto.host.ShowInputBoxResponse>
	showSaveDialog(request: proto.host.ShowSaveDialogRequest): Promise<proto.host.ShowSaveDialogResponse>
}

/**
 * Interface for terminal service implementation
 */
export interface TerminalService {
	createTerminal(request: proto.host.CreateTerminalRequest): Promise<proto.host.TerminalInfo>
	getActiveTerminal(request: proto.cline.EmptyRequest): Promise<proto.host.TerminalInfo>
	getAllTerminals(request: proto.cline.EmptyRequest): Promise<proto.host.TerminalInfoList>
}

/**
 * Interface for command service implementation
 */
export interface CommandService {
	executeCommand(request: proto.host.ExecuteCommandRequest): Promise<proto.cline.Empty>
	setContext(request: proto.host.SetContextRequest): Promise<proto.cline.Empty>
	focusSidebar(request: proto.host.FocusSidebarRequest): Promise<proto.cline.Empty>
	newGroupRight(request: proto.host.NewGroupRightRequest): Promise<proto.cline.Empty>
	lockEditorGroup(request: proto.host.LockEditorGroupRequest): Promise<proto.cline.Empty>
	openWalkthrough(request: proto.host.OpenWalkthroughRequest): Promise<proto.cline.Empty>
	reloadWindow(request: proto.host.ReloadWindowRequest): Promise<proto.cline.Empty>
}

/**
 * Interface for environment service implementation
 */
export interface EnvService {
	clipboardWriteText(request: proto.cline.StringRequest): Promise<proto.cline.Empty>
	clipboardReadText(request: proto.cline.EmptyRequest): Promise<proto.cline.String>
}

/**
 * Interface for watch service implementation
 */
export interface WatchService {
	subscribeToFile(
		request: proto.host.SubscribeToFileRequest,
		responseStream: StreamingResponseHandler,
		requestId?: string,
	): Promise<void>
}

/**
 * Main host bridge provider interface
 */
export interface HostBridgeProvider {
	workspaceService: WorkspaceService
	windowService: WindowService
	terminalService: TerminalService
	commandService: CommandService
	envService: EnvService
	watchService: WatchService
}
