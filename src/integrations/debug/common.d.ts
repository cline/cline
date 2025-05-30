import * as vscode from "vscode"
export declare const outputChannel: vscode.OutputChannel
export declare const activeSessions: vscode.DebugSession[]
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
export declare const getCallStack: (params: { sessionName?: string }) => Promise<
	| {
			content: {
				type: string
				text: string
			}[]
			isError: boolean
	  }
	| {
			content: {
				type: string
				json: {
					callStacks: (
						| {
								sessionId: string
								sessionName: string
								threads: any[]
								error?: undefined
						  }
						| {
								sessionId: string
								sessionName: string
								error: string
								threads?: undefined
						  }
					)[]
				}
			}[]
			isError: boolean
	  }
>
