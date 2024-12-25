import * as assert from "assert"

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from "vscode"
// import * as myExtension from '../../extension';

import { readFile } from "fs/promises"
import path from "path"

const packagePath = path.join(__dirname, "..", "..", "..", "package.json")

suite("Extension Test Suite", () => {
	suiteTeardown(() => {
		vscode.window.showInformationMessage("All tests done!")
	})

	test("Sanity check", async () => {
		const packageJSON = JSON.parse(await readFile(packagePath, "utf8"))
		const id = packageJSON.publisher + "." + packageJSON.name
		const clineExtensionApi = vscode.extensions.getExtension(id)
		assert.equal(clineExtensionApi?.id, id)
	})

	test("Ensure that the extension is correctly loaded by running a command", async () => {
		await new Promise((resolve) => setTimeout(resolve, 400))
		await vscode.commands.executeCommand("cline.plusButtonClicked")
	})
})
