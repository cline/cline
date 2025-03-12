import * as path from "path"
import Mocha from "mocha"
import { glob } from "glob"
import * as vscode from "vscode"

import { RooCodeAPI } from "../../../src/exports/roo-code"

import { waitUntilReady } from "./utils"

declare global {
	var extension: vscode.Extension<RooCodeAPI> | undefined
	var api: RooCodeAPI
}

export async function run() {
	const mocha = new Mocha({ ui: "tdd", timeout: 300_000 })
	const testsRoot = path.resolve(__dirname, "..")

	try {
		// Find all test files.
		const files = await glob("**/**.test.js", { cwd: testsRoot })
		files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)))

		const extension = vscode.extensions.getExtension<RooCodeAPI>("RooVeterinaryInc.roo-cline")

		if (!extension) {
			throw new Error("Extension not found")
		}

		const api = extension.isActive ? extension.exports : await extension.activate()

		await api.setConfiguration({
			apiProvider: "openrouter",
			openRouterApiKey: process.env.OPENROUTER_API_KEY!,
			openRouterModelId: "anthropic/claude-3.5-sonnet",
		})

		await waitUntilReady(api)

		globalThis.api = api
		globalThis.extension = extension

		return new Promise<void>((resolve, reject) => {
			try {
				mocha.run((failures: number) => {
					if (failures > 0) {
						reject(new Error(`${failures} tests failed.`))
					} else {
						resolve()
					}
				})
			} catch (err) {
				console.error(err)
				reject(err)
			}
		})
	} catch (err) {
		console.error("Error while running tests:")
		console.error(err)
		throw err
	}
}
