/* eslint-disable eslint-rules/no-direct-vscode-api */
import { describe, it, beforeEach, afterEach } from "mocha"
import { strict as assert } from "assert"
import * as vscode from "vscode"
import { getOpenTabs } from "@/hosts/vscode/hostbridge/window/getOpenTabs"
import { GetOpenTabsRequest } from "@/shared/proto/host/window"

describe("Hostbridge - Window - getOpenTabs", () => {
	async function createAndOpenTestDocument(fileNumber: number, column: vscode.ViewColumn): Promise<void> {
		const content = `// Test file ${fileNumber}\nconsole.log('Hello from file ${fileNumber}');`
		const doc = await vscode.workspace.openTextDocument({
			content,
			language: "javascript",
		})
		await vscode.window.showTextDocument(doc, column)
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

		assert.strictEqual(response.paths.length, 0, "Should return empty array when no tabs are open")
	})

	it("should return paths of open text document tabs", async () => {
		// Open the documents in editors (this creates the tabs)
		await createAndOpenTestDocument(1, vscode.ViewColumn.One)
		await createAndOpenTestDocument(2, vscode.ViewColumn.Two)

		// Wait a bit for tabs to be fully created
		await new Promise((resolve) => setTimeout(resolve, 100))

		const request = GetOpenTabsRequest.create({})
		const response = await getOpenTabs(request)

		// Should have 2 tabs open
		assert.strictEqual(response.paths.length, 2, `Expected 2 tabs, got ${response.paths.length}`)
	})

	it("should return all open tabs even when multiple files are opened in the same ViewColumn", async () => {
		// Open all documents in the same column (only the last one will be visible, but all are open as tabs)
		await createAndOpenTestDocument(1, vscode.ViewColumn.One)
		await createAndOpenTestDocument(2, vscode.ViewColumn.One)
		await createAndOpenTestDocument(3, vscode.ViewColumn.One)

		// Wait a bit for tabs to be fully created
		await new Promise((resolve) => setTimeout(resolve, 100))

		const request = GetOpenTabsRequest.create({})
		const response = await getOpenTabs(request)
		// Sanity check
		const visibleEditors = vscode.window.visibleTextEditors.length
		assert.strictEqual(visibleEditors, 1, `Expected 1 visible editor, got ${visibleEditors}`)

		// Should have all 3 tabs open, even though only 1 is visible
		assert.strictEqual(response.paths.length, 3, `Expected 3 open tabs, got ${response.paths.length}`)
	})
})
