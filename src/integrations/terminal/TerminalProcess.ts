import { EventEmitter } from "events"
import stripAnsi from "strip-ansi"
import * as vscode from "vscode"

export interface TerminalProcessEvents {
	line: [line: string]
	continue: []
	completed: []
	error: [error: Error]
	no_shell_integration: []
	ready: [{ type: string; url?: string }]
}

interface ServerPattern {
    type: string;
    readyPatterns: RegExp[];
    urlPattern?: RegExp;
}

// Patterns to detect when different types of servers/processes are ready
const SERVER_PATTERNS: ServerPattern[] = [
    {
        type: "next.js",
        readyPatterns: [
            /ready started server on/i,
            /ready in \d+/i
        ],
        urlPattern: /http:\/\/localhost:\d+/
    },
    {
        type: "vite",
        readyPatterns: [
            /ready in \d+/i,
            /local:\s+(http:\/\/localhost:\d+)/i
        ],
        urlPattern: /http:\/\/localhost:\d+/
    },
    {
        type: "react-scripts",
        readyPatterns: [
            /You can now view .+ in the browser/i,
            /Compiled successfully/i
        ],
        urlPattern: /Local:\s+(http:\/\/localhost:\d+)/
    },
    {
        type: "webpack",
        readyPatterns: [
            /compiled (?:successfully|with warnings)/i,
            /webpack \d+\.\d+\.\d+ compiled/i
        ],
        urlPattern: /http:\/\/localhost:\d+/
    },
    {
        type: "angular",
        readyPatterns: [
            /Compiled successfully/i,
            /Angular Live Development Server is listening/i
        ],
        urlPattern: /http:\/\/localhost:\d+/
    },
    {
        type: "vue-cli",
        readyPatterns: [
            /App running at:/i,
            /Local:\s+http/i
        ],
        urlPattern: /http:\/\/localhost:\d+/
    },
    {
        type: "flask",
        readyPatterns: [
            /Running on http/i,
            /Debugger PIN/i
        ],
        urlPattern: /http:\/\/\d+\.\d+\.\d+\.\d+:\d+/
    },
    {
        type: "django",
        readyPatterns: [
            /Starting development server at/i,
            /Watching for file changes/i
        ],
        urlPattern: /http:\/\/\d+\.\d+\.\d+\.\d+:\d+/
    },
    {
        type: "spring-boot",
        readyPatterns: [
            /Tomcat started on port/i,
            /Started .+ in \d+/i
        ],
        urlPattern: /:\d+/
    },
    {
        type: "npm-install",
        readyPatterns: [
            /added \d+ packages/i,
            /found \d+ vulnerabilities/i,
            /packages are looking for funding/i
        ]
    },
    {
        type: "yarn-install",
        readyPatterns: [
            /Done in \d+/i,
            /success Saved lockfile/i
        ]
    },
    {
        type: "build",
        readyPatterns: [
            /Build complete/i,
            /Successfully built/i,
            /Compiled successfully/i,
            /Build finished/i
        ]
    },
	{
		type: "go",
		readyPatterns: [
			/listening on/i,
			/Serving/i
		],
		urlPattern: /http:\/\/localhost:\d+/
	}
]

export class TerminalProcess extends EventEmitter<TerminalProcessEvents> {
	waitForShellIntegration: boolean = true
	private isListening: boolean = true
	private buffer: string = ""
	private fullOutput: string = ""
	private lastRetrievedIndex: number = 0
	isHot: boolean = true // Always hot by default now
	private currentCommand: string = ""
	private readyEmitted: boolean = false
	private outputAccumulator: string = ""

	async run(terminal: vscode.Terminal, command: string) {
		this.currentCommand = command
		this.readyEmitted = false
		this.outputAccumulator = ""

		if (terminal.shellIntegration && terminal.shellIntegration.executeCommand) {
			const execution = terminal.shellIntegration.executeCommand(command)
			const stream = execution.read()
			let isFirstChunk = true
			let didOutputNonCommand = false
			let didEmitEmptyLine = false
			for await (let data of stream) {
				// 1. Process chunk and remove artifacts
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
					let lines = data ? data.split("\n") : []
					if (lines.length > 0) {
						lines[0] = lines[0].replace(/[^\x20-\x7E]/g, "")
					}
					if (lines.length > 0 && lines[0].length >= 2 && lines[0][0] === lines[0][1]) {
						lines[0] = lines[0].slice(1)
					}
					if (lines.length > 0) {
						lines[0] = lines[0].replace(/^[^a-zA-Z0-9]*/, "")
					}
					if (lines.length > 1) {
						lines[1] = lines[1].replace(/^[^a-zA-Z0-9]*/, "")
					}
					data = lines.join("\n")
					isFirstChunk = false
				} else {
					data = stripAnsi(data)
				}

				if (!didOutputNonCommand) {
					const lines = data.split("\n")
					for (let i = 0; i < lines.length; i++) {
						if (command.includes(lines[i].trim())) {
							lines.splice(i, 1)
							i--
						} else {
							didOutputNonCommand = true
							break
						}
					}
					data = lines.join("\n")
				}

				data = data.replace(/,/g, "")

				// Accumulate output for ready detection
				this.outputAccumulator += data
				this.checkIfReady()

				if (!didEmitEmptyLine && !this.fullOutput && data) {
					this.emit("line", "")
					didEmitEmptyLine = true
				}

				this.fullOutput += data
				if (this.isListening) {
					this.emitIfEol(data)
					this.lastRetrievedIndex = this.fullOutput.length - this.buffer.length
				}
			}

			this.emitRemainingBufferIfListening()
			this.emit("completed")
			this.emit("continue")
		} else {
			terminal.sendText(command, true)
			this.emit("completed")
			this.emit("continue")
			this.emit("no_shell_integration")
		}
	}

	private checkIfReady() {
		if (this.readyEmitted) return

		for (const pattern of SERVER_PATTERNS) {
			// Check if all ready patterns match
			const allPatternsMatch = pattern.readyPatterns.every(readyPattern => 
				readyPattern.test(this.outputAccumulator)
			)

			if (allPatternsMatch) {
				let url: string | undefined
				if (pattern.urlPattern) {
					const match = this.outputAccumulator.match(pattern.urlPattern)
					if (match) {
						url = match[0]
					}
				}

				this.readyEmitted = true
				this.emit("ready", { type: pattern.type, url })
				break
			}
		}
	}

	private emitIfEol(chunk: string) {
		this.buffer += chunk
		let lineEndIndex: number
		while ((lineEndIndex = this.buffer.indexOf("\n")) !== -1) {
			let line = this.buffer.slice(0, lineEndIndex).trimEnd()
			this.emit("line", line)
			this.buffer = this.buffer.slice(lineEndIndex + 1)
		}
	}

	private emitRemainingBufferIfListening() {
		if (this.buffer && this.isListening) {
			const remainingBuffer = this.removeLastLineArtifacts(this.buffer)
			if (remainingBuffer) {
				this.emit("line", remainingBuffer)
			}
			this.buffer = ""
			this.lastRetrievedIndex = this.fullOutput.length
		}
	}

	continue() {
		this.emitRemainingBufferIfListening()
		this.isListening = false
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
