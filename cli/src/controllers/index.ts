/**
 * CLI-specific Host Bridge implementations
 * These provide stub implementations for the host bridge interfaces that work in CLI mode
 */

import type {
	DiffServiceClientInterface,
	EnvServiceClientInterface,
	WindowServiceClientInterface,
	WorkspaceServiceClientInterface,
} from "@generated/hosts/host-bridge-client-types"
import type { HostBridgeClientProvider, StreamingCallbacks } from "@hosts/host-provider-types"
import * as proto from "@shared/proto/index"
import { StateManager } from "@/core/storage/StateManager"
import { ClineClient } from "@/shared/cline"
import { version as CLI_VERSION } from "../../package.json"
import { printError, printInfo, printWarning } from "../utils/display"

/**
 * CLI implementation of DiffService - handles diff operations for terminal
 *
 * In CLI mode, actual file editing is handled by FileEditProvider (which extends DiffViewProvider).
 * This service client handles the host bridge interface for UI-related diff operations.
 * Most operations are no-ops since the CLI doesn't have a visual diff editor.
 */
export class CliDiffServiceClient implements DiffServiceClientInterface {
	async openDiff(_request: proto.host.OpenDiffRequest): Promise<proto.host.OpenDiffResponse> {
		// In CLI mode, diff operations are handled by FileEditProvider directly.
		// This is a no-op since we don't have a visual diff editor.
		return proto.host.OpenDiffResponse.create({})
	}

	async getDocumentText(_request: proto.host.GetDocumentTextRequest): Promise<proto.host.GetDocumentTextResponse> {
		// In CLI mode, document text is managed by FileEditProvider directly.
		// Return empty content since we don't track document state here.
		return proto.host.GetDocumentTextResponse.create({ content: "" })
	}

	async replaceText(_request: proto.host.ReplaceTextRequest): Promise<proto.host.ReplaceTextResponse> {
		// No-op in CLI - actual file editing is handled by FileEditProvider
		return proto.host.ReplaceTextResponse.create({})
	}

	async scrollDiff(_request: proto.host.ScrollDiffRequest): Promise<proto.host.ScrollDiffResponse> {
		// No-op in CLI - no visual editor to scroll
		return proto.host.ScrollDiffResponse.create({})
	}

	async truncateDocument(_request: proto.host.TruncateDocumentRequest): Promise<proto.host.TruncateDocumentResponse> {
		// No-op in CLI - actual file editing is handled by FileEditProvider
		return proto.host.TruncateDocumentResponse.create({})
	}

	async saveDocument(_request: proto.host.SaveDocumentRequest): Promise<proto.host.SaveDocumentResponse> {
		// No-op in CLI - actual file saving is handled by FileEditProvider
		return proto.host.SaveDocumentResponse.create({})
	}

	async closeAllDiffs(_request: proto.host.CloseAllDiffsRequest): Promise<proto.host.CloseAllDiffsResponse> {
		// No-op in CLI - no visual diff views to close
		return proto.host.CloseAllDiffsResponse.create({})
	}

	async openMultiFileDiff(request: proto.host.OpenMultiFileDiffRequest): Promise<proto.host.OpenMultiFileDiffResponse> {
		// In CLI mode, we display a summary of the multi-file diff
		const title = request.title || "Multi-file diff"
		const diffs = request.diffs || []
		if (diffs.length > 0) {
			printInfo(`📝 ${title}: ${diffs.length} file(s) changed`)
			for (const diff of diffs) {
				printInfo(`   - ${diff.filePath}`)
			}
		}
		return proto.host.OpenMultiFileDiffResponse.create({})
	}
}

/**
 * CLI implementation of EnvService - handles environment operations
 */
export class CliEnvServiceClient implements EnvServiceClientInterface {
	private clipboardContent: string = ""

	private getTelemetrySetting(): proto.host.Setting {
		// Read from StateManager - defaults to ENABLED if not set or "unset"
		const setting = StateManager.get().getGlobalSettingsKey("telemetrySetting")
		return setting === "disabled" ? proto.host.Setting.DISABLED : proto.host.Setting.ENABLED
	}

	async clipboardWriteText(request: proto.cline.StringRequest): Promise<proto.cline.Empty> {
		this.clipboardContent = request.value || ""
		printInfo(`📋 Copied to clipboard`)
		return proto.cline.Empty.create()
	}

	async clipboardReadText(_request: proto.cline.EmptyRequest): Promise<proto.cline.String> {
		return proto.cline.String.create({ value: this.clipboardContent })
	}

	async getHostVersion(_request: proto.cline.EmptyRequest): Promise<proto.host.GetHostVersionResponse> {
		return proto.host.GetHostVersionResponse.create({
			version: CLI_VERSION,
			platform: "Cline CLI - Node.js",
			clineType: ClineClient.Cli,
		})
	}

	async getIdeRedirectUri(_request: proto.cline.EmptyRequest): Promise<proto.cline.String> {
		// CLI doesn't have IDE redirect
		return proto.cline.String.create({ value: "" })
	}

	async getTelemetrySettings(_request: proto.cline.EmptyRequest): Promise<proto.host.GetTelemetrySettingsResponse> {
		return proto.host.GetTelemetrySettingsResponse.create({
			isEnabled: this.getTelemetrySetting(),
		})
	}

	subscribeToTelemetrySettings(
		_request: proto.cline.EmptyRequest,
		callbacks: StreamingCallbacks<proto.host.TelemetrySettingsEvent>,
	): () => void {
		// Send initial settings
		callbacks.onResponse(
			proto.host.TelemetrySettingsEvent.create({
				isEnabled: this.getTelemetrySetting(),
			}),
		)
		// Return unsubscribe function
		return () => {}
	}

	debugLog(request: proto.cline.StringRequest): Promise<proto.cline.Empty> {
		const message = request.value || ""
		if (process.env.IS_DEV) {
			printInfo(`[DebugLog] ${message}`)
		}
		return Promise.resolve(proto.cline.Empty.create())
	}

	async shutdown(_request: proto.cline.EmptyRequest): Promise<proto.cline.Empty> {
		printInfo("Shutting down...")
		return proto.cline.Empty.create()
	}
}

/**
 * CLI implementation of WindowService - handles window/UI operations
 */
export class CliWindowServiceClient implements WindowServiceClientInterface {
	async showTextDocument(request: proto.host.ShowTextDocumentRequest): Promise<proto.host.TextEditorInfo> {
		printInfo(`📄 Opening file: ${request.path}`)
		return proto.host.TextEditorInfo.create({
			documentPath: request.path,
		})
	}

	async showOpenDialogue(_request: proto.host.ShowOpenDialogueRequest): Promise<proto.host.SelectedResources> {
		printWarning("Open dialog not available in CLI mode")
		return proto.host.SelectedResources.create({ paths: [] })
	}

	async showMessage(request: proto.host.ShowMessageRequest): Promise<proto.host.SelectedResponse> {
		const message = request.message || ""
		const type = request.type

		switch (type) {
			case proto.host.ShowMessageType.ERROR:
				printError(message)
				break
			case proto.host.ShowMessageType.WARNING:
				printWarning(message)
				break
			case proto.host.ShowMessageType.INFORMATION:
			default:
				printInfo(message)
				break
		}

		return proto.host.SelectedResponse.create({})
	}

	async showInputBox(_request: proto.host.ShowInputBoxRequest): Promise<proto.host.ShowInputBoxResponse> {
		// In CLI mode, we could use readline, but for now return empty
		printWarning("Input box not available in CLI mode")
		return proto.host.ShowInputBoxResponse.create({ response: "" })
	}

	async showSaveDialog(_request: proto.host.ShowSaveDialogRequest): Promise<proto.host.ShowSaveDialogResponse> {
		printWarning("Save dialog not available in CLI mode")
		return proto.host.ShowSaveDialogResponse.create({ selectedPath: "" })
	}

	async openFile(request: proto.host.OpenFileRequest): Promise<proto.host.OpenFileResponse> {
		printInfo(`📂 Opening: ${request.filePath}`)
		return proto.host.OpenFileResponse.create({})
	}

	async openSettings(_request: proto.host.OpenSettingsRequest): Promise<proto.host.OpenSettingsResponse> {
		printInfo("Settings can be configured in ~/.cline/data/globalState.json")
		return proto.host.OpenSettingsResponse.create({})
	}

	async getOpenTabs(_request: proto.host.GetOpenTabsRequest): Promise<proto.host.GetOpenTabsResponse> {
		// CLI doesn't have tabs
		return proto.host.GetOpenTabsResponse.create({ paths: [] })
	}

	async getVisibleTabs(_request: proto.host.GetVisibleTabsRequest): Promise<proto.host.GetVisibleTabsResponse> {
		return proto.host.GetVisibleTabsResponse.create({ paths: [] })
	}

	async getActiveEditor(_request: proto.host.GetActiveEditorRequest): Promise<proto.host.GetActiveEditorResponse> {
		return proto.host.GetActiveEditorResponse.create({})
	}
}

/**
 * CLI implementation of WorkspaceService - handles workspace operations
 */
export class CliWorkspaceServiceClient implements WorkspaceServiceClientInterface {
	private workspacePath: string

	constructor(workspacePath: string = process.cwd()) {
		this.workspacePath = workspacePath
	}

	setWorkspacePath(path: string) {
		this.workspacePath = path
	}

	async getWorkspacePaths(_request: proto.host.GetWorkspacePathsRequest): Promise<proto.host.GetWorkspacePathsResponse> {
		return proto.host.GetWorkspacePathsResponse.create({
			paths: [this.workspacePath],
		})
	}

	async saveOpenDocumentIfDirty(
		_request: proto.host.SaveOpenDocumentIfDirtyRequest,
	): Promise<proto.host.SaveOpenDocumentIfDirtyResponse> {
		return proto.host.SaveOpenDocumentIfDirtyResponse.create({})
	}

	async getDiagnostics(_request: proto.host.GetDiagnosticsRequest): Promise<proto.host.GetDiagnosticsResponse> {
		// In CLI mode, we could run linters here
		return proto.host.GetDiagnosticsResponse.create({ fileDiagnostics: [] })
	}

	async openProblemsPanel(_request: proto.host.OpenProblemsPanelRequest): Promise<proto.host.OpenProblemsPanelResponse> {
		printInfo("Run linters to see problems")
		return proto.host.OpenProblemsPanelResponse.create({})
	}

	async openInFileExplorerPanel(
		request: proto.host.OpenInFileExplorerPanelRequest,
	): Promise<proto.host.OpenInFileExplorerPanelResponse> {
		printInfo(`📁 ${request.path}`)
		return proto.host.OpenInFileExplorerPanelResponse.create({})
	}

	async openClineSidebarPanel(
		_request: proto.host.OpenClineSidebarPanelRequest,
	): Promise<proto.host.OpenClineSidebarPanelResponse> {
		// No sidebar in CLI
		return proto.host.OpenClineSidebarPanelResponse.create({})
	}

	async openTerminalPanel(_request: proto.host.OpenTerminalRequest): Promise<proto.host.OpenTerminalResponse> {
		printInfo("Terminal is already available in CLI mode")
		return proto.host.OpenTerminalResponse.create({})
	}

	async executeCommandInTerminal(
		request: proto.host.ExecuteCommandInTerminalRequest,
	): Promise<proto.host.ExecuteCommandInTerminalResponse> {
		printInfo(`⚙️  Executing: ${request.command}`)
		return proto.host.ExecuteCommandInTerminalResponse.create({})
	}

	async openFolder(request: proto.host.OpenFolderRequest): Promise<proto.host.OpenFolderResponse> {
		const path = request.path || ""
		this.workspacePath = path
		printInfo(`📂 Opening folder: ${path}`)
		return proto.host.OpenFolderResponse.create({ success: true })
	}
}

/**
 * Create a CLI host bridge provider
 */
export function createCliHostBridgeProvider(workspacePath?: string): HostBridgeClientProvider {
	return {
		workspaceClient: new CliWorkspaceServiceClient(workspacePath),
		envClient: new CliEnvServiceClient(),
		windowClient: new CliWindowServiceClient(),
		diffClient: new CliDiffServiceClient(),
	}
}
