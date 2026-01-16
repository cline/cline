/**
 * Standalone Host Bridge Client for CLI
 *
 * This provides in-process implementations of the HostBridgeClientProvider interface
 * instead of making gRPC calls to an external host bridge server.
 *
 * For the TypeScript CLI's embedded controller architecture, everything runs in-process,
 * so we don't need network calls - just direct method implementations.
 */

import type {
	DiffServiceClientInterface,
	EnvServiceClientInterface,
	WindowServiceClientInterface,
	WorkspaceServiceClientInterface,
} from "@/generated/hosts/host-bridge-client-types"
import type { HostBridgeClientProvider, StreamingCallbacks } from "@/hosts/host-provider-types"
import { Setting } from "@/shared/proto/host/env"
import * as proto from "@/shared/proto/index"

// Get the Cline version injected at build time
declare const __CLINE_VERSION__: string

/**
 * In-process EnvService client for CLI
 */
class StandaloneEnvServiceClient implements EnvServiceClientInterface {
	async clipboardWriteText(_request: proto.cline.StringRequest): Promise<proto.cline.Empty> {
		// CLI doesn't support clipboard operations directly
		// Could be extended to use a library like 'clipboardy' if needed
		return proto.cline.Empty.create()
	}

	async clipboardReadText(_request: proto.cline.EmptyRequest): Promise<proto.cline.String> {
		// CLI doesn't support clipboard operations directly
		return proto.cline.String.create({ value: "" })
	}

	async getHostVersion(_request: proto.cline.EmptyRequest): Promise<proto.host.GetHostVersionResponse> {
		return proto.host.GetHostVersionResponse.create({
			platform: process.platform,
			version: process.version, // Node.js version
			clineType: "CLI",
			clineVersion: typeof __CLINE_VERSION__ !== "undefined" ? __CLINE_VERSION__ : "unknown",
		})
	}

	async getIdeRedirectUri(_request: proto.cline.EmptyRequest): Promise<proto.cline.String> {
		// CLI doesn't have an IDE redirect URI
		return proto.cline.String.create({ value: "" })
	}

	async getTelemetrySettings(_request: proto.cline.EmptyRequest): Promise<proto.host.GetTelemetrySettingsResponse> {
		// Telemetry is disabled by default in CLI mode
		return proto.host.GetTelemetrySettingsResponse.create({
			isEnabled: Setting.DISABLED,
		})
	}

	subscribeToTelemetrySettings(
		_request: proto.cline.EmptyRequest,
		_callbacks: StreamingCallbacks<proto.host.TelemetrySettingsEvent>,
	): () => void {
		// No-op subscription - CLI telemetry settings don't change
		return () => {}
	}

	async shutdown(_request: proto.cline.EmptyRequest): Promise<proto.cline.Empty> {
		// No-op - CLI process exits normally
		return proto.cline.Empty.create()
	}
}

/**
 * In-process WorkspaceService client for CLI
 */
class StandaloneWorkspaceServiceClient implements WorkspaceServiceClientInterface {
	async getWorkspacePaths(_request: proto.host.GetWorkspacePathsRequest): Promise<proto.host.GetWorkspacePathsResponse> {
		// Return current working directory as the workspace
		return proto.host.GetWorkspacePathsResponse.create({
			paths: [process.cwd()],
		})
	}

	async saveOpenDocumentIfDirty(
		_request: proto.host.SaveOpenDocumentIfDirtyRequest,
	): Promise<proto.host.SaveOpenDocumentIfDirtyResponse> {
		// No-op - CLI doesn't have open documents in an editor
		return proto.host.SaveOpenDocumentIfDirtyResponse.create()
	}

	async getDiagnostics(_request: proto.host.GetDiagnosticsRequest): Promise<proto.host.GetDiagnosticsResponse> {
		// No-op - CLI doesn't have IDE diagnostics
		return proto.host.GetDiagnosticsResponse.create({
			diagnostics: [],
		})
	}

	async openProblemsPanel(_request: proto.host.OpenProblemsPanelRequest): Promise<proto.host.OpenProblemsPanelResponse> {
		// No-op - CLI doesn't have a problems panel
		return proto.host.OpenProblemsPanelResponse.create()
	}

	async openInFileExplorerPanel(
		_request: proto.host.OpenInFileExplorerPanelRequest,
	): Promise<proto.host.OpenInFileExplorerPanelResponse> {
		// No-op - CLI doesn't have a file explorer panel
		return proto.host.OpenInFileExplorerPanelResponse.create()
	}

	async openClineSidebarPanel(
		_request: proto.host.OpenClineSidebarPanelRequest,
	): Promise<proto.host.OpenClineSidebarPanelResponse> {
		// No-op - CLI doesn't have a sidebar
		return proto.host.OpenClineSidebarPanelResponse.create()
	}

	async openTerminalPanel(_request: proto.host.OpenTerminalRequest): Promise<proto.host.OpenTerminalResponse> {
		// No-op - CLI is already in a terminal
		return proto.host.OpenTerminalResponse.create()
	}

	async executeCommandInTerminal(
		_request: proto.host.ExecuteCommandInTerminalRequest,
	): Promise<proto.host.ExecuteCommandInTerminalResponse> {
		// No-op - terminal execution is handled differently in CLI
		return proto.host.ExecuteCommandInTerminalResponse.create()
	}
}

/**
 * In-process WindowService client for CLI
 */
class StandaloneWindowServiceClient implements WindowServiceClientInterface {
	async showTextDocument(_request: proto.host.ShowTextDocumentRequest): Promise<proto.host.TextEditorInfo> {
		// No-op - CLI doesn't have a text editor UI
		return proto.host.TextEditorInfo.create()
	}

	async showOpenDialogue(_request: proto.host.ShowOpenDialogueRequest): Promise<proto.host.SelectedResources> {
		// No-op - CLI doesn't have file dialogs
		return proto.host.SelectedResources.create({ uris: [] })
	}

	async showMessage(_request: proto.host.ShowMessageRequest): Promise<proto.host.SelectedResponse> {
		// No-op - messages are shown via console output
		return proto.host.SelectedResponse.create()
	}

	async showInputBox(_request: proto.host.ShowInputBoxRequest): Promise<proto.host.ShowInputBoxResponse> {
		// No-op - input is handled via CLI prompts
		return proto.host.ShowInputBoxResponse.create()
	}

	async showSaveDialog(_request: proto.host.ShowSaveDialogRequest): Promise<proto.host.ShowSaveDialogResponse> {
		// No-op - CLI doesn't have save dialogs
		return proto.host.ShowSaveDialogResponse.create()
	}

	async openFile(_request: proto.host.OpenFileRequest): Promise<proto.host.OpenFileResponse> {
		// No-op - CLI doesn't open files in an editor
		return proto.host.OpenFileResponse.create()
	}

	async openSettings(_request: proto.host.OpenSettingsRequest): Promise<proto.host.OpenSettingsResponse> {
		// No-op - CLI doesn't have a settings UI
		return proto.host.OpenSettingsResponse.create()
	}

	async getOpenTabs(_request: proto.host.GetOpenTabsRequest): Promise<proto.host.GetOpenTabsResponse> {
		// No-op - CLI doesn't have tabs
		return proto.host.GetOpenTabsResponse.create({ tabs: [] })
	}

	async getVisibleTabs(_request: proto.host.GetVisibleTabsRequest): Promise<proto.host.GetVisibleTabsResponse> {
		// No-op - CLI doesn't have tabs
		return proto.host.GetVisibleTabsResponse.create({ tabs: [] })
	}

	async getActiveEditor(_request: proto.host.GetActiveEditorRequest): Promise<proto.host.GetActiveEditorResponse> {
		// No-op - CLI doesn't have an active editor
		return proto.host.GetActiveEditorResponse.create()
	}
}

/**
 * In-process DiffService client for CLI
 */
class StandaloneDiffServiceClient implements DiffServiceClientInterface {
	async openDiff(_request: proto.host.OpenDiffRequest): Promise<proto.host.OpenDiffResponse> {
		// No-op - CLI doesn't have visual diffs
		return proto.host.OpenDiffResponse.create()
	}

	async getDocumentText(_request: proto.host.GetDocumentTextRequest): Promise<proto.host.GetDocumentTextResponse> {
		// No-op - document text retrieval is not supported in CLI mode
		return proto.host.GetDocumentTextResponse.create()
	}

	async replaceText(_request: proto.host.ReplaceTextRequest): Promise<proto.host.ReplaceTextResponse> {
		// No-op - text replacement in diffs is not supported in CLI mode
		return proto.host.ReplaceTextResponse.create()
	}

	async scrollDiff(_request: proto.host.ScrollDiffRequest): Promise<proto.host.ScrollDiffResponse> {
		// No-op - CLI doesn't have visual diffs to scroll
		return proto.host.ScrollDiffResponse.create()
	}

	async truncateDocument(_request: proto.host.TruncateDocumentRequest): Promise<proto.host.TruncateDocumentResponse> {
		// No-op - document truncation is not supported in CLI mode
		return proto.host.TruncateDocumentResponse.create()
	}

	async saveDocument(_request: proto.host.SaveDocumentRequest): Promise<proto.host.SaveDocumentResponse> {
		// No-op - document saving is handled differently in CLI mode
		return proto.host.SaveDocumentResponse.create()
	}

	async closeAllDiffs(_request: proto.host.CloseAllDiffsRequest): Promise<proto.host.CloseAllDiffsResponse> {
		// No-op - CLI doesn't have diffs to close
		return proto.host.CloseAllDiffsResponse.create()
	}

	async openMultiFileDiff(_request: proto.host.OpenMultiFileDiffRequest): Promise<proto.host.OpenMultiFileDiffResponse> {
		// No-op - CLI doesn't support multi-file diffs
		return proto.host.OpenMultiFileDiffResponse.create()
	}
}

/**
 * Standalone Host Bridge Client for CLI
 *
 * Provides in-process implementations of all host bridge services
 * instead of making gRPC calls to an external server.
 */
export class StandaloneHostBridgeClient implements HostBridgeClientProvider {
	workspaceClient: WorkspaceServiceClientInterface
	envClient: EnvServiceClientInterface
	windowClient: WindowServiceClientInterface
	diffClient: DiffServiceClientInterface

	constructor() {
		this.workspaceClient = new StandaloneWorkspaceServiceClient()
		this.envClient = new StandaloneEnvServiceClient()
		this.windowClient = new StandaloneWindowServiceClient()
		this.diffClient = new StandaloneDiffServiceClient()
	}
}
