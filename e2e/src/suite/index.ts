import * as path from "path"
import Mocha from "mocha"
import { glob } from "glob"
import * as vscode from "vscode"

import { type RooCodeAPI, Package } from "@roo-code/types"

import { waitFor } from "./utils"

declare global {
	let api: RooCodeAPI
}

export async function run() {
	const extension = vscode.extensions.getExtension<RooCodeAPI>(`${Package.publisher}.${Package.name}`)

	if (!extension) {
		throw new Error("Extension not found")
	}

	const api = extension.isActive ? extension.exports : await extension.activate()

	await api.setConfiguration({
		apiProvider: "openrouter" as const,
		openRouterApiKey: process.env.OPENROUTER_API_KEY!,
		openRouterModelId: "google/gemini-2.0-flash-001",
	})

	await vscode.commands.executeCommand(`${Package.name}.SidebarProvider.focus`)
	await waitFor(() => api.isReady())

	// @ts-expect-error - Expose the API to the tests.
	globalThis.api = api

	// Add all the tests to the runner.
	const mocha = new Mocha({ ui: "tdd", timeout: 300_000 })
	const cwd = path.resolve(__dirname, "..")
	;(await glob("**/**.test.js", { cwd })).forEach((testFile) => mocha.addFile(path.resolve(cwd, testFile)))

	// Let's go!
	return new Promise<void>((resolve, reject) =>
		mocha.run((failures) => (failures === 0 ? resolve() : reject(new Error(`${failures} tests failed.`)))),
	)
}
