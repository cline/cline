/* eslint-disable eslint-rules/no-direct-vscode-api */
import { describe, it, beforeEach, afterEach } from "mocha"
import { strict as assert } from "assert"
import * as vscode from "vscode"
import pWaitFor from "p-wait-for"
import { getOpenTabs } from "@/hosts/vscode/hostbridge/window/getOpenTabs"
import { GetOpenTabsRequest } from "@/shared/proto/host/window"

describe("Hostbridge - Window - getOpenTabs", () => {
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
		await createAndOpenTestDocument(1, vscode.ViewColumn.One)
		await createAndOpenTestDocument(2, vscode.ViewColumn.Two)

		// Wait for tabs to be fully created
		await pWaitFor(
			async () => {
				const request = GetOpenTabsRequest.create({})
				const response = await getOpenTabs(request)
				return response.paths.length === 2
			},
			{
				timeout: 4000,
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
		await createAndOpenTestDocument(1, vscode.ViewColumn.One)
		await createAndOpenTestDocument(2, vscode.ViewColumn.One)
		await createAndOpenTestDocument(3, vscode.ViewColumn.One)

		// Wait for tabs to be fully created
		await pWaitFor(
			async () => {
				const request = GetOpenTabsRequest.create({})
				const response = await getOpenTabs(request)
				return response.paths.length === 3
			},
			{
				timeout: 4000,
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
})
