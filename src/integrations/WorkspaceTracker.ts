import * as vscode from "vscode"
import * as path from "path"
import { listFiles } from "../parse-source-code/index"
import { ClaudeDevProvider } from "../providers/ClaudeDevProvider"

const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0)

// Note: this is not a drop-in replacement for listFiles at the start of tasks, since that will be done for Desktops when there is no workspace selected
class WorkspaceTracker {
	private providerRef: WeakRef<ClaudeDevProvider>
	private disposables: vscode.Disposable[] = []
	private filePaths: Set<string> = new Set()

	constructor(provider: ClaudeDevProvider) {
		console.log("WorkspaceTracker: Initializing")
		this.providerRef = new WeakRef(provider)
		this.registerListeners()
	}

	async initializeFilePaths() {
		console.log("WorkspaceTracker: Initializing file paths")
		// should not auto get filepaths for desktop since it would immediately show permission popup before claude every creates a file

		if (!cwd) {
			console.log("WorkspaceTracker: No workspace folder found")
			return
		}
		const [files, _] = await listFiles(cwd, true, 500)
		console.log(`WorkspaceTracker: Found ${files.length} files`)
		files.forEach((file) => this.filePaths.add(this.normalizeFilePath(file)))
		console.log(this.filePaths)
		this.workspaceDidUpdate()
	}

	private registerListeners() {
		console.log("WorkspaceTracker: Registering listeners")
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

	private async onFilesCreated(event: vscode.FileCreateEvent) {
		console.log(`WorkspaceTracker: Files created - ${event.files.length} file(s)`)
		await Promise.all(
			event.files.map(async (file) => {
				await this.addFilePath(file.fsPath)
			})
		)
		this.workspaceDidUpdate()
	}

	private async onFilesDeleted(event: vscode.FileDeleteEvent) {
		console.log(`WorkspaceTracker: Files deleted - ${event.files.length} file(s)`)
		let updated = false
		await Promise.all(
			event.files.map(async (file) => {
				if (await this.removeFilePath(file.fsPath)) {
					updated = true
				}
			})
		)
		if (updated) {
			this.workspaceDidUpdate()
		}
	}

	private async onFilesRenamed(event: vscode.FileRenameEvent) {
		console.log(`WorkspaceTracker: Files renamed - ${event.files.length} file(s)`)
		await Promise.all(
			event.files.map(async (file) => {
				await this.removeFilePath(file.oldUri.fsPath)
				await this.addFilePath(file.newUri.fsPath)
			})
		)
		this.workspaceDidUpdate()
	}

	private async onFileChanged(event: vscode.TextDocumentChangeEvent) {
		const filePath = await this.addFilePath(event.document.uri.fsPath)
		if (!this.filePaths.has(filePath)) {
			console.log(`WorkspaceTracker: New file changed - ${filePath}`)
			this.filePaths.add(filePath)
			this.workspaceDidUpdate()
		}
	}

	private async onWorkspaceFoldersChanged(event: vscode.WorkspaceFoldersChangeEvent) {
		console.log(
			`WorkspaceTracker: Workspace folders changed - Added: ${event.added.length}, Removed: ${event.removed.length}`
		)
		for (const folder of event.added) {
			const [files, _] = await listFiles(folder.uri.fsPath, true, 50) // at most 50 files
			console.log(`WorkspaceTracker: Adding ${files.length} files from new folder`)
			await Promise.all(files.map((file) => this.addFilePath(file)))
		}
		for (const folder of event.removed) {
			const folderPath = await this.addFilePath(folder.uri.fsPath)
			console.log(`WorkspaceTracker: Removing files from deleted folder - ${folderPath}`)
			this.filePaths.forEach((filePath) => {
				if (filePath.startsWith(folderPath)) {
					this.filePaths.delete(filePath)
				}
			})
		}
		this.workspaceDidUpdate()
	}

	private workspaceDidUpdate() {
		console.log(`WorkspaceTracker: Workspace updated. Current file count: ${this.filePaths.size}`)
		if (!cwd) {
			return
		}
		this.providerRef.deref()?.postMessageToWebview({
			type: "workspaceUpdated",
			filePaths: Array.from(this.filePaths).map((file) => {
				const relativePath = path.relative(cwd, file)
				return file.endsWith("/") ? relativePath + "/" : relativePath
			}),
		})
	}

	private normalizeFilePath(filePath: string): string {
		const resolvedPath = path.resolve(filePath)
		return filePath.endsWith("/") ? resolvedPath + "/" : resolvedPath
	}

	private async addFilePath(filePath: string): Promise<string> {
		const normalizedPath = this.normalizeFilePath(filePath)
		try {
			const stat = await vscode.workspace.fs.stat(vscode.Uri.file(normalizedPath))
			const isDirectory = (stat.type & vscode.FileType.Directory) !== 0
			const pathWithSlash = isDirectory && !normalizedPath.endsWith("/") ? normalizedPath + "/" : normalizedPath
			this.filePaths.add(pathWithSlash)
			return pathWithSlash
		} catch {
			// If stat fails, assume it's a file (this can happen for newly created files)
			this.filePaths.add(normalizedPath)
			return normalizedPath
		}
	}

	private async removeFilePath(filePath: string): Promise<boolean> {
		const normalizedPath = this.normalizeFilePath(filePath)
		return this.filePaths.delete(normalizedPath) || this.filePaths.delete(normalizedPath + "/")
	}

	public dispose() {
		console.log("WorkspaceTracker: Disposing")
		this.disposables.forEach((d) => d.dispose())
	}
}

export default WorkspaceTracker
