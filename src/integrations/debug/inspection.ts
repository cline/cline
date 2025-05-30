import { z } from "zod"
import { activeSessions } from "./common"

/**
 * Get variables from a specific stack frame.
 *
 * @param params - Object containing sessionId, frameId, threadId, and optional filter to get variables from.
 */
export const getStackFrameVariables = async (params: {
	sessionId: string
	frameId: number
	threadId: number
	filter?: string
}) => {
	const { sessionId, frameId, threadId, filter } = params

	// Import the output channel for logging
	const { outputChannel } = await import("./common")
	outputChannel.appendLine(`Getting variables for session ${sessionId}, frame ${frameId}, thread ${threadId}`)

	// Find the session with the given ID
	const session = activeSessions.find((s) => s.id === sessionId)
	if (!session) {
		outputChannel.appendLine(`No debug session found with ID '${sessionId}'`)
		return {
			content: [
				{
					type: "text",
					text: `No debug session found with ID '${sessionId}'.`,
				},
			],
			isError: true,
		}
	}

	try {
		// First, get the scopes for the stack frame
		outputChannel.appendLine(`Requesting scopes for frameId ${frameId}`)
		const scopes = await session.customRequest("scopes", { frameId })
		outputChannel.appendLine(`Received scopes: ${JSON.stringify(scopes)}`)

		if (!scopes || !scopes.scopes || !Array.isArray(scopes.scopes)) {
			outputChannel.appendLine(`Invalid scopes response: ${JSON.stringify(scopes)}`)
			return {
				content: [
					{
						type: "text",
						text: `Invalid scopes response from debug adapter. This may be a limitation of the ${session.type} debug adapter.`,
					},
				],
				isError: true,
			}
		}

		// Then, get variables for each scope
		const variablesByScope = await Promise.all(
			scopes.scopes.map(async (scope: { name: string; variablesReference: number }) => {
				outputChannel.appendLine(`Processing scope: ${scope.name}, variablesReference: ${scope.variablesReference}`)

				if (scope.variablesReference === 0) {
					outputChannel.appendLine(`Scope ${scope.name} has no variables (variablesReference is 0)`)
					return {
						scopeName: scope.name,
						variables: [],
					}
				}

				try {
					outputChannel.appendLine(
						`Requesting variables for scope ${scope.name} with reference ${scope.variablesReference}`,
					)
					const response = await session.customRequest("variables", {
						variablesReference: scope.variablesReference,
					})
					outputChannel.appendLine(`Received variables response: ${JSON.stringify(response)}`)

					if (!response || !response.variables || !Array.isArray(response.variables)) {
						outputChannel.appendLine(
							`Invalid variables response for scope ${scope.name}: ${JSON.stringify(response)}`,
						)
						return {
							scopeName: scope.name,
							variables: [],
							error: `Invalid variables response from debug adapter for scope ${scope.name}`,
						}
					}

					// Apply filter if provided
					let filteredVariables = response.variables
					if (filter) {
						const filterRegex = new RegExp(filter, "i") // Case insensitive match
						filteredVariables = response.variables.filter((variable: { name: string }) =>
							filterRegex.test(variable.name),
						)
						outputChannel.appendLine(
							`Applied filter '${filter}', filtered from ${response.variables.length} to ${filteredVariables.length} variables`,
						)
					}

					return {
						scopeName: scope.name,
						variables: filteredVariables,
					}
				} catch (scopeError) {
					outputChannel.appendLine(
						`Error getting variables for scope ${scope.name}: ${
							scopeError instanceof Error ? scopeError.message : String(scopeError)
						}`,
					)
					return {
						scopeName: scope.name,
						variables: [],
						error: `Error getting variables: ${
							scopeError instanceof Error ? scopeError.message : String(scopeError)
						}`,
					}
				}
			}),
		)

		// Check if we got any variables at all
		const hasVariables = variablesByScope.some(
			(scope) => scope.variables && Array.isArray(scope.variables) && scope.variables.length > 0,
		)

		if (!hasVariables) {
			outputChannel.appendLine(
				`No variables found in any scope. This may be a limitation of the ${session.type} debug adapter or the current debugging context.`,
			)
		}

		return {
			content: [
				{
					type: "json",
					json: {
						sessionId,
						frameId,
						threadId,
						variablesByScope,
						filter: filter || undefined,
						debuggerType: session.type,
					},
				},
			],
			isError: false,
		}
	} catch (error) {
		outputChannel.appendLine(`Error in getStackFrameVariables: ${error instanceof Error ? error.message : String(error)}`)
		outputChannel.appendLine(`Error stack: ${error instanceof Error ? error.stack : "No stack available"}`)
		return {
			content: [
				{
					type: "text",
					text: `Error getting variables: ${
						error instanceof Error ? error.message : String(error)
					}. This may be a limitation of the ${session.type} debug adapter.`,
				},
			],
			isError: true,
		}
	}
}

// Zod schema for validating get_stack_frame_variables parameters.
export const getStackFrameVariablesSchema = z.object({
	sessionId: z.string().describe("The ID of the debug session."),
	frameId: z.number().describe("The ID of the stack frame to get variables from."),
	threadId: z.number().describe("The ID of the thread containing the stack frame."),
	filter: z.string().optional().describe("Optional filter pattern to match variable names."),
})
