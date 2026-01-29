/**
 * ACP Host Bridge Client Provider
 *
 * Implements HostBridgeClientProvider for ACP mode, providing stub implementations
 * of the 4 required service clients. These clients conform to the interfaces in
 * host-bridge-client-types.ts and will use ACP connection capabilities where applicable.
 *
 * @module acp
 */

import type * as acp from "@agentclientprotocol/sdk"
import type {
	DiffServiceClientInterface,
	EnvServiceClientInterface,
	WindowServiceClientInterface,
	WorkspaceServiceClientInterface,
} from "@generated/hosts/host-bridge-client-types"
import type { HostBridgeClientProvider, StreamingCallbacks } from "@hosts/host-provider-types"
import * as proto from "@shared/proto/index"
import { ClineClient } from "@/shared/cline"
import { Logger } from "@/shared/services/Logger"

/**
 * Function type that resolves the current session ID.
 * Returns undefined if no session is active.
 */
export type SessionIdResolver = () => string | undefined

/**
 * Function type that resolves the current working directory.
 * Returns undefined if no cwd is available (will fall back to process.cwd()).
 */
export type CwdResolver = () => string | undefined

/**
 * ACP implementation of DiffService client.
 *
 * Handles diff operations for the ACP environment. Most operations are stubs
 * that will be implemented in the next phase using ACP extension methods or
 * the fs capabilities (readTextFile/writeTextFile).
 */
class ACPDiffServiceClient implements DiffServiceClientInterface {
	async openDiff(_request: proto.host.OpenDiffRequest): Promise<proto.host.OpenDiffResponse> {
		// Next phase: Could use ACP client capabilities to open a diff view in the editor.
		// This would involve sending an ACP extension notification/request to the client
		// to display a side-by-side diff of the original vs modified content.
		Logger.debug("[ACPDiffServiceClient] openDiff called (stub)")
		return proto.host.OpenDiffResponse.create({})
	}

	async getDocumentText(request: proto.host.GetDocumentTextRequest): Promise<proto.host.GetDocumentTextResponse> {
		// Next phase: Use connection.readTextFile if clientCapabilities.fs.readTextFile is available.
		// This would read the current document content from the editor, including any unsaved changes.
		// For now, return empty content.
		Logger.debug("[ACPDiffServiceClient] getDocumentText called (stub)", { diffId: request.diffId })
		return proto.host.GetDocumentTextResponse.create({ content: "" })
	}

	async replaceText(_request: proto.host.ReplaceTextRequest): Promise<proto.host.ReplaceTextResponse> {
		// Next phase: Use connection.writeTextFile if clientCapabilities.fs.writeTextFile is available.
		// This would replace text in the document at the specified range.
		Logger.debug("[ACPDiffServiceClient] replaceText called (stub)")
		return proto.host.ReplaceTextResponse.create({})
	}

	async scrollDiff(_request: proto.host.ScrollDiffRequest): Promise<proto.host.ScrollDiffResponse> {
		// Next phase: Send ACP extension notification to scroll the diff view to a specific line.
		// No visual editor in ACP mode by default, so this is a no-op.
		Logger.debug("[ACPDiffServiceClient] scrollDiff called (stub)")
		return proto.host.ScrollDiffResponse.create({})
	}

	async truncateDocument(_request: proto.host.TruncateDocumentRequest): Promise<proto.host.TruncateDocumentResponse> {
		// Next phase: Read file using readTextFile, truncate content, write back using writeTextFile.
		// This is used to truncate a document to a specific line count.
		Logger.debug("[ACPDiffServiceClient] truncateDocument called (stub)")
		return proto.host.TruncateDocumentResponse.create({})
	}

	async saveDocument(_request: proto.host.SaveDocumentRequest): Promise<proto.host.SaveDocumentResponse> {
		// Next phase: Use connection.writeTextFile to persist the document to disk.
		// This saves the current document content to the file system.
		Logger.debug("[ACPDiffServiceClient] saveDocument called (stub)")
		return proto.host.SaveDocumentResponse.create({})
	}

	async closeAllDiffs(_request: proto.host.CloseAllDiffsRequest): Promise<proto.host.CloseAllDiffsResponse> {
		// Next phase: Send ACP extension notification to close all diff views in the editor.
		// No visual diff views in ACP mode by default, so this is a no-op.
		Logger.debug("[ACPDiffServiceClient] closeAllDiffs called (stub)")
		return proto.host.CloseAllDiffsResponse.create({})
	}

	async openMultiFileDiff(_request: proto.host.OpenMultiFileDiffRequest): Promise<proto.host.OpenMultiFileDiffResponse> {
		// Next phase: Send ACP extension notification to open a multi-file diff view.
		// This would display changes across multiple files in the editor.
		Logger.debug("[ACPDiffServiceClient] openMultiFileDiff called (stub)")
		return proto.host.OpenMultiFileDiffResponse.create({})
	}
}

/**
 * ACP implementation of EnvService client.
 *
 * Handles environment operations like clipboard access, version info, and telemetry.
 * Most operations are stubs that will be implemented using ACP extension methods.
 */
class ACPEnvServiceClient implements EnvServiceClientInterface {
	private readonly version: string

	constructor(
		_clientCapabilities: acp.ClientCapabilities | undefined,
		_sessionIdResolver: SessionIdResolver,
		version: string = "1.0.0",
	) {
		this.version = version
	}

	async debugLog(request: proto.cline.StringRequest): Promise<proto.cline.Empty> {
		Logger.debug(request.value)
		return proto.cline.Empty.create()
	}

	async clipboardWriteText(_request: proto.cline.StringRequest): Promise<proto.cline.Empty> {
		Logger.debug("[ACPEnvServiceClient] clipboardWriteText called (stub)")
		return proto.cline.Empty.create()
	}

	async clipboardReadText(_request: proto.cline.EmptyRequest): Promise<proto.cline.String> {
		Logger.debug("[ACPEnvServiceClient] clipboardReadText called (stub)")
		return proto.cline.String.create({ value: "" })
	}

	async getHostVersion(_request: proto.cline.EmptyRequest): Promise<proto.host.GetHostVersionResponse> {
		// Return version info for the ACP agent.
		return proto.host.GetHostVersionResponse.create({
			version: this.version,
			platform: "Cline ACP Agent",
			clineType: ClineClient.Cli,
		})
	}

	async getIdeRedirectUri(_request: proto.cline.EmptyRequest): Promise<proto.cline.String> {
		Logger.debug("[ACPEnvServiceClient] getIdeRedirectUri called (stub)")
		return proto.cline.String.create({ value: "" })
	}

	async getTelemetrySettings(_request: proto.cline.EmptyRequest): Promise<proto.host.GetTelemetrySettingsResponse> {
		// Return telemetry as disabled by default in ACP mode.
		return proto.host.GetTelemetrySettingsResponse.create({
			isEnabled: proto.host.Setting.DISABLED,
		})
	}

	subscribeToTelemetrySettings(
		_request: proto.cline.EmptyRequest,
		callbacks: StreamingCallbacks<proto.host.TelemetrySettingsEvent>,
	): () => void {
		// Send initial telemetry settings (disabled) and return unsubscribe function.
		callbacks.onResponse(
			proto.host.TelemetrySettingsEvent.create({
				isEnabled: proto.host.Setting.DISABLED,
			}),
		)
		// Return no-op unsubscribe function
		return () => {}
	}

	async shutdown(_request: proto.cline.EmptyRequest): Promise<proto.cline.Empty> {
		// Next phase: Graceful ACP connection shutdown.
		// This would cleanly close the ACP connection and release resources.
		Logger.debug("[ACPEnvServiceClient] shutdown called (stub)")
		return proto.cline.Empty.create()
	}
}

/**
 * ACP implementation of WindowService client.
 *
 * Handles window/UI operations like showing documents, dialogs, and messages.
 * Most operations are stubs that will be implemented using ACP extension methods.
 */
class ACPWindowServiceClient implements WindowServiceClientInterface {
	constructor(_clientCapabilities: acp.ClientCapabilities | undefined, _sessionIdResolver: SessionIdResolver) {}

	async showTextDocument(request: proto.host.ShowTextDocumentRequest): Promise<proto.host.TextEditorInfo> {
		// Next phase: Send ACP extension request to open document in the editor.
		// This would tell the ACP client to open the specified file.
		Logger.debug("[ACPWindowServiceClient] showTextDocument called (stub)", { path: request.path })
		return proto.host.TextEditorInfo.create({
			documentPath: request.path,
		})
	}

	async showOpenDialogue(_request: proto.host.ShowOpenDialogueRequest): Promise<proto.host.SelectedResources> {
		// Next phase: Send ACP extension request for file picker dialog.
		// This would display a file open dialog in the ACP client.
		Logger.debug("[ACPWindowServiceClient] showOpenDialogue called (stub)")
		return proto.host.SelectedResources.create({ paths: [] })
	}

	async showMessage(request: proto.host.ShowMessageRequest): Promise<proto.host.SelectedResponse> {
		// Next phase: Send ACP extension notification to show message in the editor.
		// This would display an information/warning/error message to the user.
		Logger.debug("[ACPWindowServiceClient] showMessage called (stub)", {
			message: request.message,
			type: request.type,
		})
		return proto.host.SelectedResponse.create({})
	}

	async showInputBox(_request: proto.host.ShowInputBoxRequest): Promise<proto.host.ShowInputBoxResponse> {
		// Next phase: Send ACP extension request for input dialog.
		// This would display an input box for user text entry.
		Logger.debug("[ACPWindowServiceClient] showInputBox called (stub)")
		return proto.host.ShowInputBoxResponse.create({ response: "" })
	}

	async showSaveDialog(_request: proto.host.ShowSaveDialogRequest): Promise<proto.host.ShowSaveDialogResponse> {
		// Next phase: Send ACP extension request for save dialog.
		// This would display a file save dialog in the ACP client.
		Logger.debug("[ACPWindowServiceClient] showSaveDialog called (stub)")
		return proto.host.ShowSaveDialogResponse.create({ selectedPath: "" })
	}

	async openFile(request: proto.host.OpenFileRequest): Promise<proto.host.OpenFileResponse> {
		// Next phase: Send ACP extension request to open file in the editor.
		// This would open the specified file in the ACP client's editor.
		Logger.debug("[ACPWindowServiceClient] openFile called (stub)", { filePath: request.filePath })
		return proto.host.OpenFileResponse.create({})
	}

	async openSettings(_request: proto.host.OpenSettingsRequest): Promise<proto.host.OpenSettingsResponse> {
		// Next phase: Send ACP extension request to open settings panel.
		// This would open the settings/preferences in the ACP client.
		Logger.debug("[ACPWindowServiceClient] openSettings called (stub)")
		return proto.host.OpenSettingsResponse.create({})
	}

	async getOpenTabs(_request: proto.host.GetOpenTabsRequest): Promise<proto.host.GetOpenTabsResponse> {
		// Next phase: Send ACP extension request to list open tabs/documents.
		// This would return a list of currently open files in the editor.
		Logger.debug("[ACPWindowServiceClient] getOpenTabs called (stub)")
		return proto.host.GetOpenTabsResponse.create({ paths: [] })
	}

	async getVisibleTabs(_request: proto.host.GetVisibleTabsRequest): Promise<proto.host.GetVisibleTabsResponse> {
		// Next phase: Send ACP extension request to list visible tabs.
		// This would return a list of visible tabs/panes in the editor.
		Logger.debug("[ACPWindowServiceClient] getVisibleTabs called (stub)")
		return proto.host.GetVisibleTabsResponse.create({ paths: [] })
	}

	async getActiveEditor(_request: proto.host.GetActiveEditorRequest): Promise<proto.host.GetActiveEditorResponse> {
		// Next phase: Send ACP extension request to get active editor info.
		// This would return information about the currently focused editor.
		Logger.debug("[ACPWindowServiceClient] getActiveEditor called (stub)")
		return proto.host.GetActiveEditorResponse.create({})
	}
}

/**
 * ACP implementation of WorkspaceService client.
 *
 * Handles workspace operations like getting paths, diagnostics, and terminal commands.
 * Uses the cwdResolver to get the current working directory, falling back to process.cwd().
 */
class ACPWorkspaceServiceClient implements WorkspaceServiceClientInterface {
	private readonly _clientCapabilities: acp.ClientCapabilities | undefined
	private readonly cwdResolver: CwdResolver

	constructor(
		clientCapabilities: acp.ClientCapabilities | undefined,
		_sessionIdResolver: SessionIdResolver,
		cwdResolver: CwdResolver,
	) {
		this._clientCapabilities = clientCapabilities
		this.cwdResolver = cwdResolver
	}

	/**
	 * Get the current working directory, using the resolver if available,
	 * otherwise falling back to process.cwd().
	 */
	private getCwd(): string {
		return this.cwdResolver() ?? process.cwd()
	}

	async getWorkspacePaths(_request: proto.host.GetWorkspacePathsRequest): Promise<proto.host.GetWorkspacePathsResponse> {
		// Return the current working directory from the resolver.
		const cwd = this.getCwd()
		Logger.debug("[ACPWorkspaceServiceClient] getWorkspacePaths called", { cwd })
		return proto.host.GetWorkspacePathsResponse.create({
			paths: [cwd],
		})
	}

	async saveOpenDocumentIfDirty(
		_request: proto.host.SaveOpenDocumentIfDirtyRequest,
	): Promise<proto.host.SaveOpenDocumentIfDirtyResponse> {
		// Next phase: Use ACP extension or fs.writeTextFile to save dirty documents.
		// This would save any unsaved changes in the specified document.
		Logger.debug("[ACPWorkspaceServiceClient] saveOpenDocumentIfDirty called (stub)")
		return proto.host.SaveOpenDocumentIfDirtyResponse.create({})
	}

	async getDiagnostics(_request: proto.host.GetDiagnosticsRequest): Promise<proto.host.GetDiagnosticsResponse> {
		// Next phase: Send ACP extension request for diagnostics (errors, warnings).
		// This would return linting/compilation errors from the ACP client.
		Logger.debug("[ACPWorkspaceServiceClient] getDiagnostics called (stub)")
		return proto.host.GetDiagnosticsResponse.create({ fileDiagnostics: [] })
	}

	async openProblemsPanel(_request: proto.host.OpenProblemsPanelRequest): Promise<proto.host.OpenProblemsPanelResponse> {
		// Next phase: Send ACP extension notification to open the problems panel.
		// This would show the diagnostics/problems view in the editor.
		Logger.debug("[ACPWorkspaceServiceClient] openProblemsPanel called (stub)")
		return proto.host.OpenProblemsPanelResponse.create({})
	}

	async openInFileExplorerPanel(
		request: proto.host.OpenInFileExplorerPanelRequest,
	): Promise<proto.host.OpenInFileExplorerPanelResponse> {
		// Next phase: Send ACP extension notification to reveal file in explorer.
		// This would highlight/reveal the specified path in the file tree.
		Logger.debug("[ACPWorkspaceServiceClient] openInFileExplorerPanel called (stub)", { path: request.path })
		return proto.host.OpenInFileExplorerPanelResponse.create({})
	}

	async openClineSidebarPanel(
		_request: proto.host.OpenClineSidebarPanelRequest,
	): Promise<proto.host.OpenClineSidebarPanelResponse> {
		// Next phase: Send ACP extension notification to open Cline sidebar.
		// This would show the Cline panel/sidebar in the editor.
		Logger.debug("[ACPWorkspaceServiceClient] openClineSidebarPanel called (stub)")
		return proto.host.OpenClineSidebarPanelResponse.create({})
	}

	async openTerminalPanel(_request: proto.host.OpenTerminalRequest): Promise<proto.host.OpenTerminalResponse> {
		// Next phase: Send ACP extension notification or use createTerminal capability.
		// This would open/show the terminal panel in the editor.
		Logger.debug("[ACPWorkspaceServiceClient] openTerminalPanel called (stub)")
		return proto.host.OpenTerminalResponse.create({})
	}

	async executeCommandInTerminal(
		request: proto.host.ExecuteCommandInTerminalRequest,
	): Promise<proto.host.ExecuteCommandInTerminalResponse> {
		// Next phase: Use connection.createTerminal if clientCapabilities.terminal is available.
		// This would execute the specified command in a terminal via the ACP client.
		// The ACP SDK provides createTerminal() which returns a TerminalHandle with
		// methods like currentOutput(), waitForExit(), kill(), and release().
		Logger.debug("[ACPWorkspaceServiceClient] executeCommandInTerminal called (stub)", {
			command: request.command,
			hasTerminalCapability: this._clientCapabilities?.terminal,
		})
		return proto.host.ExecuteCommandInTerminalResponse.create({})
	}

	async openFolder(request: proto.host.OpenFolderRequest): Promise<proto.host.OpenFolderResponse> {
		// Next phase: Send ACP extension request to change workspace/folder.
		// This would open a new folder/workspace in the ACP client.
		Logger.debug("[ACPWorkspaceServiceClient] openFolder called (stub)", { path: request.path })
		return proto.host.OpenFolderResponse.create({ success: true })
	}
}

/**
 * ACP Host Bridge Client Provider
 *
 * Provides the 4 service clients required by HostBridgeClientProvider interface,
 * implemented for the ACP environment. Uses the ACP connection and client capabilities
 * to delegate operations to the ACP client where possible.
 */
export class ACPHostBridgeClientProvider implements HostBridgeClientProvider {
	workspaceClient: WorkspaceServiceClientInterface
	envClient: EnvServiceClientInterface
	windowClient: WindowServiceClientInterface
	diffClient: DiffServiceClientInterface

	/**
	 * Creates a new ACPHostBridgeClientProvider.
	 *
	 * @param connection - The ACP agent-side connection for making requests
	 * @param clientCapabilities - The client's advertised capabilities
	 * @param sessionIdResolver - Function that returns the current session ID
	 * @param cwdResolver - Function that returns the current working directory
	 * @param debug - Whether to enable debug logging
	 * @param version - Version string for getHostVersion (optional)
	 */
	constructor(
		clientCapabilities: acp.ClientCapabilities | undefined,
		sessionIdResolver: SessionIdResolver,
		cwdResolver: CwdResolver,
		version: string = "1.0.0",
	) {
		this.workspaceClient = new ACPWorkspaceServiceClient(clientCapabilities, sessionIdResolver, cwdResolver)
		this.envClient = new ACPEnvServiceClient(clientCapabilities, sessionIdResolver, version)
		this.windowClient = new ACPWindowServiceClient(clientCapabilities, sessionIdResolver)
		this.diffClient = new ACPDiffServiceClient()
	}
}
