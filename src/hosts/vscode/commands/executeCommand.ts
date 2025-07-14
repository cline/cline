import * as vscode from "vscode"
import { ExecuteCommandRequest, ExecuteCommandResponse } from "@/shared/proto/host/commands"

export async function executeCommand(request: ExecuteCommandRequest): Promise<ExecuteCommandResponse> {
	try {
		// Convert string args to appropriate types for VSCode command execution
		const args = request.args.map((arg) => {
			// Try to parse as JSON first, fallback to string
			try {
				return JSON.parse(arg)
			} catch {
				return arg
			}
		})

		const result = await vscode.commands.executeCommand(request.command, ...args)

		// Convert result to string if it exists
		const resultString = result !== undefined ? JSON.stringify(result) : undefined

		return ExecuteCommandResponse.create({
			result: resultString,
		})
	} catch (error) {
		console.error("Error executing command:", error)
		throw error
	}
}
