import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { createDirectoriesForFile, fileExistsAtPath } from "../../utils/fs"
import { arePathsEqual } from "../../utils/path"
import { formatResponse } from "../../core/prompts/responses"
import * as diff from "diff"

export class DiffViewProvider {
	editType?: "create" | "modify"
	isEditing = false
	// private isEditingExistingFile: boolean | undefined
	originalContent: string | undefined
	private createdDirs: string[] = []
	private documentWasOpen = false

	private relPath?: string
	private newContent?: string

	constructor(private cwd: string) {}

	async update(relPath: string, newContent: string): Promise<void> {
		this.relPath = relPath
		this.newContent = newContent
		const fileExists = this.editType === "modify"
		const absolutePath = path.resolve(this.cwd, relPath)

		if (!this.isEditing) {
			// starting edit
			// open the editor and prepare to stream content in

			this.isEditing = true

			// if the file is already open, ensure it's not dirty before getting its contents
			if (fileExists) {
				const existingDocument = vscode.workspace.textDocuments.find((doc) =>
					arePathsEqual(doc.uri.fsPath, absolutePath)
				)
				if (existingDocument && existingDocument.isDirty) {
					await existingDocument.save()
				}
			}

			// get diagnostics before editing the file, we'll compare to diagnostics after editing to see if claude needs to fix anything
			// const preDiagnostics = vscode.languages.getDiagnostics()

			if (fileExists) {
				this.originalContent = await fs.readFile(absolutePath, "utf-8")
				// fix issue where claude always removes newline from the file
				// const eol = this.originalContent.includes("\r\n") ? "\r\n" : "\n"
				// if (this.originalContent.endsWith(eol) && !this.newContent.endsWith(eol)) {
				// 	this.newContent += eol
				// }
			} else {
				this.originalContent = ""
			}

			const fileName = path.basename(absolutePath)
			// for new files, create any necessary directories and keep track of new directories to delete if the user denies the operation

			// Keep track of newly created directories
			this.createdDirs = await createDirectoriesForFile(absolutePath)
			// console.log(`Created directories: ${createdDirs.join(", ")}`)
			// make sure the file exists before we open it
			if (!fileExists) {
				await fs.writeFile(absolutePath, "")
			}

			// Open the existing file with the new contents
			const updatedDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(absolutePath))

			// await updatedDocument.save()
			// const edit = new vscode.WorkspaceEdit()
			// const fullRange = new vscode.Range(
			// 	updatedDocument.positionAt(0),
			// 	updatedDocument.positionAt(updatedDocument.getText().length)
			// )
			// edit.replace(updatedDocument.uri, fullRange, newContent)
			// await vscode.workspace.applyEdit(edit)

			// Windows file locking issues can prevent temporary files from being saved or closed properly.
			// To avoid these problems, we use in-memory TextDocument objects with the `untitled` scheme.
			// This method keeps the document entirely in memory, bypassing the filesystem and ensuring
			// a consistent editing experience across all platforms. This also has the added benefit of not
			// polluting the user's workspace with temporary files.

			// Create an in-memory document for the new content
			// const inMemoryDocumentUri = vscode.Uri.parse(`untitled:${fileName}`) // untitled scheme is necessary to open a file without it being saved to disk
			// const inMemoryDocument = await vscode.workspace.openTextDocument(inMemoryDocumentUri)
			// const edit = new vscode.WorkspaceEdit()
			// edit.insert(inMemoryDocumentUri, new vscode.Position(0, 0), newContent)
			// await vscode.workspace.applyEdit(edit)

			// Show diff
			await vscode.commands.executeCommand(
				"vscode.diff",
				vscode.Uri.parse(`claude-dev-diff:${fileName}`).with({
					query: Buffer.from(this.originalContent).toString("base64"),
				}),
				updatedDocument.uri,
				`${fileName}: ${fileExists ? "Original ↔ Claude's Changes" : "New File"} (Editable)`
			)

			// if the file was already open, close it (must happen after showing the diff view since if it's the only tab the column will close)
			this.documentWasOpen = false

			// close the tab if it's open
			const tabs = vscode.window.tabGroups.all
				.map((tg) => tg.tabs)
				.flat()
				.filter(
					(tab) =>
						tab.input instanceof vscode.TabInputText && arePathsEqual(tab.input.uri.fsPath, absolutePath)
				)
			for (const tab of tabs) {
				await vscode.window.tabGroups.close(tab)
				this.documentWasOpen = true
			}
		}

		// editor is open, stream content in

		const updatedDocument = vscode.workspace.textDocuments.find((doc) =>
			arePathsEqual(doc.uri.fsPath, absolutePath)
		)!

		// edit needs to happen after we close the original tab
		const edit = new vscode.WorkspaceEdit()
		if (!fileExists) {
			// edit.insert(updatedDocument.uri, new vscode.Position(0, 0), newContent)
			const fullRange = new vscode.Range(
				updatedDocument.positionAt(0),
				updatedDocument.positionAt(updatedDocument.getText().length)
			)
			edit.replace(updatedDocument.uri, fullRange, newContent)
		} else {
			const fullRange = new vscode.Range(
				updatedDocument.positionAt(0),
				updatedDocument.positionAt(updatedDocument.getText().length)
			)
			edit.replace(updatedDocument.uri, fullRange, newContent)
		}
		// Apply the edit, but without saving so this doesnt trigger a local save in timeline history
		await vscode.workspace.applyEdit(edit) // has the added benefit of maintaing the file's original EOLs

		// Find the first range where the content differs and scroll to it
		// if (fileExists) {
		// 	const diffResult = diff.diffLines(originalContent, newContent)
		// 	for (let i = 0, lineCount = 0; i < diffResult.length; i++) {
		// 		const part = diffResult[i]
		// 		if (part.added || part.removed) {
		// 			const startLine = lineCount + 1
		// 			const endLine = lineCount + (part.count || 0)
		// 			const activeEditor = vscode.window.activeTextEditor
		// 			if (activeEditor) {
		// 				try {
		// 					activeEditor.revealRange(
		// 						// + 3 to move the editor up slightly as this looks better
		// 						new vscode.Range(
		// 							new vscode.Position(startLine, 0),
		// 							new vscode.Position(Math.min(endLine + 3, activeEditor.document.lineCount - 1), 0)
		// 						),
		// 						vscode.TextEditorRevealType.InCenter
		// 					)
		// 				} catch (error) {
		// 					console.error(`Error revealing range for ${absolutePath}: ${error}`)
		// 				}
		// 			}
		// 			break
		// 		}
		// 		lineCount += part.count || 0
		// 	}
		// }

		// remove cursor from the document
		// await vscode.commands.executeCommand("workbench.action.focusSideBar")

		// const closeInMemoryDocAndDiffViews = async () => {
		// 	// ensure that the in-memory doc is active editor (this seems to fail on windows machines if its already active, so ignoring if there's an error as it's likely it's already active anyways)
		// 	// try {
		// 	// 	await vscode.window.showTextDocument(inMemoryDocument, {
		// 	// 		preview: false, // ensures it opens in non-preview tab (preview tabs are easily replaced)
		// 	// 		preserveFocus: false,
		// 	// 	})
		// 	// 	// await vscode.window.showTextDocument(inMemoryDocument.uri, { preview: true, preserveFocus: false })
		// 	// } catch (error) {
		// 	// 	console.log(`Could not open editor for ${absolutePath}: ${error}`)
		// 	// }
		// 	// await delay(50)
		// 	// // Wait for the in-memory document to become the active editor (sometimes vscode timing issues happen and this would accidentally close claude dev!)
		// 	// await pWaitFor(
		// 	// 	() => {
		// 	// 		return vscode.window.activeTextEditor?.document === inMemoryDocument
		// 	// 	},
		// 	// 	{ timeout: 5000, interval: 50 }
		// 	// )

		// 	// if (vscode.window.activeTextEditor?.document === inMemoryDocument) {
		// 	// 	await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor") // allows us to close the untitled doc without being prompted to save it
		// 	// }

		// 	await this.closeDiffViews()
		// }
	}

	// async applyEdit(relPath: string, newContent: string): Promise<void> {}

	async saveChanges() {
		if (!this.relPath || !this.newContent) {
			return
		}

		const absolutePath = path.resolve(this.cwd, this.relPath)

		const updatedDocument = vscode.workspace.textDocuments.find((doc) =>
			arePathsEqual(doc.uri.fsPath, absolutePath)
		)!

		const editedContent = updatedDocument.getText()
		if (updatedDocument.isDirty) {
			await updatedDocument.save()
		}

		// Read the potentially edited content from the document

		// trigger an entry in the local history for the file
		// if (fileExists) {
		// 	await fs.writeFile(absolutePath, originalContent)
		// 	const editor = await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), { preview: false })
		// 	const edit = new vscode.WorkspaceEdit()
		// 	const fullRange = new vscode.Range(
		// 		editor.document.positionAt(0),
		// 		editor.document.positionAt(editor.document.getText().length)
		// 	)
		// 	edit.replace(editor.document.uri, fullRange, editedContent)
		// 	// Apply the edit, this will trigger a local save and timeline history
		// 	await vscode.workspace.applyEdit(edit) // has the added benefit of maintaing the file's original EOLs
		// 	await editor.document.save()
		// }

		// if (!fileExists) {
		// 	await fs.mkdir(path.dirname(absolutePath), { recursive: true })
		// 	await fs.writeFile(absolutePath, "")
		// }
		// await closeInMemoryDocAndDiffViews()

		// await fs.writeFile(absolutePath, editedContent)

		// open file and add text to it, if it fails fallback to using writeFile
		// we try doing it this way since it adds to local history for users to see what's changed in the file's timeline
		// try {
		// 	const editor = await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), { preview: false })
		// 	const edit = new vscode.WorkspaceEdit()
		// 	const fullRange = new vscode.Range(
		// 		editor.document.positionAt(0),
		// 		editor.document.positionAt(editor.document.getText().length)
		// 	)
		// 	edit.replace(editor.document.uri, fullRange, editedContent)
		// 	// Apply the edit, this will trigger a local save and timeline history
		// 	await vscode.workspace.applyEdit(edit) // has the added benefit of maintaing the file's original EOLs
		// 	await editor.document.save()
		// } catch (saveError) {
		// 	console.log(`Could not open editor for ${absolutePath}: ${saveError}`)
		// 	await fs.writeFile(absolutePath, editedContent)
		// 	// calling showTextDocument would sometimes fail even though changes were applied, so we'll ignore these one-off errors (likely due to vscode locking issues)
		// 	try {
		// 		await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), { preview: false })
		// 	} catch (openFileError) {
		// 		console.log(`Could not open editor for ${absolutePath}: ${openFileError}`)
		// 	}
		// }

		await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), { preview: false })

		await this.closeDiffViews()

		/*
			Getting diagnostics before and after the file edit is a better approach than
			automatically tracking problems in real-time. This method ensures we only
			report new problems that are a direct result of this specific edit.
			Since these are new problems resulting from Claude's edit, we know they're
			directly related to the work he's doing. This eliminates the risk of Claude
			going off-task or getting distracted by unrelated issues, which was a problem
			with the previous auto-debug approach. Some users' machines may be slow to
			update diagnostics, so this approach provides a good balance between automation
			and avoiding potential issues where Claude might get stuck in loops due to
			outdated problem information. If no new problems show up by the time the user
			accepts the changes, they can always debug later using the '@problems' mention.
			This way, Claude only becomes aware of new problems resulting from his edits
			and can address them accordingly. If problems don't change immediately after
			applying a fix, Claude won't be notified, which is generally fine since the
			initial fix is usually correct and it may just take time for linters to catch up.
			*/
		// const postDiagnostics = vscode.languages.getDiagnostics()
		// const newProblems = diagnosticsToProblemsString(
		// 	getNewDiagnostics(preDiagnostics, postDiagnostics),
		// 	[
		// 		vscode.DiagnosticSeverity.Error, // only including errors since warnings can be distracting (if user wants to fix warnings they can use the @problems mention)
		// 	],
		// 	cwd
		// ) // will be empty string if no errors
		// const newProblemsMessage =
		// 	newProblems.length > 0 ? `\n\nNew problems detected after saving the file:\n${newProblems}` : ""
		// // await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), { preview: false })

		// If the edited content has different EOL characters, we don't want to show a diff with all the EOL differences.
		const newContentEOL = this.newContent.includes("\r\n") ? "\r\n" : "\n"
		const normalizedEditedContent = editedContent.replace(/\r\n|\n/g, newContentEOL)
		const normalizedNewContent = this.newContent.replace(/\r\n|\n/g, newContentEOL) // just in case the new content has a mix of varying EOL characters

		if (normalizedEditedContent !== normalizedNewContent) {
			// user made changes before approving edit
			return formatResponse.createPrettyPatch(
				this.relPath.toPosix(),
				normalizedNewContent,
				normalizedEditedContent
			)
		} else {
			// no changes to claude's edits
			return undefined
		}
	}

	async revertChanges(): Promise<void> {
		if (!this.relPath) {
			return
		}
		const fileExists = this.editType === "modify"
		const updatedDocument = vscode.workspace.textDocuments.find((doc) =>
			arePathsEqual(doc.uri.fsPath, absolutePath)
		)!
		const absolutePath = path.resolve(this.cwd, this.relPath)
		if (!fileExists) {
			if (updatedDocument.isDirty) {
				await updatedDocument.save()
			}
			await this.closeDiffViews()
			await fs.unlink(absolutePath)
			// Remove only the directories we created, in reverse order
			for (let i = this.createdDirs.length - 1; i >= 0; i--) {
				await fs.rmdir(this.createdDirs[i])
				console.log(`Directory ${this.createdDirs[i]} has been deleted.`)
			}
			console.log(`File ${absolutePath} has been deleted.`)
		} else {
			// revert document
			const edit = new vscode.WorkspaceEdit()
			const fullRange = new vscode.Range(
				updatedDocument.positionAt(0),
				updatedDocument.positionAt(updatedDocument.getText().length)
			)
			edit.replace(updatedDocument.uri, fullRange, this.originalContent ?? "")
			// Apply the edit and save, since contents shouldnt have changed this wont show in local history unless of course the user made changes and saved during the edit
			await vscode.workspace.applyEdit(edit)
			await updatedDocument.save()
			console.log(`File ${absolutePath} has been reverted to its original content.`)
			if (this.documentWasOpen) {
				await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), {
					preview: false,
				})
			}
			await this.closeDiffViews()
		}

		// edit is done
		this.reset()
	}

	async closeDiffViews() {
		const tabs = vscode.window.tabGroups.all
			.map((tg) => tg.tabs)
			.flat()
			.filter(
				(tab) =>
					tab.input instanceof vscode.TabInputTextDiff && tab.input?.original?.scheme === "claude-dev-diff"
			)

		for (const tab of tabs) {
			// trying to close dirty views results in save popup
			if (!tab.isDirty) {
				await vscode.window.tabGroups.close(tab)
			}
		}
	}

	// close editor if open?
	async reset() {
		this.editType = undefined
		this.isEditing = false
		this.originalContent = undefined
		this.createdDirs = []
		this.documentWasOpen = false
	}

	// ... (other helper methods like showDiffView, closeExistingTab, deleteNewFile, revertExistingFile, etc.)
}
