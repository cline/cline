import * as vscode from "vscode"
import { z } from "zod"
import { activeSessions, getCallStack, outputChannel, onSessionStart, BreakpointHitInfo } from "./common"
import { getStackFrameVariables } from "./inspection"
import { DebugSessionOptions } from "vscode"
import { waitForBreakpointHit } from "./events"

/**
 * Helper function to wait for a debug session to stop and gather debug information.
 * This is used by both startDebugSession and resumeDebugSession when waitForStop is true.
 *
 * @param params - Object containing session information and options for waiting.
 * @returns A response object with debug information or error details.
 */
async function resolveBreakpointInfo(breakpointInfo: BreakpointHitInfo, variableFilter?: string[]) {
	try {
		// Get detailed call stack information
		const callStackResult = await getCallStack({ sessionName: breakpointInfo.sessionName })
		let callStackData = null
		if (!callStackResult.isError && "json" in callStackResult.content[0]) {
			callStackData = callStackResult.content[0].json
		}

		// Get variables for the top frame if we have a frameId
		let variablesData = null
		let variablesError = null
		if (breakpointInfo.frameId !== undefined && breakpointInfo.sessionId && breakpointInfo.threadId !== undefined) {
			outputChannel.appendLine(`Attempting to get variables for frameId ${breakpointInfo.frameId}`)

			// Find the actual session by name since breakpointInfo.sessionId is the VSCode session ID
			const activeSession = activeSessions.find((s) => s.name === breakpointInfo.sessionName)
			if (!activeSession) {
				variablesError = `Could not find active session with name: ${breakpointInfo.sessionName}`
				outputChannel.appendLine(variablesError)
			} else {
				try {
					const variablesResult = await getStackFrameVariables({
						sessionId: activeSession.id,
						frameId: breakpointInfo.frameId,
						threadId: breakpointInfo.threadId,
						filter: variableFilter ? variableFilter.join("|") : undefined,
					})

					if (!variablesResult.isError && "json" in variablesResult.content[0]) {
						variablesData = variablesResult.content[0].json
						outputChannel.appendLine(`Successfully retrieved variables: ${JSON.stringify(variablesData)}`)
					} else {
						// Capture the error message if there was one
						variablesError = variablesResult.isError
							? "text" in variablesResult.content[0]
								? variablesResult.content[0].text
								: "Unknown error"
							: "Invalid response format"
						outputChannel.appendLine(`Failed to get variables: ${variablesError}`)
					}
				} catch (error) {
					variablesError = error instanceof Error ? error.message : String(error)
					outputChannel.appendLine(`Exception getting variables: ${variablesError}`)
				}
			}
		} else {
			variablesError = "Missing required information for variable inspection"
			outputChannel.appendLine(
				`Cannot get variables: ${variablesError} - frameId: ${breakpointInfo.frameId}, sessionId: ${breakpointInfo.sessionId}, threadId: ${breakpointInfo.threadId}`,
			)
		}

		// Construct a comprehensive response with all the debug information
		const debugInfo = {
			breakpoint: breakpointInfo,
			callStack: callStackData,
			variables: variablesData,
			variablesError: variablesError,
		}

		return {
			content: [
				{
					type: "text",
					text: `Debug session ${breakpointInfo.sessionName} stopped at ${
						breakpointInfo.reason === "breakpoint" ? "a breakpoint" : `due to ${breakpointInfo.reason}`
					}.`,
				},
				{
					type: "text",
					text: JSON.stringify(debugInfo),
				},
			],
			isError: false,
		}
	} catch (error) {
		return {
			content: [
				{ type: "text", text: `Debug session ${breakpointInfo.sessionName} stopped successfully.` },
				{
					type: "text",
					text: `Warning: Failed to wait for debug session to stop: ${
						error instanceof Error ? error.message : String(error)
					}`,
				},
			],
			isError: false,
		}
	}
}

/**
 * List all active debug sessions in the workspace.
 *
 * Exposes debug session information, including each session's ID, name, and associated launch configuration.
 */
export const listDebugSessions = () => {
	// Retrieve all active debug sessions using the activeSessions array.
	const sessions = activeSessions.map((session: vscode.DebugSession) => ({
		id: session.id,
		name: session.name,
		configuration: session.configuration,
	}))

	// Return session list
	return {
		content: [
			{
				type: "json",
				json: { sessions },
			},
		],
		isError: false,
	}
}

// Zod schema for validating tool parameters (none for this tool).
export const listDebugSessionsSchema = z.object({})

/**
 * Start a new debug session using either a named configuration from .vscode/launch.json or a direct configuration object,
 * then wait until a breakpoint is hit before returning with detailed debug information.
 *
 * @param params - Object containing workspaceFolder, nameOrConfiguration, and optional variableFilter.
 */
export const startDebuggingAndWaitForStop = async (params: {
	workspaceFolder: string
	nameOrConfiguration: string | { type: string; request: string; name: string; [key: string]: any }
	variableFilter?: string[]
	timeout_seconds?: number
	breakpointConfig?: {
		disableExisting?: boolean
		breakpoints?: Array<{ path: string; line: number }>
	}
}) => {
	const { workspaceFolder, nameOrConfiguration, variableFilter, timeout_seconds = 60, breakpointConfig } = params
	// Ensure that workspace folders exist and are accessible.
	const workspaceFolders = vscode.workspace.workspaceFolders
	if (!workspaceFolders || workspaceFolders.length === 0) {
		throw new Error("No workspace folders are currently open.")
	}

	const folder = workspaceFolders.find((f) => f.uri?.fsPath === workspaceFolder)
	if (!folder) {
		throw new Error(`Workspace folder '${workspaceFolder}' not found.`)
	}

	// Generate session name and ID based on the type of nameOrConfiguration
	const sessionName = typeof nameOrConfiguration === "string" ? nameOrConfiguration : nameOrConfiguration.name
	const sessionId =
		typeof nameOrConfiguration === "object" && nameOrConfiguration.sessionId
			? nameOrConfiguration.sessionId
			: `debug_${sessionName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

	// Handle breakpoint configuration if provided
	if (breakpointConfig) {
		// Disable existing breakpoints if requested
		if (breakpointConfig.disableExisting) {
			const allBreakpoints = vscode.debug.breakpoints
			if (allBreakpoints.length > 0) {
				await vscode.debug.removeBreakpoints(allBreakpoints)
			}
		}

		// Add new breakpoints if provided
		if (breakpointConfig.breakpoints && breakpointConfig.breakpoints.length > 0) {
			const newBreakpoints = breakpointConfig.breakpoints.map((bp) => {
				const uri = vscode.Uri.file(bp.path.startsWith("/") ? bp.path : `${workspaceFolder}/${bp.path}`)
				const location = new vscode.Position(bp.line - 1, 0) // VSCode uses 0-based line numbers
				return new vscode.SourceBreakpoint(new vscode.Location(uri, location))
			})
			await vscode.debug.addBreakpoints(newBreakpoints)
		}
	}

	// Set up the listener before starting the session to avoid race condition
	const stopPromise = waitForBreakpointHit({
		sessionId,
		timeout: timeout_seconds * 1000, // Convert seconds to milliseconds
	})

	const success = await vscode.debug.startDebugging(folder, nameOrConfiguration, {
		id: sessionId,
	} as DebugSessionOptions)

	if (!success) {
		throw new Error(`Failed to start debug session '${sessionName}'.`)
	}

	// Always wait for the debug session to stop at a breakpoint with timeout
	let breakpointHitResult
	try {
		breakpointHitResult = await stopPromise
	} catch (error) {
		if (error instanceof Error && error.message.includes("Timeout")) {
			return {
				content: [
					{
						type: "text",
						text: `Debug session '${sessionName}' timed out after ${timeout_seconds} seconds waiting for a breakpoint to be hit.`,
					},
				],
				isError: true,
			}
		}
		throw error
	}

	// If we got a successful breakpoint hit, resolve it to get full debug information
	if (!breakpointHitResult.isError && breakpointHitResult.content[0].type === "text") {
		try {
			const breakpointInfo = JSON.parse(breakpointHitResult.content[0].text) as BreakpointHitInfo
			// Get the full debug information including call stack and variables
			return await resolveBreakpointInfo(breakpointInfo, variableFilter)
		} catch (error) {
			// If parsing fails, return the original result
			return breakpointHitResult
		}
	}

	return breakpointHitResult
}

// Zod schema for validating startDebuggingAndWaitForStop parameters.
export const startDebuggingAndWaitForStopSchema = z.object({
	workspaceFolder: z.string().describe("The workspace folder where the debug session should start."),
	nameOrConfiguration: z
		.union([
			z.string().describe("Name of a debug configuration from .vscode/launch.json"),
			z
				.object({
					type: z.string().describe("Type of the debugger (e.g., 'node', 'python', etc.)."),
					request: z.string().describe("Type of debug request (e.g., 'launch' or 'attach')."),
					name: z.string().describe("Name of the debug session."),
				})
				.passthrough()
				.describe("The debug configuration object."),
		])
		.describe("Either the name of a debug configuration or a debug configuration object."),
	variableFilter: z
		.array(z.string())
		.optional()
		.describe(
			"Array of variable names to filter. When provided, only variables matching these names will be included in the response. This helps reduce token usage for LLM consumption.",
		),
	timeout_seconds: z
		.number()
		.optional()
		.default(60)
		.describe("Maximum time in seconds to wait for a breakpoint to be hit. Defaults to 60 seconds."),
	breakpointConfig: z
		.object({
			disableExisting: z
				.boolean()
				.optional()
				.describe("If true, disables all existing breakpoints before adding new ones."),
			breakpoints: z
				.array(
					z.object({
						path: z.string().describe("Path to the file where the breakpoint should be set."),
						line: z.number().describe("Line number where the breakpoint should be set (1-based)."),
					}),
				)
				.optional()
				.describe("Array of breakpoints to set before starting the debug session."),
		})
		.optional()
		.describe("Configuration for managing breakpoints when starting the debug session."),
})

/**
 * Stop debug sessions that match the provided session name.
 *
 * @param params - Object containing the sessionName to stop.
 */
export const stopDebugSession = async (params: { sessionName: string }) => {
	const { sessionName } = params
	// Filter active sessions to find matching sessions.
	const matchingSessions = activeSessions.filter((session: vscode.DebugSession) => session.name === sessionName)

	if (matchingSessions.length === 0) {
		return {
			content: [
				{
					type: "text",
					text: `No debug session(s) found with name '${sessionName}'.`,
				},
			],
			isError: true,
		}
	}

	// Stop each matching debug session.
	for (const session of matchingSessions) {
		await vscode.debug.stopDebugging(session)
	}

	return {
		content: [
			{
				type: "text",
				text: `Stopped debug session(s) with name '${sessionName}'.`,
			},
		],
		isError: false,
	}
}

// Zod schema for validating stop_debug_session parameters.
export const stopDebugSessionSchema = z.object({
	sessionName: z.string().describe("The name of the debug session(s) to stop."),
})

/**
 * Resume execution of a debug session that has been paused (e.g., by a breakpoint).
 *
 * @param params - Object containing the sessionId of the debug session to resume and optional waitForStop flag.
 */
export const resumeDebugSession = async (params: {
	sessionId: string
	waitForStop?: boolean
	breakpointConfig?: {
		disableExisting?: boolean
		breakpoints?: Array<{ path: string; line: number }>
	}
}) => {
	const { sessionId, waitForStop = false, breakpointConfig } = params

	// Find the session with the given ID
	let session = activeSessions.find((s) => s.id === sessionId)

	// If not found by ID, try to find by name pattern (VSCode creates child sessions with modified names)
	if (!session) {
		// Look for a session whose name contains the session ID
		session = activeSessions.find((s) => s.name.includes(sessionId))
	}

	// If still not found, look for any active session as a last resort
	if (!session && activeSessions.length === 1) {
		session = activeSessions[0]
		outputChannel.appendLine(
			`Warning: Could not find session with ID '${sessionId}', using the only active session: ${session.name}`,
		)
	}

	if (!session) {
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
		// Handle breakpoint configuration if provided
		if (breakpointConfig) {
			// Disable existing breakpoints if requested
			if (breakpointConfig.disableExisting) {
				const allBreakpoints = vscode.debug.breakpoints
				if (allBreakpoints.length > 0) {
					await vscode.debug.removeBreakpoints(allBreakpoints)
				}
			}

			// Add new breakpoints if provided
			if (breakpointConfig.breakpoints && breakpointConfig.breakpoints.length > 0) {
				// Get workspace folder from session configuration
				const workspaceFolder = session.workspaceFolder?.uri.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
				if (!workspaceFolder) {
					throw new Error("Cannot determine workspace folder for breakpoint paths")
				}

				const newBreakpoints = breakpointConfig.breakpoints.map((bp) => {
					const uri = vscode.Uri.file(bp.path.startsWith("/") ? bp.path : `${workspaceFolder}/${bp.path}`)
					const location = new vscode.Position(bp.line - 1, 0) // VSCode uses 0-based line numbers
					return new vscode.SourceBreakpoint(new vscode.Location(uri, location))
				})
				await vscode.debug.addBreakpoints(newBreakpoints)
			}
		}

		// Send the continue request to the debug adapter
		outputChannel.appendLine(`Resuming debug session '${session.name}' (ID: ${sessionId})`)
		const stopPromise = waitForBreakpointHit({
			sessionId,
		})
		await session.customRequest("continue", { threadId: 0 }) // 0 means all threads
		if (waitForStop) {
			const stopResult = await stopPromise

			// If waitForStop is true, wait for the debug session to stop at a breakpoint or other stopping point

			return await resolveBreakpointInfo({
				sessionId,
				sessionName: session.name,
				threadId: 0,
				reason: "resumed",
			})
		}

		// If not waiting for stop, return immediately
		return {
			content: [
				{
					type: "text",
					text: `Resumed debug session '${session.name}'.`,
				},
			],
			isError: false,
		}
	} catch (error) {
		return {
			content: [
				{
					type: "text",
					text: `Error resuming debug session: ${error instanceof Error ? error.message : String(error)}`,
				},
			],
			isError: true,
		}
	}
}

// Zod schema for validating resume_debug_session parameters.
export const resumeDebugSessionSchema = z.object({
	sessionId: z.string().describe("The ID of the debug session to resume."),
	waitForStop: z
		.boolean()
		.optional()
		.default(false)
		.describe(
			"If true, the tool will wait until a breakpoint is hit or the debugger otherwise stops before returning. Provides detailed information about the stopped state.",
		),
	breakpointConfig: z
		.object({
			disableExisting: z
				.boolean()
				.optional()
				.describe("If true, disables all existing breakpoints before adding new ones."),
			breakpoints: z
				.array(
					z.object({
						path: z.string().describe("Path to the file where the breakpoint should be set."),
						line: z.number().describe("Line number where the breakpoint should be set (1-based)."),
					}),
				)
				.optional()
				.describe("Array of breakpoints to set before resuming the debug session."),
		})
		.optional()
		.describe("Configuration for managing breakpoints when resuming the debug session."),
})
