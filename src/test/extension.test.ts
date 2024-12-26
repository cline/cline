import { readFile } from "fs/promises"
import { describe, it, after } from "mocha"
import path from "path"
import "should"
import * as vscode from "vscode"

const packagePath = path.join(__dirname, "..", "..", "..", "package.json")

describe("Cline Extension", () => {
	after(() => {
		vscode.window.showInformationMessage("All tests done!")
	})

	it("should verify extension ID matches package.json", async () => {
		const packageJSON = JSON.parse(await readFile(packagePath, "utf8"))
		const id = packageJSON.publisher + "." + packageJSON.name
		const clineExtensionApi = vscode.extensions.getExtension(id)

		clineExtensionApi?.id.should.equal(id)
	})

	it("should successfully execute the plus button command", async () => {
		await new Promise((resolve) => setTimeout(resolve, 400))
		await vscode.commands.executeCommand("cline.plusButtonClicked")
	})
})
