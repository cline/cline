import * as vscode from "vscode"
import { IClineProvider } from "../../core/webview/IClineProvider"
import { ExtensionMessage } from "../../shared/ExtensionMessage"

export default class WorkspaceTracker {
	private disposables: vscode.Disposable[] = []
	private fileWatcher?: vscode.FileSystemWatcher

	constructor(private provider: IClineProvider) {
		this.setupFileWatcher()
	}

	dispose() {
		if (this.fileWatcher) {
			this.fileWatcher.dispose()
		}
		while (this.disposables.length) {
			const x = this.disposables.pop()
			if (x) {
				x.dispose()
			}
		}
	}

	private setupFileWatcher() {
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (workspaceFolders) {
			this.fileWatcher = vscode.workspace.createFileSystemWatcher("**/*")
			this.fileWatcher.onDidChange(() => this.populateFilePaths())
			this.fileWatcher.onDidCreate(() => this.populateFilePaths())
			this.fileWatcher.onDidDelete(() => this.populateFilePaths())
			this.disposables.push(this.fileWatcher)
		}
	}

	async populateFilePaths() {
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (workspaceFolders) {
			const message: ExtensionMessage = {
				type: "workspaceUpdated",
				workspace: vscode.workspace.name || "",
				workspaceFolders: workspaceFolders.map((folder) => folder.uri.fsPath),
			}
			await this.provider.postMessageToWebview(message)
		}
	}
}
