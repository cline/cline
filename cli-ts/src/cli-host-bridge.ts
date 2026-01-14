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
import { printError, printInfo, printWarning } from "./display"

/**
 * CLI implementation of DiffService - handles diff operations for terminal
 */
export class CliDiffServiceClient implements DiffServiceClientInterface {
	async openDiff(request: proto.host.OpenDiffRequest): Promise<proto.host.OpenDiffResponse> {
		printInfo(`📝 Opening diff for: ${request.leftUri || request.rightUri}`)
		return proto.host.OpenDiffResponse.create({})
	}

	async getDocumentText(request: proto.host.GetDocumentTextRequest): Promise<proto.host.GetDocumentTextResponse> {
		// In CLI mode, we'd read from the file system directly
		return proto.host.GetDocumentTextResponse.create({ text: "" })
	}

	async replaceText(request: proto.host.ReplaceTextRequest): Promise<proto.host.ReplaceTextResponse> {
		printInfo(`✏️  Replacing text in document`)
		return proto.host.ReplaceTextResponse.create({})
	}

	async scrollDiff(request: proto.host.ScrollDiffRequest): Promise<proto.host.ScrollDiffResponse> {
		// No-op in CLI
		return proto.host.ScrollDiffResponse.create({})
	}

	async truncateDocument(request: proto.host.TruncateDocumentRequest): Promise<proto.host.TruncateDocumentResponse> {
		return proto.host.TruncateDocumentResponse.create({})
	}

	async saveDocument(request: proto.host.SaveDocumentRequest): Promise<proto.host.SaveDocumentResponse> {
		printInfo(`💾 Saving document`)
		return proto.host.SaveDocumentResponse.create({})
	}

	async closeAllDiffs(request: proto.host.CloseAllDiffsRequest): Promise<proto.host.CloseAllDiffsResponse> {
		return proto.host.CloseAllDiffsResponse.create({})
	}

	async openMultiFileDiff(request: proto.host.OpenMultiFileDiffRequest): Promise<proto.host.OpenMultiFileDiffResponse> {
		printInfo(`📝 Opening multi-file diff`)
		return proto.host.OpenMultiFileDiffResponse.create({})
	}
}

/**
 * CLI implementation of EnvService - handles environment operations
 */
export class CliEnvServiceClient implements EnvServiceClientInterface {
	private clipboardContent: string = ""

	async clipboardWriteText(request: proto.cline.StringRequest): Promise<proto.cline.Empty> {
		this.clipboardContent = request.value || ""
		printInfo(`📋 Copied to clipboard`)
		return proto.cline.Empty.create()
	}

	async clipboardReadText(request: proto.cline.EmptyRequest): Promise<proto.cline.String> {
		return proto.cline.String.create({ value: this.clipboardContent })
	}

	async getHostVersion(request: proto.cline.EmptyRequest): Promise<proto.host.GetHostVersionResponse> {
		return proto.host.GetHostVersionResponse.create({
			version: "1.0.0",
			platform: "Cline CLI",
		})
	}

	async getIdeRedirectUri(request: proto.cline.EmptyRequest): Promise<proto.cline.String> {
		// CLI doesn't have IDE redirect
		return proto.cline.String.create({ value: "" })
	}

	async getTelemetrySettings(request: proto.cline.EmptyRequest): Promise<proto.host.GetTelemetrySettingsResponse> {
		return proto.host.GetTelemetrySettingsResponse.create({
			isTelemetryEnabled: false,
			isCrashReporterEnabled: false,
		})
	}

	subscribeToTelemetrySettings(
		request: proto.cline.EmptyRequest,
		callbacks: StreamingCallbacks<proto.host.TelemetrySettingsEvent>,
	): () => void {
		// Send initial settings
		callbacks.onResponse(
			proto.host.TelemetrySettingsEvent.create({
				isTelemetryEnabled: false,
				isCrashReporterEnabled: false,
			}),
		)
		// Return unsubscribe function
		return () => {}
	}

	async shutdown(request: proto.cline.EmptyRequest): Promise<proto.cline.Empty> {
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
			path: request.path,
		})
	}

	async showOpenDialogue(request: proto.host.ShowOpenDialogueRequest): Promise<proto.host.SelectedResources> {
		printWarning("Open dialog not available in CLI mode")
		return proto.host.SelectedResources.create({ uris: [] })
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

	async showInputBox(request: proto.host.ShowInputBoxRequest): Promise<proto.host.ShowInputBoxResponse> {
		// In CLI mode, we could use readline, but for now return empty
		printWarning("Input box not available in CLI mode")
		return proto.host.ShowInputBoxResponse.create({ value: "" })
	}

	async showSaveDialog(request: proto.host.ShowSaveDialogRequest): Promise<proto.host.ShowSaveDialogResponse> {
		printWarning("Save dialog not available in CLI mode")
		return proto.host.ShowSaveDialogResponse.create({ uri: "" })
	}

	async openFile(request: proto.host.OpenFileRequest): Promise<proto.host.OpenFileResponse> {
		printInfo(`📂 Opening: ${request.path}`)
		return proto.host.OpenFileResponse.create({})
	}

	async openSettings(request: proto.host.OpenSettingsRequest): Promise<proto.host.OpenSettingsResponse> {
		printInfo("Settings can be configured in ~/.cline/data/globalState.json")
		return proto.host.OpenSettingsResponse.create({})
	}

	async getOpenTabs(request: proto.host.GetOpenTabsRequest): Promise<proto.host.GetOpenTabsResponse> {
		// CLI doesn't have tabs
		return proto.host.GetOpenTabsResponse.create({ tabs: [] })
	}

	async getVisibleTabs(request: proto.host.GetVisibleTabsRequest): Promise<proto.host.GetVisibleTabsResponse> {
		return proto.host.GetVisibleTabsResponse.create({ tabs: [] })
	}

	async getActiveEditor(request: proto.host.GetActiveEditorRequest): Promise<proto.host.GetActiveEditorResponse> {
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

	async getWorkspacePaths(request: proto.host.GetWorkspacePathsRequest): Promise<proto.host.GetWorkspacePathsResponse> {
		return proto.host.GetWorkspacePathsResponse.create({
			paths: [this.workspacePath],
		})
	}

	async saveOpenDocumentIfDirty(
		request: proto.host.SaveOpenDocumentIfDirtyRequest,
	): Promise<proto.host.SaveOpenDocumentIfDirtyResponse> {
		return proto.host.SaveOpenDocumentIfDirtyResponse.create({})
	}

	async getDiagnostics(request: proto.host.GetDiagnosticsRequest): Promise<proto.host.GetDiagnosticsResponse> {
		// In CLI mode, we could run linters here
		return proto.host.GetDiagnosticsResponse.create({ diagnostics: [] })
	}

	async openProblemsPanel(request: proto.host.OpenProblemsPanelRequest): Promise<proto.host.OpenProblemsPanelResponse> {
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
		request: proto.host.OpenClineSidebarPanelRequest,
	): Promise<proto.host.OpenClineSidebarPanelResponse> {
		// No sidebar in CLI
		return proto.host.OpenClineSidebarPanelResponse.create({})
	}

	async openTerminalPanel(request: proto.host.OpenTerminalRequest): Promise<proto.host.OpenTerminalResponse> {
		printInfo("Terminal is already available in CLI mode")
		return proto.host.OpenTerminalResponse.create({})
	}

	async executeCommandInTerminal(
		request: proto.host.ExecuteCommandInTerminalRequest,
	): Promise<proto.host.ExecuteCommandInTerminalResponse> {
		printInfo(`⚙️  Executing: ${request.command}`)
		return proto.host.ExecuteCommandInTerminalResponse.create({})
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
