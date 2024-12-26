import * as vscode from "vscode"
import * as path from "path"
import { listFiles } from "../../services/glob/list-files"
import { ClineProvider } from "../../core/webview/ClineProvider"

const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0)

// Note: this is not a drop-in replacement for listFiles at the start of tasks, since that will be done for Desktops when there is no workspace selected
class WorkspaceTracker {
	private providerRef: WeakRef<ClineProvider>
	private disposables: vscode.Disposable[] = []
	private filePaths: Set<string> = new Set()

	constructor(provider: ClineProvider) {
		this.providerRef = new WeakRef(provider)
		this.registerListeners()
	}

	async initializeFilePaths() {
		// should not auto get filepaths for desktop since it would immediately show permission popup before cline ever creates a file
		if (!cwd) {
			return
		}
		const [files, _] = await listFiles(cwd, true, 1_000)
		files.forEach((file) => this.filePaths.add(this.normalizeFilePath(file)))
		this.workspaceDidUpdate()
	}

	private registerListeners() {
		const watcher = vscode.workspace.createFileSystemWatcher("**")

		this.disposables.push(
			watcher.onDidCreate(async (uri) => {
				await this.addFilePath(uri.fsPath)
				this.workspaceDidUpdate()
			})
		)

		// Renaming files triggers a delete and create event
		this.disposables.push(
			watcher.onDidDelete(async (uri) => {
				if (await this.removeFilePath(uri.fsPath)) {
					this.workspaceDidUpdate()
				}
			})
		)

		this.disposables.push(watcher)
	}

	private workspaceDidUpdate() {
		if (!cwd) {
			return
		}
		this.providerRef.deref()?.postMessageToWebview({
			type: "workspaceUpdated",
			filePaths: Array.from(this.filePaths).map((file) => {
				const relativePath = path.relative(cwd, file).toPosix()
				return file.endsWith("/") ? relativePath + "/" : relativePath
			})
		})
	}

	private normalizeFilePath(filePath: string): string {
		const resolvedPath = cwd ? path.resolve(cwd, filePath) : path.resolve(filePath)
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
		this.disposables.forEach((d) => d.dispose())
	}
}

export default WorkspaceTracker
