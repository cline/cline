import * as vscode from "vscode"
import * as diff from "diff"

export class DiffViewProvider implements vscode.TextDocumentContentProvider {
	private _onDidChange = new vscode.EventEmitter<vscode.Uri>()
	onDidChange = this._onDidChange.event

	private originalContent: string = ""
	private newContent: string = ""
	private fileName: string = ""

	constructor() {
		// Register the provider
		vscode.workspace.registerTextDocumentContentProvider("claude-dev-diff", this)
	}

	initialize(fileName: string, originalContent: string) {
		this.fileName = fileName
		this.originalContent = originalContent
		this.newContent = originalContent
	}

	updateNewContent(updatedContent: string) {
		this.newContent = updatedContent
		this._onDidChange.fire(this.getDiffUri())
	}

	provideTextDocumentContent(uri: vscode.Uri): string {
		return this.createDiffContent()
	}

	private createDiffContent(): string {
		const diffResult = diff.createPatch(this.fileName, this.originalContent, this.newContent)
		return diffResult
	}

	getDiffUri(): vscode.Uri {
		return vscode.Uri.parse(`claude-dev-diff:${this.fileName}`).with({
			query: Buffer.from(this.originalContent).toString("base64"),
		})
	}

	async showDiff() {
		await vscode.commands.executeCommand(
			"vscode.diff",
			this.getDiffUri(),
			vscode.Uri.file(this.fileName),
			`${this.fileName}: Original ↔ Claude's Changes (Editable)`
		)
	}
}
