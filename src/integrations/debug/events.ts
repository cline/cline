import * as vscode from "vscode"
import { z } from "zod"
import { activeSessions, BreakpointHitInfo, getCallStack, outputChannel } from "./common"

/** Event emitter for breakpoint hit notifications */
export const breakpointEventEmitter = new vscode.EventEmitter<BreakpointHitInfo>()
export const onBreakpointHit = breakpointEventEmitter.event

// Register debug adapter tracker to monitor debug events
vscode.debug.registerDebugAdapterTrackerFactory("*", {
	createDebugAdapterTracker: (session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterTracker> => {
		// Create a class that implements the DebugAdapterTracker interface
		class DebugAdapterTrackerImpl implements vscode.DebugAdapterTracker {
			onWillStartSession?(): void {
				outputChannel.appendLine(`Debug session starting: ${session.name}`)
			}

			onWillReceiveMessage?(message: any): void {
				// Optional: Log messages being received by the debug adapter
				outputChannel.appendLine(`Message received by debug adapter: ${JSON.stringify(message)}`)
			}

			onDidSendMessage(message: any): void {
				// Log all messages sent from the debug adapter to VS Code
				if (message.type === "event") {
					const event = message
					// The 'stopped' event is fired when execution stops (e.g., at a breakpoint or exception)
					if (event.event === "stopped") {
						const body = event.body
						// Process any stop event - including breakpoints, exceptions, and other stops
						const validReasons = ["breakpoint", "step", "pause", "exception", "assertion", "entry"]

						if (validReasons.includes(body.reason)) {
							// Use existing getCallStack function to get thread and stack information
							;(async () => {
								try {
									// Collect exception details if this is an exception
									let exceptionDetails = undefined
									if (body.reason === "exception" && body.description) {
										exceptionDetails = {
											description: body.description || "Unknown exception",
											details: body.text || "No additional details available",
										}
									}

									// Get call stack information for the session
									const callStackResult = await getCallStack({ sessionName: session.name })

									if (callStackResult.isError) {
										// If we couldn't get call stack, emit basic event
										breakpointEventEmitter.fire({
											sessionId: session.id,
											sessionName: session.name,
											threadId: body.threadId,
											reason: body.reason,
											exceptionInfo: exceptionDetails,
										})
										return
									}
									if (!("json" in callStackResult.content[0])) {
										// If the content is not JSON, emit basic event
										breakpointEventEmitter.fire({
											sessionId: session.id,
											sessionName: session.name,
											threadId: body.threadId,
											reason: body.reason,
											exceptionInfo: exceptionDetails,
										})
										return
									}
									// Extract call stack data from the result
									const callStackData = callStackResult.content[0].json?.callStacks[0]
									if (!("threads" in callStackData)) {
										// If threads are not present, emit basic event
										breakpointEventEmitter.fire({
											sessionId: session.id,
											sessionName: session.name,
											threadId: body.threadId,
											reason: body.reason,
											exceptionInfo: exceptionDetails,
										})
										return
									}
									// If threads are present, find the one that matches the threadId
									if (!Array.isArray(callStackData.threads)) {
										breakpointEventEmitter.fire({
											sessionId: session.id,
											sessionName: session.name,
											threadId: body.threadId,
											reason: body.reason,
											exceptionInfo: exceptionDetails,
										})
										return
									}
									// Find the thread that triggered the event
									const threadData = callStackData.threads.find((t: any) => t.threadId === body.threadId)

									if (!threadData || !threadData.stackFrames || threadData.stackFrames.length === 0) {
										// If thread or stack frames not found, emit basic event
										breakpointEventEmitter.fire({
											sessionId: session.id,
											sessionName: session.name,
											threadId: body.threadId,
											reason: body.reason,
											exceptionInfo: exceptionDetails,
										})
										return
									}

									// Get the top stack frame
									const topFrame = threadData.stackFrames[0]

									// Emit breakpoint/exception hit event with stack frame information
									const eventData = {
										sessionId: session.id,
										sessionName: session.name,
										threadId: body.threadId,
										reason: body.reason,
										frameId: topFrame.id,
										filePath: topFrame.source?.path,
										line: topFrame.line,
										exceptionInfo: exceptionDetails,
									}

									outputChannel.appendLine(`Firing breakpoint event: ${JSON.stringify(eventData)}`)
									breakpointEventEmitter.fire(eventData)
								} catch (error) {
									console.error("Error processing debug event:", error)
									// Still emit event with basic info
									const exceptionDetails =
										body.reason === "exception"
											? {
													description: body.description || "Unknown exception",
													details: body.text || "No details available",
												}
											: undefined

									breakpointEventEmitter.fire({
										sessionId: session.id,
										sessionName: session.name,
										threadId: body.threadId,
										reason: body.reason,
										exceptionInfo: exceptionDetails,
									})
								}
							})()
						}
					}
				}
				outputChannel.appendLine(`Message from debug adapter: ${JSON.stringify(message)}`)
			}

			onWillSendMessage(message: any): void {
				// Log all messages sent to the debug adapter
				outputChannel.appendLine(`Message sent to debug adapter: ${JSON.stringify(message)}`)
			}

			onDidReceiveMessage(message: any): void {
				// Log all messages received from the debug adapter
				outputChannel.appendLine(`Message received from debug adapter: ${JSON.stringify(message)}`)
			}

			onError?(error: Error): void {
				outputChannel.appendLine(`Debug adapter error: ${error.message}`)
			}

			onExit?(code: number | undefined, signal: string | undefined): void {
				outputChannel.appendLine(`Debug adapter exited: code=${code}, signal=${signal}`)
			}
		}

		return new DebugAdapterTrackerImpl()
	},
})

/**
 * Wait for a breakpoint to be hit in a debug session.
 *
 * @param params - Object containing sessionId or sessionName to identify the debug session, and optional timeout.
 */
export const waitForBreakpointHit = async (params: { sessionId?: string; sessionName?: string; timeout?: number }) => {
	const { sessionId, sessionName, timeout = 30000 } = params // Default timeout: 30 seconds

	try {
		// Create a promise that resolves when a breakpoint is hit
		const breakpointHitPromise = new Promise<BreakpointHitInfo>((resolve, reject) => {
			const availableSessions = activeSessions
			// Use the breakpointEventEmitter which is already wired up to the debug adapter tracker
			const listener = onBreakpointHit((event) => {
				// Check if this event is for one of our target sessions
				outputChannel.appendLine(
					`Breakpoint hit detected for waitForBreakpointHit for session ${event.sessionName} with id ${event.sessionId}`,
				)
				let targetSession: vscode.DebugSession | undefined

				if (sessionId) {
					const session = availableSessions.find((s) => s.configuration.sessionId === sessionId)
					if (session) {
						targetSession = session
					}
				} else if (sessionName) {
					targetSession = availableSessions.find((s) => s.name === sessionName)
				} else {
					targetSession = availableSessions[0] // All active sessions if neither ID nor name provided
				}
				if (targetSession !== undefined) {
					// If it is, clean up the listener and resolve the promise
					listener.dispose()
					resolve(event)
					outputChannel.appendLine(`Breakpoint hit detected for waitForBreakpointHit: ${JSON.stringify(event)}`)
				} else {
					outputChannel.appendLine(
						`Breakpoint hit detected for waitForBreakpointHit for session ${event.sessionName} with id ${event.sessionId} but that session was not in the target sessions: ${JSON.stringify(targetSession)}`,
					)
				}
			})

			// Set a timeout to prevent blocking indefinitely
			setTimeout(() => {
				listener.dispose()
				reject(new Error(`Timed out waiting for breakpoint to be hit (${timeout}ms).`))
			}, timeout)
		})

		// Wait for the breakpoint to be hit or timeout
		const result = await breakpointHitPromise

		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify(result),
				},
			],
			isError: false,
		}
	} catch (error) {
		return {
			content: [
				{
					type: "text" as const,
					text: `Error waiting for breakpoint: ${error instanceof Error ? error.message : String(error)}`,
				},
			],
			isError: true,
		}
	}
}

/**
 * Provides a way for MCP clients to subscribe to breakpoint hit events.
 * This tool returns immediately with a subscription ID, and the MCP client
 * will receive notifications when breakpoints are hit.
 *
 * @param params - Object containing an optional filter for the debug sessions to monitor.
 */
export const subscribeToBreakpointEvents = async (params: { sessionId?: string; sessionName?: string }) => {
	const { sessionId, sessionName } = params

	// Generate a unique subscription ID
	const subscriptionId = `breakpoint-subscription-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

	// Return immediately with subscription info
	return {
		content: [
			{
				type: "json",
				json: {
					subscriptionId,
					message: "Subscribed to breakpoint events. You will receive notifications when breakpoints are hit.",
				},
			},
		],
		isError: false,
		// Special metadata to indicate this is a subscription
		_meta: {
			subscriptionId,
			type: "breakpoint-events",
			filter: { sessionId, sessionName },
		},
	}
}

// Zod schema for validating subscribe_to_breakpoint_events parameters.
export const subscribeToBreakpointEventsSchema = z.object({
	sessionId: z.string().optional().describe("Filter events to this specific debug session ID."),
	sessionName: z.string().optional().describe("Filter events to debug sessions with this name."),
})

// Zod schema for validating wait_for_breakpoint_hit parameters.
export const waitForBreakpointHitSchema = z.object({
	sessionId: z.string().optional().describe("The ID of the debug session to wait for a breakpoint hit."),
	sessionName: z.string().optional().describe("The name of the debug session to wait for a breakpoint hit."),
	timeout: z.number().optional().describe("Timeout in milliseconds to wait for a breakpoint hit. Default: 30000 (30 seconds)."),
})
