import { EventEmitter } from "events"
import stripAnsi from "strip-ansi"
import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"

const SPECIAL_KEYS = {
    ENTER: '\r',
    UP: '\x1b[A',
    DOWN: '\x1b[B',
    RIGHT: '\x1b[C',
    LEFT: '\x1b[D',
    SPACE: ' ',
} as const;

// Server detection patterns with enhanced URL detection
const SERVER_PATTERNS = [
    {
        regex: [
            /Local\s+http:\/\/localhost:(\d+)\//i,
            /http:\/\/localhost:(\d+)/i,
            /running on (http:\/\/\S+)/i,
            /┃\s+Local\s+http:\/\/localhost:(\d+)\//i,  // Specific for Astro-like output
            /┃\s+Network\s+http:\/\/\S+:(\d+)\//i,     // Network URL for Astro
            /astro\s+v\d+\.\d+\.\d+\s+ready/i          // Astro startup indicator
        ],
        type: 'dev-server',
        frameworks: [
            { pattern: /astro/i, name: 'Astro' },
            { pattern: /react/i, name: 'React' },
            { pattern: /vue/i, name: 'Vue' },
            { pattern: /angular/i, name: 'Angular' },
            { pattern: /next/i, name: 'Next.js' },
            { pattern: /vite/i, name: 'Vite' }
        ]
    }
    // Other server patterns can be added here
];

export interface TerminalProcessEvents {
	line: [line: string]
	continue: []
	completed: []
	error: [error: Error]
	no_shell_integration: []
	ready: [{ type: string; url?: string; framework?: string }]
	check_state: [{ timeLeft: number }]
}

export class TerminalProcess extends EventEmitter<TerminalProcessEvents> {
	waitForShellIntegration: boolean = true
	private isListening: boolean = true
	private buffer: string = ""
	private fullOutput: string = ""
	private lastRetrievedIndex: number = 0
	private countdownTimer: NodeJS.Timeout | null = null
	private timeLeft: number = 10
	isHot: boolean = true
	private lastOutputTime: number = 0
	private completionTimer: NodeJS.Timeout | null = null
	private currentWorkingDirectory: string | undefined = undefined
	private serverInfoEmitted: boolean = false

	private detectServerInfo(output: string): { type?: string; url?: string; framework?: string } {
		// If server info has already been emitted, return empty
		if (this.serverInfoEmitted) return {}

		for (const pattern of SERVER_PATTERNS) {
			// Try multiple regex patterns
			for (const regex of (pattern.regex instanceof Array ? pattern.regex : [pattern.regex])) {
				const urlMatch = output.match(regex);
				if (urlMatch) {
					// Extract URL, preferring full URL or constructing from localhost
					const url = urlMatch[1] 
						? `http://localhost:${urlMatch[1]}/` 
						: urlMatch[0];
					
					// Detect framework
					let framework;
					if (pattern.frameworks) {
						for (const fw of pattern.frameworks) {
							if (fw.pattern.test(output)) {
								framework = fw.name;
								break;
							}
						}
					}

					// Mark that server info has been emitted
					this.serverInfoEmitted = true

					return {
						type: pattern.type,
						url,
						framework
					};
				}
			}
		}
		return {};
	}

	async run(terminal: vscode.Terminal, command: string) {
		// Emit first line immediately to show "proceed while running"
		this.emit("line", command);
		
		// Start countdown
		this.startCountdown();

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

		// Show terminal
		terminal.show(false)
		
		// Brief wait for initialization
		await new Promise(resolve => setTimeout(resolve, 100))

		if (!terminal.shellIntegration?.executeCommand) {
			// Wait for shell integration
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

		// Execute command with or without shell integration
		if (!terminal.shellIntegration?.executeCommand) {
			terminal.sendText(command, true)
			this.emit("no_shell_integration")
			return
		}

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
		this.lastOutputTime = Date.now()

		try {
			for await (let data of stream) {
				const cleanData = stripAnsi(data)
				this.fullOutput += cleanData

				// Detect server information
				const serverInfo = this.detectServerInfo(cleanData);
				if (serverInfo.type || serverInfo.url) {
					this.emit("ready", {
						type: serverInfo.type || '',
						url: serverInfo.url,
						framework: serverInfo.framework
					});
				}

				this.lastOutputTime = Date.now()

				// Reset completion timer if it exists
				if (this.completionTimer) {
					clearTimeout(this.completionTimer)
				}

				// Set new completion timer
				this.completionTimer = setTimeout(() => {
					const timeSinceLastOutput = Date.now() - this.lastOutputTime
					if (timeSinceLastOutput >= 2000) {
						this.emit("completed")
						this.continue()
					}
				}, 2000)
			}
		} catch (error) {
			console.error("Error in command execution:", error)
			this.emit("error", error instanceof Error ? error : new Error(String(error)))
			this.continue()
		}
	}

	// Existing methods like startCountdown, continue, getUnretrievedOutput remain the same
	private startCountdown() {
		if (this.countdownTimer) {
			clearInterval(this.countdownTimer);
		}

		this.timeLeft = 10;
		this.countdownTimer = setInterval(() => {
			this.timeLeft--;
			this.emit("check_state", { timeLeft: this.timeLeft });

			if (this.timeLeft <= 0) {
				this.timeLeft = 10;
				this.emit("line", this.getUnretrievedOutput());
			}
		}, 1000);
	}

	continue() {
		this.isListening = false
		if (this.countdownTimer) {
			clearInterval(this.countdownTimer);
			this.countdownTimer = null;
		}
		if (this.completionTimer) {
			clearTimeout(this.completionTimer);
			this.completionTimer = null;
		}
		this.removeAllListeners("line")
		this.emit("continue")
	}

	getUnretrievedOutput(): string {
		const unretrieved = this.fullOutput.slice(this.lastRetrievedIndex)
		this.lastRetrievedIndex = this.fullOutput.length
		return unretrieved.trimEnd()
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
