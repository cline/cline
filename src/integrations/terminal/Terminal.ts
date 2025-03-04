import * as vscode from "vscode"

export class Terminal {
	public terminal: vscode.Terminal
	public busy: boolean
	public lastCommand: string
	public id: number
	public stream?: AsyncIterable<string>
	public running: boolean
	public streamClosed: boolean

	constructor(id: number, terminal: vscode.Terminal) {
		this.id = id
		this.terminal = terminal
		this.busy = false
		this.lastCommand = ""
		this.running = false
		this.streamClosed = false
	}
}
