// @ts-nocheck
import * as vscode from "vscode"

import { log } from "./utils"

const outputChannel: vscode.OutputChannel = {
	append: (text) => process.stdout.write(text),
	appendLine: (line) => console.log(`OUTPUT_CHANNEL: ${line}`),
	clear: () => {},
	show: () => {},
	hide: () => {},
	dispose: () => {},
	name: "",
	replace: function (value: string): void {},
}

function postMessage(message: ExtensionMessage): Promise<boolean> {
	log("postMessage stub called:", JSON.stringify(message).slice(0, 200))
	return Promise.resolve(true)
}

export { outputChannel, postMessage }
