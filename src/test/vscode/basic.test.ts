import * as assert from "assert"
import { readFile } from "fs/promises"
import path from "path"
import * as vscode from "vscode"

const packagePath = path.join(__dirname, "..", "..", "..", "..", "package.json")

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
