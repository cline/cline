import * as vscode from "vscode"

export function outputChannelLog(outputChannel: vscode.OutputChannel, ...args: unknown[]) {
	for (const arg of args) {
		if (arg === null) {
			outputChannel.appendLine("null")
		} else if (arg === undefined) {
			outputChannel.appendLine("undefined")
		} else if (typeof arg === "string") {
			outputChannel.appendLine(arg)
		} else if (arg instanceof Error) {
			outputChannel.appendLine(`Error: ${arg.message}\n${arg.stack || ""}`)
		} else {
			try {
				outputChannel.appendLine(
					JSON.stringify(
						arg,
						(key, value) => {
							if (typeof value === "bigint") return `BigInt(${value})`
							if (typeof value === "function") return `Function: ${value.name || "anonymous"}`
							if (typeof value === "symbol") return value.toString()
							return value
						},
						2,
					),
				)
			} catch (error) {
				outputChannel.appendLine(`[Non-serializable object: ${Object.prototype.toString.call(arg)}]`)
			}
		}
	}
}
