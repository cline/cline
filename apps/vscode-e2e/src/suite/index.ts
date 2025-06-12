import * as path from "path"
import Mocha from "mocha"
import { glob } from "glob"
import * as vscode from "vscode"

import type { RooCodeAPI } from "@roo-code/types"

import { waitFor } from "./utils"

export async function run() {
	const extension = vscode.extensions.getExtension<RooCodeAPI>("RooVeterinaryInc.roo-cline")

	if (!extension) {
		throw new Error("Extension not found")
	}

	const api = extension.isActive ? extension.exports : await extension.activate()

	await api.setConfiguration({
		apiProvider: "openrouter" as const,
		openRouterApiKey: process.env.OPENROUTER_API_KEY!,
		openRouterModelId: "openai/gpt-4.1",
	})

	await vscode.commands.executeCommand("roo-cline.SidebarProvider.focus")
	await waitFor(() => api.isReady())

	globalThis.api = api

	// Configure Mocha with grep pattern if provided
	const mochaOptions: Mocha.MochaOptions = {
		ui: "tdd",
		timeout: 300_000,
	}

	// Apply grep filter if TEST_GREP is set
	if (process.env.TEST_GREP) {
		mochaOptions.grep = process.env.TEST_GREP
		console.log(`Running tests matching pattern: ${process.env.TEST_GREP}`)
	}

	const mocha = new Mocha(mochaOptions)
	const cwd = path.resolve(__dirname, "..")

	// Get test files based on filter
	let testFiles: string[]
	if (process.env.TEST_FILE) {
		// Run specific test file
		const specificFile = process.env.TEST_FILE.endsWith(".js")
			? process.env.TEST_FILE
			: `${process.env.TEST_FILE}.js`
		testFiles = await glob(`**/${specificFile}`, { cwd })
		console.log(`Running specific test file: ${specificFile}`)
	} else {
		// Run all test files
		testFiles = await glob("**/**.test.js", { cwd })
	}

	if (testFiles.length === 0) {
		throw new Error(`No test files found matching criteria: ${process.env.TEST_FILE || "all tests"}`)
	}

	testFiles.forEach((testFile) => mocha.addFile(path.resolve(cwd, testFile)))

	// Let's go!
	return new Promise<void>((resolve, reject) =>
		mocha.run((failures) => (failures === 0 ? resolve() : reject(new Error(`${failures} tests failed.`)))),
	)
}
