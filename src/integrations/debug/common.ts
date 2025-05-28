import * as vscode from "vscode"
import { z } from "zod"

// Create an output channel for debugging
export const outputChannel = vscode.window.createOutputChannel("Debug Tools")

/** Event emitter for debug session start notifications */
export const sessionStartEventEmitter = new vscode.EventEmitter<vscode.DebugSession>()
export const onSessionStart = sessionStartEventEmitter.event

/** Maintain a list of active debug sessions. */
export const activeSessions: vscode.DebugSession[] = []

/** Store breakpoint hit information for notification */
export interface BreakpointHitInfo {
	sessionId: string
	sessionName: string
	threadId: number
	reason: string
	frameId?: number
	filePath?: string
	line?: number
	exceptionInfo?: {
		description: string
		details: string
	}
}

/**
 * Get the current call stack information for an active debug session.
 *
 * @param params - Object containing the sessionName to get call stack for.
 */
export const getCallStack = async (params: { sessionName?: string }) => {
	const { sessionName } = params

	// Get all active debug sessions or filter by name if provided
	let sessions = activeSessions
	if (sessionName) {
		sessions = activeSessions.filter((session) => session.name === sessionName)
		if (sessions.length === 0) {
			return {
				content: [
					{
						type: "text",
						text: `No debug session found with name '${sessionName}'.`,
					},
				],
				isError: true,
			}
		}
	}

	if (sessions.length === 0) {
		return {
			content: [
				{
					type: "text",
					text: "No active debug sessions found.",
				},
			],
			isError: true,
		}
	}

	try {
		// Get call stack information for each session
		const callStacks = await Promise.all(
			sessions.map(async (session) => {
				try {
					// Get all threads for the session
					const threads = await session.customRequest("threads")

					// Get stack traces for each thread
					const stackTraces = await Promise.all(
						threads.threads.map(async (thread: { id: number; name: string }) => {
							try {
								const stackTrace = await session.customRequest("stackTrace", {
									threadId: thread.id,
								})

								return {
									threadId: thread.id,
									threadName: thread.name,
									stackFrames: stackTrace.stackFrames.map((frame: any) => ({
										id: frame.id,
										name: frame.name,
										source: frame.source
											? {
													name: frame.source.name,
													path: frame.source.path,
												}
											: undefined,
										line: frame.line,
										column: frame.column,
									})),
								}
							} catch (error) {
								return {
									threadId: thread.id,
									threadName: thread.name,
									error: error instanceof Error ? error.message : String(error),
								}
							}
						}),
					)

					return {
						sessionId: session.id,
						sessionName: session.name,
						threads: stackTraces,
					}
				} catch (error) {
					return {
						sessionId: session.id,
						sessionName: session.name,
						error: error instanceof Error ? error.message : String(error),
					}
				}
			}),
		)

		return {
			content: [
				{
					type: "json",
					json: { callStacks },
				},
			],
			isError: false,
		}
	} catch (error) {
		return {
			content: [
				{
					type: "text",
					text: `Error getting call stack: ${error instanceof Error ? error.message : String(error)}`,
				},
			],
			isError: true,
		}
	}
}
// Zod schema for validating get_call_stack parameters.
export const getCallStackSchema = z.object({
	sessionName: z
		.string()
		.optional()
		.describe(
			"The name of the debug session to get call stack for. If not provided, returns call stacks for all active sessions.",
		),
})
// Track new debug sessions as they start.
vscode.debug.onDidStartDebugSession((session) => {
	activeSessions.push(session)
	outputChannel.appendLine(`Debug session started: ${session.name} (ID: ${session.id})`)
	outputChannel.appendLine(`Active sessions: ${activeSessions.length}`)
	sessionStartEventEmitter.fire(session)
})

// Remove debug sessions as they terminate.
vscode.debug.onDidTerminateDebugSession((session) => {
	const index = activeSessions.indexOf(session)
	if (index >= 0) {
		activeSessions.splice(index, 1)
		outputChannel.appendLine(`Debug session terminated: ${session.name} (ID: ${session.id})`)
		outputChannel.appendLine(`Active sessions: ${activeSessions.length}`)
	}
})

vscode.debug.onDidChangeActiveDebugSession((session) => {
	outputChannel.appendLine(`Active debug session changed: ${session ? session.name : "None"}`)
})
