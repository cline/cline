import * as path from "path"
import Mocha from "mocha"
import { glob } from "glob"
import * as vscode from "vscode"

import type { RooCodeAPI } from "../../../src/exports/roo-code"

import { waitFor } from "./utils"

declare global {
	var api: RooCodeAPI
}

export async function run() {
	const extension = vscode.extensions.getExtension<RooCodeAPI>("RooVeterinaryInc.roo-cline")

	if (!extension) {
		throw new Error("Extension not found")
	}

	const api = extension.isActive ? extension.exports : await extension.activate()

	await api.setConfiguration({
		apiProvider: "openrouter" as const,
		openRouterApiKey: process.env.OPENROUTER_API_KEY!,
		openRouterModelId: "google/gemini-2.0-flash-001",
		openRouterModelInfo: {
			maxTokens: 8192,
			contextWindow: 1000000,
			supportsImages: true,
			supportsPromptCache: false,
			inputPrice: 0.1,
			outputPrice: 0.4,
			thinking: false,
		},
	})

	await vscode.commands.executeCommand("roo-cline.SidebarProvider.focus")
	await waitFor(() => api.isReady())

	// Expose the API to the tests.
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
