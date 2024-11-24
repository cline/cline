import { EventEmitter } from "events"
import stripAnsi from "strip-ansi"
import * as vscode from "vscode"

const SPECIAL_KEYS = {
    ENTER: '\r',
    UP: '\x1b[A',
    DOWN: '\x1b[B',
    RIGHT: '\x1b[C',
    LEFT: '\x1b[D',
    SPACE: ' ',
} as const;

export interface TerminalProcessEvents {
	line: [line: string]
	continue: []
	completed: []
	error: [error: Error]
	no_shell_integration: []
	ready: [{ type: string; url?: string }]
	waiting_for_input: []
	check_state: [{ timeLeft: number }]
}

export class TerminalProcess extends EventEmitter<TerminalProcessEvents> {
	waitForShellIntegration: boolean = true
	private isListening: boolean = true
	private buffer: string = ""
	private currentCommand: string = ""
	private currentOutput: string = ""
	private fullOutput: string = ""
	private lastRetrievedIndex: number = 0
	private countdownTimer: NodeJS.Timeout | null = null
	private timeLeft: number = 10
	isHot: boolean = true

	async run(terminal: vscode.Terminal, command: string) {
		this.currentCommand = command
		this.currentOutput = ""
		this.timeLeft = 10

		// Handle special key inputs
		if (command === "Enter") {
			terminal.sendText(SPECIAL_KEYS.ENTER, false);
			return;
		} else if (command === "ArrowUp") {
			terminal.sendText(SPECIAL_KEYS.UP, false);
			return;
		} else if (command === "ArrowDown") {
			terminal.sendText(SPECIAL_KEYS.DOWN, false);
			return;
		} else if (command === "ArrowRight") {
			terminal.sendText(SPECIAL_KEYS.RIGHT, false);
			return;
		} else if (command === "ArrowLeft") {
			terminal.sendText(SPECIAL_KEYS.LEFT, false);
			return;
		} else if (command === "Space") {
			terminal.sendText(SPECIAL_KEYS.SPACE, false);
			return;
		}

		// First, ensure the terminal is shown and has a chance to initialize
		terminal.show(false)
		
		// Start countdown immediately
		this.startCountdown();
		
		// Brief wait for terminal initialization
		await new Promise(resolve => setTimeout(resolve, 100))

		if (!terminal.shellIntegration?.executeCommand) {
			// Wait for shell integration to become available
			let attempts = 0
			const maxAttempts = 5
			
			while (attempts < maxAttempts) {
				if (terminal.shellIntegration?.executeCommand) {
					break
				}
				await new Promise(resolve => setTimeout(resolve, 100))
				attempts++
			}
		}

		// Check again if shell integration is available
		if (!terminal.shellIntegration?.executeCommand) {
			// If still no shell integration, proceed without it
			terminal.sendText(command, true)
			this.emit("no_shell_integration")
			return
		}

		// Shell integration is available, proceed with command execution
		try {
			await this.executeCommand(terminal, command)
		} catch (error) {
			console.error("Error executing command:", error)
			terminal.sendText(command, true)
			this.emit("error", error)
		}
	}

	private async executeCommand(terminal: vscode.Terminal, command: string) {
		if (!terminal.shellIntegration?.executeCommand) {
			throw new Error("Shell integration is not available")
		}

		const execution = terminal.shellIntegration.executeCommand(command)
		const stream = execution.read()
		let isFirstChunk = true

		for await (let data of stream) {
			// Process chunk and remove artifacts
			if (isFirstChunk) {
				const outputBetweenSequences = this.removeLastLineArtifacts(
					data.match(/\]633;C([\s\S]*?)\]633;D/)?.[1] || ""
				).trim()

				const vscodeSequenceRegex = /\x1b\]633;.[^\x07]*\x07/g
				const lastMatch = [...data.matchAll(vscodeSequenceRegex)].pop()
				if (lastMatch && lastMatch.index !== undefined) {
					data = data.slice(lastMatch.index + lastMatch[0].length)
				}
				if (outputBetweenSequences) {
					data = outputBetweenSequences + "\n" + data
				}
				data = stripAnsi(data)
				isFirstChunk = false
			} else {
				data = stripAnsi(data)
			}

			// Update current output
			this.currentOutput = data;
			this.fullOutput += data;
		}
	}

	private startCountdown() {
		// Clear any existing countdown
		if (this.countdownTimer) {
			clearInterval(this.countdownTimer);
		}

		// Start countdown from 10 seconds
		this.timeLeft = 10;
		this.countdownTimer = setInterval(() => {
			this.timeLeft--;
			this.emit("check_state", { timeLeft: this.timeLeft });

			if (this.timeLeft <= 0) {
				// Reset countdown and emit current state
				this.timeLeft = 10;
				this.emit("line", this.currentOutput);
			}
		}, 1000);
	}

	continue() {
		this.isListening = false
		if (this.countdownTimer) {
			clearInterval(this.countdownTimer);
			this.countdownTimer = null;
		}
		this.removeAllListeners("line")
		this.emit("continue")
	}

	getUnretrievedOutput(): string {
		const unretrieved = this.fullOutput.slice(this.lastRetrievedIndex)
		this.lastRetrievedIndex = this.fullOutput.length
		return this.removeLastLineArtifacts(unretrieved)
	}

	removeLastLineArtifacts(output: string) {
		const lines = output.trimEnd().split("\n")
		if (lines.length > 0) {
			const lastLine = lines[lines.length - 1]
			lines[lines.length - 1] = lastLine.replace(/[%$#>]\s*$/, "")
		}
		return lines.join("\n").trimEnd()
	}
}

export type TerminalProcessResultPromise = TerminalProcess & Promise<void>

export function mergePromise(process: TerminalProcess, promise: Promise<void>): TerminalProcessResultPromise {
	const nativePromisePrototype = (async () => {})().constructor.prototype
	const descriptors = ["then", "catch", "finally"].map(
		(property) => [property, Reflect.getOwnPropertyDescriptor(nativePromisePrototype, property)] as const
	)
	for (const [property, descriptor] of descriptors) {
		if (descriptor) {
			const value = descriptor.value.bind(promise)
			Reflect.defineProperty(process, property, { ...descriptor, value })
		}
	}
	return process as TerminalProcessResultPromise
}
