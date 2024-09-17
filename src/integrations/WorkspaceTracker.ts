import * as vscode from "vscode"
import * as path from "path"
import { listFiles } from "../parse-source-code/index"
import { ClaudeDevProvider } from "../providers/ClaudeDevProvider"

const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0)

class WorkspaceTracker {
	private providerRef: WeakRef<ClaudeDevProvider>
	private disposables: vscode.Disposable[] = []
	private filePaths: Set<string> = new Set()

	constructor(provider: ClaudeDevProvider) {
		this.providerRef = new WeakRef(provider)
		this.registerListeners()
	}

	async initializeFilePaths() {
		// should not auto get filepaths for desktop since it would immediately show permission popup before claude every creates a file

		if (!cwd) {
			return
		}
		const [files, _] = await listFiles(cwd, true, 500)
		files
			.map((file) => {
				const relativePath = path.relative(cwd, file)
				return file.endsWith("/") ? relativePath + "/" : relativePath
			})
			.forEach((file) => this.filePaths.add(file))
		this.workspaceDidUpdate()
	}

	private registerListeners() {
		// Listen for file creation
		this.disposables.push(vscode.workspace.onDidCreateFiles(this.onFilesCreated.bind(this)))

		// Listen for file deletion
		this.disposables.push(vscode.workspace.onDidDeleteFiles(this.onFilesDeleted.bind(this)))

		// Listen for file renaming
		this.disposables.push(vscode.workspace.onDidRenameFiles(this.onFilesRenamed.bind(this)))

		// Listen for file changes
		this.disposables.push(vscode.workspace.onDidChangeTextDocument(this.onFileChanged.bind(this)))

		// Listen for workspace folder changes
		this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(this.onWorkspaceFoldersChanged.bind(this)))
	}

	private onFilesCreated(event: vscode.FileCreateEvent) {
		event.files.forEach(async (file) => {
			this.filePaths.add(file.fsPath)
			this.workspaceDidUpdate()
		})
	}

	private onFilesDeleted(event: vscode.FileDeleteEvent) {
		event.files.forEach((file) => {
			if (this.filePaths.delete(file.fsPath)) {
				this.workspaceDidUpdate()
			}
		})
	}

	private onFilesRenamed(event: vscode.FileRenameEvent) {
		event.files.forEach(async (file) => {
			this.filePaths.delete(file.oldUri.fsPath)
			this.filePaths.add(file.newUri.fsPath)
			this.workspaceDidUpdate()
		})
	}

	private async onFileChanged(event: vscode.TextDocumentChangeEvent) {
		const filePath = event.document.uri.fsPath
		if (!this.filePaths.has(filePath)) {
			this.filePaths.add(filePath)
			this.workspaceDidUpdate()
		}
	}

	private async onWorkspaceFoldersChanged(event: vscode.WorkspaceFoldersChangeEvent) {
		for (const folder of event.added) {
			const [files, _] = await listFiles(folder.uri.fsPath, true, 50) // at most 50 files
			if (!cwd) {
				continue
			}
			files
				.map((file) => {
					const relativePath = path.relative(cwd, file)
					return file.endsWith("/") ? relativePath + "/" : relativePath
				})
				.forEach((file) => this.filePaths.add(file))
		}
		for (const folder of event.removed) {
			this.filePaths.forEach((filePath) => {
				if (filePath.startsWith(folder.uri.fsPath)) {
					this.filePaths.delete(filePath)
				}
			})
		}
		this.workspaceDidUpdate()
	}

	private workspaceDidUpdate() {
		console.log("Workspace updated. Current file paths:", Array.from(this.filePaths))
		// Add your logic here for when the workspace is updated
		this.providerRef.deref()?.postMessageToWebview({
			type: "workspaceUpdated",
			filePaths: Array.from(this.filePaths),
		})
	}

	public getFilePaths(): string[] {
		return Array.from(this.filePaths)
	}

	public dispose() {
		this.disposables.forEach((d) => d.dispose())
	}
}

export default WorkspaceTracker
