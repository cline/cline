import * as vscode from "vscode"

interface DebugSession {
	id: string
	name: string
	output: string[]
	lastRetrievedIndex: number
}

export class DebugConsoleManager {
	private sessions: Map<string, DebugSession> = new Map()
	private disposables: vscode.Disposable[] = []

	constructor() {
		// Listen for debug session start events
		this.disposables.push(
			vscode.debug.onDidStartDebugSession((session) => {
				this.sessions.set(session.id, {
					id: session.id,
					name: session.name,
					output: [],
					lastRetrievedIndex: -1,
				})
			}),
		)

		// Listen for debug session end events
		this.disposables.push(
			vscode.debug.onDidTerminateDebugSession((session) => {
				this.sessions.delete(session.id)
			}),
		)

		// Listen for debug console output
		this.disposables.push(
			vscode.debug.onDidReceiveDebugSessionCustomEvent((e: vscode.DebugSessionCustomEvent) => {
				if (e.event === "output" && e.body?.output) {
					const session = this.sessions.get(e.session.id)
					if (session) {
						session.output.push(e.body.output)
					}
				}
			}),
		)
	}

	/**
	 * Get all active debug sessions
	 */
	getActiveSessions(): { id: string; name: string }[] {
		return Array.from(this.sessions.values()).map(({ id, name }) => ({ id, name }))
	}

	/**
	 * Get any new output since the last retrieval for a specific debug session
	 */
	getUnretrievedOutput(sessionId: string): string | undefined {
		const session = this.sessions.get(sessionId)
		if (!session) {
			return undefined
		}

		const newOutput = session.output.slice(session.lastRetrievedIndex + 1).join("")
		session.lastRetrievedIndex = session.output.length - 1
		return newOutput || undefined
	}

	/**
	 * Clean up resources
	 */
	dispose() {
		this.disposables.forEach((d) => d.dispose())
		this.sessions.clear()
	}
}
