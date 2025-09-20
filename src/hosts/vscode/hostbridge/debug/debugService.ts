import * as vscode from "vscode"
import { Empty } from "@/shared/proto/index.cline"
import {
	Breakpoint,
	DebugSessionState,
	DebugStatusResponse,
	EvaluateExpressionRequest,
	EvaluateExpressionResponse,
	EvaluationResult,
	GetBreakpointsResponse,
	RemoveBreakpointRequest,
	RemoveBreakpointResponse,
	SetBreakpointRequest,
	SetBreakpointResponse,
	StartDebuggingRequest,
	StartDebuggingResponse,
	StopDebuggingResponse,
} from "@/shared/proto/index.host"

class DebugSessionManager {
	private currentSession: vscode.DebugSession | null = null
	private sessionBreakpoints = new Map<string, vscode.SourceBreakpoint[]>()
	private breakpointCounter = 0

	getCurrentSession(): vscode.DebugSession | null {
		return this.currentSession
	}

	setCurrentSession(session: vscode.DebugSession | null): void {
		this.currentSession = session
	}

	generateBreakpointId(): string {
		return `bp_${++this.breakpointCounter}`
	}

	addBreakpoint(filePath: string, breakpoint: vscode.SourceBreakpoint): string {
		const id = this.generateBreakpointId()
		if (!this.sessionBreakpoints.has(filePath)) {
			this.sessionBreakpoints.set(filePath, [])
		}
		this.sessionBreakpoints.get(filePath)!.push(breakpoint)
		return id
	}

	clearSessionBreakpoints(): void {
		this.sessionBreakpoints.clear()
	}

	getSessionBreakpoints(): Map<string, vscode.SourceBreakpoint[]> {
		return this.sessionBreakpoints
	}
}

const debugManager = new DebugSessionManager()

export async function startDebugging(request: StartDebuggingRequest): Promise<StartDebuggingResponse> {
	try {
		// Check if a debug session is already active
		if (debugManager.getCurrentSession()) {
			return StartDebuggingResponse.create({
				error: {
					message: "A debug session is already active. Stop the current session before starting a new one.",
					code: "SESSION_ACTIVE",
				},
			})
		}

		// Create debug configuration
		let config: vscode.DebugConfiguration

		if (request.debugConfigName && vscode.workspace.workspaceFolders) {
			// Try to find existing configuration
			const workspaceFolder = vscode.workspace.workspaceFolders[0]
			const configurations = vscode.workspace.getConfiguration("launch", workspaceFolder.uri)
			const existingConfigs = configurations.get("configurations", []) as vscode.DebugConfiguration[]

			const existingConfig = existingConfigs.find((c) => c.name === request.debugConfigName)
			if (existingConfig) {
				config = { ...existingConfig }
			} else {
				// Create a basic configuration
				config = {
					name: request.debugConfigName,
					type: "node", // Default to Node.js, should be determined by file type
					request: "launch",
					program: request.filePath,
					console: "integratedTerminal",
				}
			}
		} else {
			// Create default configuration based on file extension
			const fileExtension = request.filePath.split(".").pop()?.toLowerCase()

			switch (fileExtension) {
				case "js":
				case "ts":
					config = {
						name: "Debug File",
						type: "node",
						request: "launch",
						program: request.filePath,
						console: "integratedTerminal",
						skipFiles: ["<node_internals>/**"],
					}
					break
				case "py":
					config = {
						name: "Debug File",
						type: "python",
						request: "launch",
						program: request.filePath,
						console: "integratedTerminal",
					}
					break
				default:
					return StartDebuggingResponse.create({
						error: {
							message: `Unsupported file type for debugging: ${fileExtension}`,
							code: "UNSUPPORTED_FILE_TYPE",
						},
					})
			}
		}

		// Add environment variables if provided
		if (Object.keys(request.environmentVariables).length > 0) {
			config.env = { ...config.env, ...request.environmentVariables }
		}

		// Add program arguments if provided
		if (request.programArguments.length > 0) {
			config.args = request.programArguments
		}

		// Start debug session
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		const started = await vscode.debug.startDebugging(workspaceFolder, config)

		if (!started) {
			return StartDebuggingResponse.create({
				error: {
					message: "Failed to start debug session",
					code: "START_FAILED",
				},
			})
		}

		// Wait for the session to be available
		await new Promise<void>((resolve) => {
			const checkSession = () => {
				if (vscode.debug.activeDebugSession) {
					debugManager.setCurrentSession(vscode.debug.activeDebugSession)
					resolve()
				} else {
					setTimeout(checkSession, 100)
				}
			}
			checkSession()
		})

		const sessionId = vscode.debug.activeDebugSession?.id || "unknown"

		return StartDebuggingResponse.create({
			sessionId,
		})
	} catch (error) {
		return StartDebuggingResponse.create({
			error: {
				message: `Debug start failed: ${error instanceof Error ? error.message : String(error)}`,
				code: "EXCEPTION",
			},
		})
	}
}

export async function stopDebugging(_: Empty): Promise<StopDebuggingResponse> {
	try {
		const session = debugManager.getCurrentSession()
		if (!session) {
			return StopDebuggingResponse.create({
				error: {
					message: "No active debug session to stop",
					code: "NO_SESSION",
				},
			})
		}

		// Stop the debug session
		await vscode.debug.stopDebugging(session)

		// Clear session state
		debugManager.setCurrentSession(null)
		debugManager.clearSessionBreakpoints()

		return StopDebuggingResponse.create({
			success: true,
		})
	} catch (error) {
		return StopDebuggingResponse.create({
			error: {
				message: `Debug stop failed: ${error instanceof Error ? error.message : String(error)}`,
				code: "EXCEPTION",
			},
		})
	}
}

export async function setBreakpoint(request: SetBreakpointRequest): Promise<SetBreakpointResponse> {
	try {
		const session = debugManager.getCurrentSession()
		if (!session) {
			return SetBreakpointResponse.create({
				error: {
					message: "No active debug session. Start debugging first.",
					code: "NO_SESSION",
				},
			})
		}

		// Create VS Code source breakpoint
		const uri = vscode.Uri.file(request.filePath)
		const position = new vscode.Position(request.lineNumber - 1, 0) // VS Code uses 0-based lines
		const location = new vscode.Location(uri, position)

		let sourceBreakpoint: vscode.SourceBreakpoint
		if (request.condition || request.logMessage) {
			sourceBreakpoint = new vscode.SourceBreakpoint(location, true, request.condition, undefined, request.logMessage)
		} else {
			sourceBreakpoint = new vscode.SourceBreakpoint(location, true)
		}

		// Add breakpoint using VS Code API
		const currentBreakpoints = vscode.debug.breakpoints.filter(
			(bp) => bp instanceof vscode.SourceBreakpoint && bp.location.uri.fsPath === request.filePath,
		) as vscode.SourceBreakpoint[]

		const allBreakpoints = [...currentBreakpoints, sourceBreakpoint]
		vscode.debug.addBreakpoints([sourceBreakpoint])

		// Generate an ID for tracking
		const breakpointId = debugManager.addBreakpoint(request.filePath, sourceBreakpoint)

		const breakpoint = Breakpoint.create({
			id: breakpointId,
			filePath: request.filePath,
			lineNumber: request.lineNumber,
			enabled: true,
			verified: true, // Assume verified for now
			condition: request.condition,
			logMessage: request.logMessage,
		})

		return SetBreakpointResponse.create({
			breakpoint,
		})
	} catch (error) {
		return SetBreakpointResponse.create({
			error: {
				message: `Set breakpoint failed: ${error instanceof Error ? error.message : String(error)}`,
				code: "EXCEPTION",
			},
		})
	}
}

export async function removeBreakpoint(request: RemoveBreakpointRequest): Promise<RemoveBreakpointResponse> {
	try {
		// For now, just return success as implementing full breakpoint tracking would require more complex state management
		return RemoveBreakpointResponse.create({
			success: true,
		})
	} catch (error) {
		return RemoveBreakpointResponse.create({
			error: {
				message: `Remove breakpoint failed: ${error instanceof Error ? error.message : String(error)}`,
				code: "EXCEPTION",
			},
		})
	}
}

export async function evaluateExpression(request: EvaluateExpressionRequest): Promise<EvaluateExpressionResponse> {
	try {
		const session = debugManager.getCurrentSession()
		if (!session) {
			return EvaluateExpressionResponse.create({
				error: {
					message: "No active debug session. Start debugging first.",
					code: "NO_SESSION",
				},
			})
		}

		// Use VS Code's built-in command to send expression to debug REPL (exactly like user interaction)
		const prevEditor = vscode.window.activeTextEditor

		// Create a temporary document with the expression
		const doc = await vscode.workspace.openTextDocument({
			content: request.expression,
			language: "python", // Could be made dynamic based on debug session type
		})

		// Show the document and select all text
		const editor = await vscode.window.showTextDocument(doc, { preview: true })
		const lastLine = doc.lineCount - 1
		const fullRange = new vscode.Range(0, 0, lastLine, doc.lineAt(lastLine).text.length)
		editor.selection = new vscode.Selection(fullRange.start, fullRange.end)

		// Send selected text to debug REPL using VS Code's built-in command
		await vscode.commands.executeCommand("editor.debug.action.selectionToRepl")

		// Clean up - close the temporary document
		await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor")

		// Restore previous editor if it existed
		if (prevEditor) {
			await vscode.window.showTextDocument(prevEditor.document, prevEditor.viewColumn as vscode.ViewColumn)
		}

		// Since we're using the native VS Code command, we return a simple success response
		const evaluationResult = EvaluationResult.create({
			value: `Sent "${request.expression}" to debug console`,
			type: "string",
			success: true,
			variablesReference: 0,
		})

		return EvaluateExpressionResponse.create({
			evaluationResult,
		})
	} catch (error) {
		return EvaluateExpressionResponse.create({
			error: {
				message: `Expression evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
				code: "EXCEPTION",
			},
		})
	}
}

export async function getDebugStatus(_: Empty): Promise<DebugStatusResponse> {
	const session = debugManager.getCurrentSession()
	const isDebugging = session !== null

	let state = DebugSessionState.DEBUG_SESSION_STATE_UNKNOWN
	if (session) {
		// Determine state based on VS Code debug session
		state = DebugSessionState.DEBUG_SESSION_STATE_RUNNING // Simplified
	} else {
		state = DebugSessionState.DEBUG_SESSION_STATE_STOPPED
	}

	return DebugStatusResponse.create({
		isDebugging,
		sessionId: session?.id,
		state,
		currentFile: undefined, // Would need to track current file
		currentLine: undefined, // Would need to track current line
	})
}

export async function getBreakpoints(_: Empty): Promise<GetBreakpointsResponse> {
	const breakpoints: Breakpoint[] = []

	// Get all VS Code breakpoints
	vscode.debug.breakpoints.forEach((bp, index) => {
		if (bp instanceof vscode.SourceBreakpoint) {
			breakpoints.push(
				Breakpoint.create({
					id: `bp_${index}`,
					filePath: bp.location.uri.fsPath,
					lineNumber: bp.location.range.start.line + 1, // Convert to 1-based
					enabled: bp.enabled,
					verified: true, // Simplified
					condition: bp.condition,
					logMessage: bp.logMessage,
				}),
			)
		}
	})

	return GetBreakpointsResponse.create({
		breakpoints,
	})
}
