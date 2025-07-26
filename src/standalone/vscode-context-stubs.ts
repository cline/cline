// @ts-nocheck
import * as vscode from "vscode"

import { log } from "./utils"

function postMessage(message: ExtensionMessage): Promise<boolean> {
	log("postMessage stub called:", JSON.stringify(message).slice(0, 200))
	return Promise.resolve(true)
}

export { postMessage }
