import * as assert from "assert"
import * as vscode from "vscode"

suite("Roo Code Extension", () => {
	test("Commands should be registered", async () => {
		const expectedCommands = [
			"roo-cline.plusButtonClicked",
			"roo-cline.mcpButtonClicked",
			"roo-cline.historyButtonClicked",
			"roo-cline.popoutButtonClicked",
			"roo-cline.settingsButtonClicked",
			"roo-cline.openInNewTab",
			"roo-cline.explainCode",
			"roo-cline.fixCode",
			"roo-cline.improveCode",
		]

		const commands = await vscode.commands.getCommands(true)

		for (const cmd of expectedCommands) {
			assert.ok(commands.includes(cmd), `Command ${cmd} should be registered`)
		}
	})
})
