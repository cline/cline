import {
	HostBridgeProvider,
	WorkspaceService,
	WindowService,
	TerminalService,
	CommandService,
	EnvService,
	WatchService,
	StreamingResponseHandler,
} from "./host-bridge-provider"
import * as proto from "@shared/proto/index"
import * as path from "path"
import * as os from "os"

class ElectronWorkspaceService implements WorkspaceService {
	async getWorkspacePaths(request: proto.host.GetWorkspacePathsRequest): Promise<proto.host.GetWorkspacePathsResponse> {
		// For standalone mode, use a subdirectory within Documents as default workspace
		// This ensures the checkpoint tracker has access to a proper working directory
		// while respecting the Documents directory protection
		const documentsPath = path.join(os.homedir(), "Documents")
		const defaultWorkspace = path.join(documentsPath, "cline-workspace")
		const workspacePath = process.env.WORKSPACE_DIR || defaultWorkspace

		// console.log('🗂️  WorkspaceService.getWorkspacePaths returning:', workspacePath); // Disabled to reduce console noise

		return {
			paths: [workspacePath],
		}
	}

	async searchFiles(request: proto.host.SearchFilesRequest): Promise<proto.host.SearchFilesResponse> {
		try {
			const query = request.query || ""
			if (!query.trim()) {
				return { results: [] }
			}

			// Get workspace paths
			const workspacePaths = await this.getWorkspacePaths({})
			if (!workspacePaths.paths || workspacePaths.paths.length === 0) {
				return { results: [] }
			}

			const fs = require("fs")
			const workspacePath = workspacePaths.paths[0]

			// Check if workspace directory exists, if not create it
			if (!fs.existsSync(workspacePath)) {
				fs.mkdirSync(workspacePath, { recursive: true })
				return { results: [] }
			}

			// Recursive file search function
			const searchFiles = (dir: string, query: string, basePath: string = "", maxResults: number = 20): any[] => {
				const results: any[] = []
				const lowerQuery = query.toLowerCase()

				try {
					const entries = fs.readdirSync(dir, { withFileTypes: true })

					for (const entry of entries) {
						if (results.length >= maxResults) {
							break
						}

						// Skip hidden files and common directories to ignore
						if (
							entry.name.startsWith(".") ||
							entry.name === "node_modules" ||
							entry.name === "dist" ||
							entry.name === "build"
						) {
							continue
						}

						const entryPath = path.join(basePath, entry.name)
						const fullPath = path.join(dir, entry.name)

						// Check if name matches query
						if (entry.name.toLowerCase().includes(lowerQuery)) {
							results.push({
								path: entryPath.replace(/\\/g, "/"), // Normalize path separators
								type: entry.isDirectory() ? 2 : 1, // WORKSPACE_FILE_TYPE_FOLDER = 2, WORKSPACE_FILE_TYPE_FILE = 1
								label: entry.name,
							})
						}

						// Recursively search directories (limit depth)
						if (entry.isDirectory() && basePath.split("/").length < 5) {
							const subResults = searchFiles(fullPath, query, entryPath, maxResults - results.length)
							results.push(...subResults)
						}
					}
				} catch (error) {}

				return results
			}

			const results = searchFiles(workspacePath, query)

			return { results }
		} catch (error) {
			return { results: [] }
		}
	}

	async openTextDocument(request: proto.host.OpenTextDocumentRequest): Promise<proto.host.OpenTextDocumentResponse> {
		// TODO: Implement Electron-specific logic
		return { path: request.path || "/untitled", languageId: request.language || "plaintext", isUntitled: !request.path }
	}
}

class ElectronWindowService implements WindowService {
	async showTextDocument(request: proto.host.ShowTextDocumentRequest): Promise<proto.host.TextEditorInfo> {
		// TODO: Implement Electron-specific logic
		return { documentPath: "", isActive: false }
	}

	async showOpenDialogue(request: proto.host.ShowOpenDialogueRequest): Promise<proto.host.SelectedResources> {
		// TODO: Implement Electron-specific logic
		return { paths: [] }
	}

	async getActiveTextEditor(request: proto.host.GetActiveTextEditorRequest): Promise<proto.host.ActiveTextEditorInfo> {
		// TODO: Implement Electron-specific logic
		return { documentPath: "", isActive: false }
	}

	async getVisibleTextEditors(request: proto.host.GetVisibleTextEditorsRequest): Promise<proto.host.VisibleTextEditorsInfo> {
		// TODO: Implement Electron-specific logic
		return { editors: [] }
	}

	async showErrorMessage(request: proto.host.ShowErrorMessageRequest): Promise<proto.host.ShowMessageResponse> {
		// TODO: Implement Electron-specific logic
		return { selectedItem: undefined }
	}

	async showInformationMessage(request: proto.host.ShowInformationMessageRequest): Promise<proto.host.ShowMessageResponse> {
		// TODO: Implement Electron-specific logic
		return { selectedItem: undefined }
	}

	async showWarningMessage(request: proto.host.ShowWarningMessageRequest): Promise<proto.host.ShowMessageResponse> {
		try {
			// Import dialog dynamically to avoid issues in non-main processes
			const { dialog, BrowserWindow } = require("electron")

			// Get the main window
			const windows = BrowserWindow.getAllWindows()
			const mainWindow = windows.find((w: any) => !w.isDestroyed()) || windows[0]

			if (!mainWindow) {
				console.error("No main window available for dialog")
				return { selectedItem: undefined }
			}

			// Parse the request
			const message = request.message || ""
			const items = request.items || []

			// Convert to Electron dialog options
			const dialogOptions = {
				type: "warning" as const,
				message: message,
				buttons: items.length > 0 ? ["Cancel", ...items] : ["Cancel"],
				defaultId: items.length > 0 ? 1 : 0, // Default to first action button
				cancelId: 0, // Cancel button is always at index 0,
			}

			const result = await dialog.showMessageBox(mainWindow, dialogOptions)

			// Handle special case for "Open Settings" from telemetry dialog
			if (result.response > 0 && items.length > 0) {
				const selectedItem = items[result.response - 1]

				// If "Open Settings" was clicked, send navigation message to webview
				if (selectedItem === "Open Settings") {
					// Send message to webview to navigate to general settings (where telemetry setting is)
					// In standalone mode, we use the VSCode API message format
					mainWindow.webContents.executeJavaScript(`
                        if (window.acquireVsCodeApi) {
                            const vscode = window.acquireVsCodeApi();
                            vscode.postMessage({
                                type: 'grpc_response',
                                grpc_response: {
                                    request_id: 'navigate-settings-${Date.now()}',
                                    message: {
                                        action: 'scrollToSettings',
                                        value: 'general'
                                    },
                                    is_streaming: false,
                                    error: null
                                }
                            });
                        }
                    `)
				}

				return { selectedItem }
			}

			// Return the selected item or undefined for cancel
			if (result.response === 0) {
				// Cancel was clicked
				return { selectedItem: undefined }
			}

			return { selectedItem: undefined }
		} catch (error) {
			console.error("Failed to show warning dialog:", error)
			return { selectedItem: undefined }
		}
	}

	async showInputBox(request: proto.host.ShowInputBoxRequest): Promise<proto.host.ShowInputBoxResponse> {
		// TODO: Implement Electron-specific logic
		return { value: undefined }
	}

	async showSaveDialog(request: proto.host.ShowSaveDialogRequest): Promise<proto.host.ShowSaveDialogResponse> {
		// TODO: Implement Electron-specific logic
		return { path: undefined }
	}
}

class ElectronTerminalService implements TerminalService {
	async createTerminal(request: proto.host.CreateTerminalRequest): Promise<proto.host.TerminalInfo> {
		// TODO: Implement Electron-specific logic
		return { id: "1", name: "Terminal", isActive: true }
	}

	async getActiveTerminal(request: proto.cline.EmptyRequest): Promise<proto.host.TerminalInfo> {
		// TODO: Implement Electron-specific logic
		return { id: "1", name: "Terminal", isActive: true }
	}

	async getAllTerminals(request: proto.cline.EmptyRequest): Promise<proto.host.TerminalInfoList> {
		// TODO: Implement Electron-specific logic
		return { terminals: [{ id: "1", name: "Terminal", isActive: true }] }
	}
}

class ElectronCommandService implements CommandService {
	async executeCommand(request: proto.host.ExecuteCommandRequest): Promise<proto.cline.Empty> {
		// TODO: Implement Electron-specific logic
		return {}
	}

	async setContext(request: proto.host.SetContextRequest): Promise<proto.cline.Empty> {
		// TODO: Implement Electron-specific logic
		return {}
	}

	async focusSidebar(request: proto.host.FocusSidebarRequest): Promise<proto.cline.Empty> {
		// TODO: Implement Electron-specific logic
		return {}
	}

	async newGroupRight(request: proto.host.NewGroupRightRequest): Promise<proto.cline.Empty> {
		// TODO: Implement Electron-specific logic
		return {}
	}

	async lockEditorGroup(request: proto.host.LockEditorGroupRequest): Promise<proto.cline.Empty> {
		// TODO: Implement Electron-specific logic
		return {}
	}

	async openWalkthrough(request: proto.host.OpenWalkthroughRequest): Promise<proto.cline.Empty> {
		// TODO: Implement Electron-specific logic
		return {}
	}

	async reloadWindow(request: proto.host.ReloadWindowRequest): Promise<proto.cline.Empty> {
		// TODO: Implement Electron-specific logic
		return {}
	}
}

class ElectronEnvService implements EnvService {
	async clipboardWriteText(request: proto.cline.StringRequest): Promise<proto.cline.Empty> {
		// TODO: Implement Electron-specific logic
		return {}
	}

	async clipboardReadText(request: proto.cline.EmptyRequest): Promise<proto.cline.String> {
		// TODO: Implement Electron-specific logic
		return { value: "" }
	}
}

class ElectronWatchService implements WatchService {
	async subscribeToFile(
		request: proto.host.SubscribeToFileRequest,
		responseStream: StreamingResponseHandler,
		requestId?: string,
	): Promise<void> {
		// TODO: Implement Electron-specific logic
	}
}

export class ElectronHostBridgeProvider implements HostBridgeProvider {
	workspaceService = new ElectronWorkspaceService()
	windowService = new ElectronWindowService()
	terminalService = new ElectronTerminalService()
	commandService = new ElectronCommandService()
	envService = new ElectronEnvService()
	watchService = new ElectronWatchService()
}
