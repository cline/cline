import { strict as assert } from "assert"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { getVisibleTabs } from "@/hosts/vscode/hostbridge/window/getVisibleTabs"
import { GetVisibleTabsRequest } from "@/shared/proto/host/window"

describe("Hostbridge - Window - getVisibleTabs", () => {
	/**
	 * Helper function to create and open a test document in a specific column
	 */
	async function createAndOpenTestDocument(fileNumber: number, column: vscode.ViewColumn): Promise<void> {
		const content = `// Test file ${fileNumber}\nconsole.log('Hello from file ${fileNumber}');`

		// Create an untitled document with a custom name
		const uri = vscode.Uri.parse(`untitled:test-file-${fileNumber}.js`)

		const doc = await vscode.workspace.openTextDocument(uri)

		// Set the content
		const edit = new vscode.WorkspaceEdit()
		edit.insert(uri, new vscode.Position(0, 0), content)
		await vscode.workspace.applyEdit(edit)

		await vscode.window.showTextDocument(doc, {
			viewColumn: column,
			preview: false,
		})
	}

	beforeEach(async () => {
		// Clean up any existing editors
		await vscode.commands.executeCommand("workbench.action.closeAllEditors")
	})

	afterEach(async () => {
		// Clean up test documents and editors
		await vscode.commands.executeCommand("workbench.action.closeAllEditors")
	})

	it("should return empty array when no visible editors are open", async () => {
		// Ensure no editors are open
		await vscode.commands.executeCommand("workbench.action.closeAllEditors")

		const request = GetVisibleTabsRequest.create({})
		const response = await getVisibleTabs(request)

		assert.strictEqual(
			response.paths.length,
			0,
			`Should return empty array when no visible editors are open. Found tabs: ${JSON.stringify(response.paths)}`,
		)
	})

	it("should return paths of visible text editors", async () => {
		// Open the first document in an editor (this makes it visible)
		await createAndOpenTestDocument(1, vscode.ViewColumn.One)

		// Wait a bit for editor to be fully created
		await new Promise((resolve) => setTimeout(resolve, 100))

		const request = GetVisibleTabsRequest.create({})
		const response = await getVisibleTabs(request)

		// Should have 1 visible editor
		assert.strictEqual(
			response.paths.length,
			1,
			`Expected 1 visible editor, got ${response.paths.length}. Found: ${JSON.stringify(response.paths)}`,
		)

		// Open the second document in a different column (both should now be visible)
		await createAndOpenTestDocument(2, vscode.ViewColumn.Two)

		// Wait a bit for editor to be fully created
		await new Promise((resolve) => setTimeout(resolve, 100))

		const response2 = await getVisibleTabs(request)

		// Should have 2 visible editors
		assert.strictEqual(
			response2.paths.length,
			2,
			`Expected 2 visible editors, got ${response2.paths.length}. Found: ${JSON.stringify(response2.paths)}`,
		)
	})

	it("should only return visible editors, not all open tabs", async () => {
		// Open all documents in the same column (only the last one will be visible)
		await createAndOpenTestDocument(1, vscode.ViewColumn.One)
		await createAndOpenTestDocument(2, vscode.ViewColumn.One)
		await createAndOpenTestDocument(3, vscode.ViewColumn.One)

		// Wait a bit for editors to be fully created
		await new Promise((resolve) => setTimeout(resolve, 100))

		const request = GetVisibleTabsRequest.create({})
		const response = await getVisibleTabs(request)

		// Should have only 1 visible editor (the last one opened in the same column)
		assert.strictEqual(
			response.paths.length,
			1,
			`Expected 1 visible editor, got ${response.paths.length}. Found: ${JSON.stringify(response.paths)}`,
		)

		// Verify that we have the correct number of visible text editors
		const actualVisibleEditors = vscode.window.visibleTextEditors.length
		assert.strictEqual(
			response.paths.length,
			actualVisibleEditors,
			`Response should match actual visible editors count: ${actualVisibleEditors}`,
		)
	})

	it("should return only visible editors from multiple columns with multiple files", async () => {
		// Open multiple documents in column one (only the last one will be visible in that column)
		await createAndOpenTestDocument(1, vscode.ViewColumn.One)
		await createAndOpenTestDocument(2, vscode.ViewColumn.One)
		await createAndOpenTestDocument(3, vscode.ViewColumn.One)

		// Open multiple documents in column two (only the last one will be visible in that column)
		await createAndOpenTestDocument(4, vscode.ViewColumn.Two)
		await createAndOpenTestDocument(5, vscode.ViewColumn.Two)

		// Wait a bit for editors to be fully created
		await new Promise((resolve) => setTimeout(resolve, 100))

		const request = GetVisibleTabsRequest.create({})
		const response = await getVisibleTabs(request)

		// Should have only 2 visible editors (one from each column, despite having 5 total open tabs)
		assert.strictEqual(
			response.paths.length,
			2,
			`Expected 2 visible editors, got ${response.paths.length}. Found: ${JSON.stringify(response.paths)}`,
		)

		// Verify that we have the correct number of visible text editors
		const actualVisibleEditors = vscode.window.visibleTextEditors.length
		assert.strictEqual(
			response.paths.length,
			actualVisibleEditors,
			`Response should match actual visible editors count: ${actualVisibleEditors}`,
		)
	})

	it("should return all visible tabs including deleted files)", async () => {
		// Create a temporary file on disk
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-test-"))
		const testFilePath = path.join(tempDir, "test-file-to-delete.txt")
		await fs.writeFile(testFilePath, "This file will be deleted")

		// Open the real file
		const fileUri = vscode.Uri.file(testFilePath)
		const fileDoc = await vscode.workspace.openTextDocument(fileUri)
		await vscode.window.showTextDocument(fileDoc, { viewColumn: vscode.ViewColumn.One, preview: false })

		// Also open an untitled document
		const untitledUri = vscode.Uri.parse("untitled:preserved-file.js")
		const untitledDoc = await vscode.workspace.openTextDocument(untitledUri)
		const edit = new vscode.WorkspaceEdit()
		edit.insert(untitledUri, new vscode.Position(0, 0), "// This untitled file should be preserved")
		await vscode.workspace.applyEdit(edit)
		await vscode.window.showTextDocument(untitledDoc, { viewColumn: vscode.ViewColumn.Two, preview: false })

		// Wait for editors to be fully created
		await new Promise((resolve) => setTimeout(resolve, 100))

		// Verify both files are initially visible
		const request = GetVisibleTabsRequest.create({})
		let response = await getVisibleTabs(request)
		assert.strictEqual(response.paths.length, 2, "Should initially have 2 visible tabs")

		// Delete the real file from disk (but keep the editor open)
		await fs.unlink(testFilePath)

		// Get visible tabs again - should still return both tabs
		response = await getVisibleTabs(request)
		assert.strictEqual(
			response.paths.length,
			2,
			`Host bridge should return all tabs including deleted files. Found: ${JSON.stringify(response.paths)}`,
		)

		// Clean up temp directory
		await fs.rm(tempDir, { recursive: true }).catch(() => {})
	})
})
