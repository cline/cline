import { strict as assert } from "assert"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import pWaitFor from "p-wait-for"
import * as path from "path"
import * as vscode from "vscode"
import { getOpenTabs } from "@/hosts/vscode/hostbridge/window/getOpenTabs"
import { GetOpenTabsRequest } from "@/shared/proto/host/window"

describe("Hostbridge - Window - getOpenTabs", () => {
	async function createAndOpenTestDocument(name: string, column: vscode.ViewColumn): Promise<void> {
		const content = `// Test file ${name}\nconsole.log('Hello from file ${name}');`

		// Create an untitled document with a custom name
		const uri = vscode.Uri.parse(`untitled:test-file-${name}.js`)

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

	it("should return empty array when no tabs are open", async () => {
		// Ensure no tabs are open
		await vscode.commands.executeCommand("workbench.action.closeAllEditors")

		const request = GetOpenTabsRequest.create({})
		const response = await getOpenTabs(request)

		assert.strictEqual(
			response.paths.length,
			0,
			`Should return empty array when no tabs are open. Found: ${JSON.stringify(response.paths)}`,
		)
	})

	it("should return paths of open text document tabs", async () => {
		// Open the documents in editors (this creates the tabs)
		await createAndOpenTestDocument("open-tabs-1", vscode.ViewColumn.One)
		await createAndOpenTestDocument("open-tabs-2", vscode.ViewColumn.Two)

		// Wait for tabs to be fully created
		await pWaitFor(
			async () => {
				const request = GetOpenTabsRequest.create({})
				const response = await getOpenTabs(request)
				console.log(
					`[DEBUG] Waiting for 2 tabs, currently found ${response.paths.length}: ${JSON.stringify(response.paths)}`,
				)
				return response.paths.length === 2
			},
			{
				timeout: 8000,
				interval: 50,
			},
		)

		const request = GetOpenTabsRequest.create({})
		const response = await getOpenTabs(request)

		// Should have 2 tabs open
		assert.strictEqual(
			response.paths.length,
			2,
			`Expected 2 tabs, got ${response.paths.length}. Found tabs: ${JSON.stringify(response.paths)}`,
		)
	})

	it("should return all open tabs even when multiple files are opened in the same ViewColumn", async () => {
		// Open all documents in the same column (only the last one will be visible, but all are open as tabs)
		await createAndOpenTestDocument("same-column-1", vscode.ViewColumn.One)
		await createAndOpenTestDocument("same-column-2", vscode.ViewColumn.One)
		await createAndOpenTestDocument("same-column-3", vscode.ViewColumn.One)

		// Wait for tabs to be fully created
		await pWaitFor(
			async () => {
				const request = GetOpenTabsRequest.create({})
				const response = await getOpenTabs(request)
				console.log(
					`[DEBUG] Waiting for 3 tabs, currently found ${response.paths.length}: ${JSON.stringify(response.paths)}`,
				)
				return response.paths.length === 3
			},
			{
				timeout: 8000,
				interval: 50,
			},
		)

		const request = GetOpenTabsRequest.create({})
		const response = await getOpenTabs(request)

		// Should have all 3 tabs open, even though only 1 is visible
		assert.strictEqual(
			response.paths.length,
			3,
			`Expected 3 open tabs, got ${response.paths.length}. Found: ${JSON.stringify(response.paths)}`,
		)
	})

	it("should return all tabs including deleted files", async () => {
		// Create a temporary file on disk
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vscode-test-"))
		const testFilePath = path.join(tempDir, "test-file.js")
		await fs.writeFile(testFilePath, "console.log('test file');")

		// Open the file as a tab
		const document = await vscode.workspace.openTextDocument(testFilePath)
		await vscode.window.showTextDocument(document, { preview: false })

		// Also open an untitled document
		await createAndOpenTestDocument("includes-deleted", vscode.ViewColumn.One)

		// Wait for tabs to be created
		await pWaitFor(
			async () => {
				const request = GetOpenTabsRequest.create({})
				const response = await getOpenTabs(request)
				console.log(
					`[DEBUG] Waiting for 2 tabs (temp file + untitled), currently found ${response.paths.length}: ${JSON.stringify(response.paths)}`,
				)
				return response.paths.length === 2
			},
			{
				timeout: 8000,
				interval: 50,
			},
		)

		// Delete the file from disk
		await fs.unlink(testFilePath)

		// Get open tabs - should still return both tabs
		const request = GetOpenTabsRequest.create({})
		const response = await getOpenTabs(request)

		// Should still have 2 tabs (host bridge returns all tabs regardless of file existence)
		assert.strictEqual(
			response.paths.length,
			2,
			`Host bridge should return all tabs including deleted files. Found tabs: ${JSON.stringify(response.paths)}`,
		)
		try {
			// Clean up temp directory
			await fs.rm(tempDir, { recursive: true })
		} catch (error) {
			console.error(error)
		}
	})
})
