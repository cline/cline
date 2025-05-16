import * as vscode from "vscode"
import * as path from "path"
import { listFiles, shouldTrackFile } from "@services/glob/list-files"
import { ExtensionMessage } from "@shared/ExtensionMessage"

// Note: this is not a drop-in replacement for listFiles at the start of tasks, since that will be done for Desktops when there is no workspace selected
class WorkspaceTracker {
	private disposables: vscode.Disposable[] = []
	private filePaths: Set<string> = new Set()

	private readonly workspaceFolder = vscode.workspace.workspaceFolders?.[0]
	private readonly cwd = this.workspaceFolder?.uri.fsPath

	constructor(private readonly postMessageToWebview: (message: ExtensionMessage) => Promise<void>) {
		this.postMessageToWebview = postMessageToWebview
		this.registerListeners()
	}

	async populateFilePaths() {
		// should not auto get filepaths for desktop since it would immediately show permission popup before cline ever creates a file
		if (!this.cwd) {
			return
		}
		const [files, _] = await listFiles(this.cwd, true, 1_000)
		files.forEach((file) => this.filePaths.add(this.normalizeFilePath(file)))
		this.workspaceDidUpdate()
	}

	private registerListeners() {
		if (!this.workspaceFolder) {
			return
		}

		/*
		  Watch for new and deleted files within the workspace. 
 		  We are not concerned about the contents of the files here, 
 		  but about files that should be listed to the user.
		  
		  We use a globstar because the vscode glob pattern is somewhat particular:
		  https://code.visualstudio.com/api/references/vscode-api#GlobPattern
		  And they don't support ignore patterns yet:
		  https://github.com/microsoft/vscode/issues/169724#issuecomment-2530442986
		*/
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(this.workspaceFolder, "**"),
			// Do not ignore create events
			false,
			// Ignore update events
			true,
			// Do not ignore delete events
			false,
		)

		this.disposables.push(
			watcher,
			// .bind(this) ensures the callback refers to class instance when using this, not necessary when using arrow function
			watcher.onDidCreate(this.onFileCreated.bind(this)),
			watcher.onDidDelete(this.onFileDeleted.bind(this)),
		)

		/*
		 An event that is emitted when a workspace folder is added or removed.
		 **Note:** this event will not fire if the first workspace folder is added, removed or changed,
		 because in that case the currently executing extensions (including the one that listens to this
		 event) will be terminated and restarted so that the (deprecated) `rootPath` property is updated
		 to point to the first workspace folder.
		 */
		// In other words, we don't have to worry about the root workspace folder ([0]) changing since the extension will be restarted and our cwd will be updated to reflect the new workspace folder. (We don't care about non root workspace folders, since cline will only be working within the root folder cwd)
		// this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(this.onWorkspaceFoldersChanged.bind(this)))
	}

	private async onFileCreated(uri: vscode.Uri) {
		if (await this.addFilePath(uri.fsPath)) {
			this.workspaceDidUpdate()
		}
	}

	private async onFileDeleted(uri: vscode.Uri) {
		if (await this.removeFilePath(uri.fsPath)) {
			this.workspaceDidUpdate()
		}
	}

	private workspaceDidUpdate() {
		const cwd = this.cwd
		if (!cwd) {
			return
		}

		this.postMessageToWebview({
			type: "workspaceUpdated",
			filePaths: Array.from(this.filePaths).map((file) => {
				const relativePath = path.relative(cwd, file).toPosix()
				return file.endsWith("/") ? relativePath + "/" : relativePath
			}),
		})
	}

	private normalizeFilePath(filePath: string): string {
		const resolvedPath = this.cwd ? path.resolve(this.cwd, filePath) : path.resolve(filePath)
		return filePath.endsWith("/") ? resolvedPath + "/" : resolvedPath
	}

	private async addFilePath(filePath: string): Promise<string | boolean> {
		const normalizedPath = this.normalizeFilePath(filePath)

		if (!this.cwd || !shouldTrackFile(path.relative(this.cwd, normalizedPath))) {
			return false
		}

		try {
			const stat = await vscode.workspace.fs.stat(vscode.Uri.file(normalizedPath))
			const isDirectory = (stat.type & vscode.FileType.Directory) !== 0

			if (isDirectory) {
				// Renaming a directory doesn't trigger events for files within it
				// If it has files, we need to add them to the list
				const [files, _] = await listFiles(normalizedPath, true, 1_000)
				files.forEach((file) => this.filePaths.add(this.normalizeFilePath(file)))
			}

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

		/* 
		  When deleting a directory recursively, we will receive a single event for the directory itself.
		  Consequently, we need to remove files from that directory manually.
		  We can't check the stats to determine if it was a directory because it no longer exists.
		  However, since we store the directory paths with a slash,
		  we can check for that instead.
		*/
		if (this.filePaths.has(normalizedPath + "/")) {
			this.filePaths.forEach((filePath) => {
				if (filePath.startsWith(normalizedPath + "/")) {
					this.filePaths.delete(filePath)
				}
			})

			return true
		}

		return this.filePaths.delete(normalizedPath) || this.filePaths.delete(normalizedPath + "/")
	}

	public dispose() {
		this.disposables.forEach((d) => d.dispose())
	}
}

export default WorkspaceTracker
