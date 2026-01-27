/**
 * Terminal display utilities for rendering Cline messages in the CLI
 */

import type { ClineAsk, ClineMessage, ClineSay, ExtensionState } from "@shared/ExtensionMessage"
import { originalConsoleError, originalConsoleLog } from "./console"

// ANSI color codes for terminal output
const colors = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	italic: "\x1b[3m",
	underline: "\x1b[4m",

	// Foreground colors
	black: "\x1b[30m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	white: "\x1b[37m",

	// Bright foreground colors
	brightBlack: "\x1b[90m",
	brightRed: "\x1b[91m",
	brightGreen: "\x1b[92m",
	brightYellow: "\x1b[93m",
	brightBlue: "\x1b[94m",
	brightMagenta: "\x1b[95m",
	brightCyan: "\x1b[96m",
	brightWhite: "\x1b[97m",

	// Background colors
	bgBlack: "\x1b[40m",
	bgRed: "\x1b[41m",
	bgGreen: "\x1b[42m",
	bgYellow: "\x1b[43m",
	bgBlue: "\x1b[44m",
	bgMagenta: "\x1b[45m",
	bgCyan: "\x1b[46m",
	bgWhite: "\x1b[47m",
}

export function colorize(text: string, ...colorCodes: string[]): string {
	return colorCodes.join("") + text + colors.reset
}

// Helper functions for common color combinations
export const style = {
	bold: (text: string) => colorize(text, colors.bold),
	dim: (text: string) => colorize(text, colors.dim),
	italic: (text: string) => colorize(text, colors.italic),

	error: (text: string) => colorize(text, colors.red, colors.bold),
	warning: (text: string) => colorize(text, colors.yellow),
	success: (text: string) => colorize(text, colors.green),
	info: (text: string) => colorize(text, colors.cyan),

	// Message type colors
	task: (text: string) => colorize(text, colors.brightWhite, colors.bold),
	tool: (text: string) => colorize(text, colors.blue),
	command: (text: string) => colorize(text, colors.magenta),
	api: (text: string) => colorize(text, colors.brightBlack),
	user: (text: string) => colorize(text, colors.green),
	assistant: (text: string) => colorize(text, colors.cyan),

	// Special formatting
	path: (text: string) => colorize(text, colors.underline, colors.blue),
	code: (text: string) => colorize(text, colors.bgBlack, colors.brightWhite),
}

/**
 * Format a timestamp for display
 */
export function formatTimestamp(ts: number): string {
	const date = new Date(ts)
	return date.toLocaleTimeString("en-US", {
		hour12: false,
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	})
}

/**
 * Get a prefix icon for different message types
 */
function getMessageIcon(message: ClineMessage): string {
	if (message.type === "ask") {
		switch (message.ask) {
			case "followup":
				return "❓"
			case "command":
			case "command_output":
				return "⚙️ "
			case "tool":
				return "🔧"
			case "completion_result":
				return "✅"
			case "api_req_failed":
				return "❌"
			case "resume_task":
			case "resume_completed_task":
				return "▶️ "
			case "browser_action_launch":
				return "🌐"
			case "use_mcp_server":
				return "🔌"
			default:
				return "❔"
		}
	} else {
		switch (message.say) {
			case "task":
				return "📋"
			case "error":
				return "❌"
			case "text":
				return "💬"
			case "reasoning":
				return "🧠"
			case "completion_result":
				return "✅"
			case "user_feedback":
				return "👤"
			case "command":
			case "command_output":
				return "⚙️ "
			case "tool":
				return "🔧"
			case "browser_action":
			case "browser_action_launch":
			case "browser_action_result":
				return "🌐"
			case "mcp_server_request_started":
			case "mcp_server_response":
				return "🔌"
			case "api_req_started":
			case "api_req_finished":
				return "🔄"
			case "checkpoint_created":
				return "💾"
			case "info":
				return "ℹ️ "
			default:
				return "  "
		}
	}
}

/**
 * Format a ClineMessage for terminal display
 */
export function formatMessage(message: ClineMessage, verbose: boolean = false): string {
	const icon = getMessageIcon(message)
	const timestamp = formatTimestamp(message.ts)
	const lines: string[] = []

	const prefix = `${style.dim(timestamp)} ${icon}`

	if (message.type === "ask") {
		lines.push(formatAskMessage(message, prefix, verbose))
	} else {
		lines.push(formatSayMessage(message, prefix, verbose))
	}

	return lines.filter(Boolean).join("\n")
}

function formatAskMessage(message: ClineMessage, prefix: string, verbose: boolean): string {
	const ask = message.ask as ClineAsk

	switch (ask) {
		case "followup": {
			// Parse JSON question format
			let question = message.text || ""
			try {
				const parsed = JSON.parse(message.text || "{}")
				question = parsed.question || question
			} catch {
				// Fallback to raw text if not JSON
				question = message.text || ""
			}
			return `${prefix} ${style.info("Question:")} ${question}`
		}

		case "command":
			return `${prefix} ${style.command("Execute command?")} ${style.code(message.text || "")}`

		case "tool":
			return `${prefix} ${style.tool("Use tool?")} ${message.text || ""}`

		case "completion_result":
			return `${prefix} ${style.success("Task completed")} ${message.text ? `- ${message.text}` : ""}`

		case "api_req_failed":
			return `${prefix} ${style.error("API request failed")} ${message.text || ""}`

		case "resume_task":
		case "resume_completed_task":
			return `${prefix} ${style.info("Resume task?")} ${message.text || ""}`

		case "browser_action_launch":
			return `${prefix} ${style.info("Launch browser?")} ${message.text || ""}`

		case "use_mcp_server":
			return `${prefix} ${style.info("Use MCP server?")} ${message.text || ""}`

		case "plan_mode_respond":
			return `${prefix} ${style.info("Plan mode response:")} ${message.text || ""}`

		default:
			return verbose ? `${prefix} [ASK:${ask}] ${message.text || ""}` : ""
	}
}

function formatSayMessage(message: ClineMessage, prefix: string, verbose: boolean): string {
	const say = message.say as ClineSay

	switch (say) {
		case "task":
			return `${prefix} ${style.task("Task:")} ${message.text || ""}`

		case "text":
			return `${prefix} ${style.assistant(message.text || "")}`

		case "reasoning":
			return `${prefix} ${style.dim("Thinking:")} ${style.italic(message.text || "")}`

		case "error":
			return `${prefix} ${style.error("Error:")} ${message.text || ""}`

		case "completion_result":
			return `${prefix} ${style.success("✓ Completed:")} ${message.text || ""}`

		case "user_feedback":
			return `${prefix} ${style.user("User:")} ${message.text || ""}`

		case "command":
			return `${prefix} ${style.command("Command:")} ${style.code(message.text || "")}`

		case "command_output":
			const output = message.text || ""
			const truncated = output.length > 500 ? output.substring(0, 500) + "..." : output
			return `${prefix} ${style.dim("Output:")} ${truncated}`

		case "tool":
			return `${prefix} ${style.tool("Tool:")} ${message.text || ""}`

		case "browser_action":
		case "browser_action_launch":
			return `${prefix} ${style.info("Browser:")} ${message.text || ""}`

		case "browser_action_result":
			return `${prefix} ${style.dim("Browser result")} ${message.text ? `- ${message.text.substring(0, 100)}...` : ""}`

		case "mcp_server_request_started":
			return `${prefix} ${style.info("MCP request started")} ${message.text || ""}`

		case "mcp_server_response":
			return `${prefix} ${style.info("MCP response")} ${message.text ? message.text.substring(0, 200) : ""}`

		case "api_req_started":
			return verbose ? `${prefix} ${style.api("API request started")}` : `${message.text || ""}`

		case "api_req_finished":
			return verbose ? `${prefix} ${style.api("API request finished")}` : ""

		case "checkpoint_created":
			return `${prefix} ${style.success("Checkpoint created")} ${message.text || ""}`

		case "info":
			return `${prefix} ${style.info(message.text || "")}`

		case "hook_status":
			return `${prefix} ${style.dim("Hook:")} ${message.text || ""}`

		case "task_progress":
			return `${prefix} ${style.info("Progress:")} ${message.text || ""}`

		default:
			return verbose ? `${prefix} [SAY:${say}] ${message.text || ""}` : ""
	}
}

/**
 * Display a horizontal separator
 */
export function separator(char: string = "─", width: number = 60): string {
	return style.dim(char.repeat(width))
}

/**
 * Display the task header
 */
export function taskHeader(taskId: string, task?: string): string {
	const lines = [
		separator("═"),
		style.bold(`  Task: ${taskId}`),
		task ? `  ${style.dim(task.substring(0, 80))}${task.length > 80 ? "..." : ""}` : "",
		separator("═"),
	]
	return lines.filter(Boolean).join("\n")
}

/**
 * Format the current state for display
 */
export function formatState(state: ExtensionState, verbose: boolean = false): string {
	const lines: string[] = []

	if (state.currentTaskItem) {
		lines.push(taskHeader(state.currentTaskItem.id, state.currentTaskItem.task))
	}

	// Show messages
	if (state.clineMessages && state.clineMessages.length > 0) {
		const messagesToShow = verbose
			? state.clineMessages
			: state.clineMessages.filter((m) => {
					// Filter out noisy messages in non-verbose mode
					// if (m.say === "api_req_started" || m.say === "api_req_finished") return false
					return true
				})

		for (const message of messagesToShow) {
			const formatted = formatMessage(message, verbose)
			if (formatted) {
				lines.push(formatted)
			}
		}
	}

	return lines.join("\n")
}

/**
 * Display a spinner with message
 */
export class Spinner {
	private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
	private frameIndex = 0
	private interval: NodeJS.Timeout | null = null
	private message: string = ""

	start(message: string) {
		this.message = message
		this.interval = setInterval(() => {
			const frame = this.frames[this.frameIndex]
			process.stdout.write(`\r${style.info(frame)} ${this.message}`)
			this.frameIndex = (this.frameIndex + 1) % this.frames.length
		}, 80)
	}

	update(message: string) {
		this.message = message
	}

	stop(finalMessage?: string) {
		if (this.interval) {
			clearInterval(this.interval)
			this.interval = null
		}
		if (finalMessage) {
			process.stdout.write(`\r${style.success("✓")} ${finalMessage}\n`)
		} else {
			process.stdout.write("\r" + " ".repeat(this.message.length + 4) + "\r")
		}
	}

	fail(message?: string) {
		if (this.interval) {
			clearInterval(this.interval)
			this.interval = null
		}
		if (message) {
			process.stdout.write(`\r${style.error("✗")} ${message}\n`)
		}
	}
}

/**
 * Clear the current line
 */
export function clearLine() {
	process.stdout.write("\r\x1b[K")
}

/**
 * Move cursor up n lines
 */
export function cursorUp(n: number = 1) {
	process.stdout.write(`\x1b[${n}A`)
}

/**
 * Print a message to stdout with newline
 * Uses original console.log to work even when console is suppressed
 */
export function print(message: string) {
	originalConsoleLog(message)
}

/**
 * Print an error message to stderr
 * Uses original console.error to work even when console is suppressed
 */
export function printError(message: string) {
	originalConsoleError(style.error(message))
}

/**
 * Print a success message
 */
export function printSuccess(message: string) {
	originalConsoleLog(style.success(message))
}

/**
 * Print an info message
 */
export function printInfo(message: string) {
	originalConsoleLog(style.info(message))
}

/**
 * Print a warning message
 */
export function printWarning(message: string) {
	originalConsoleLog(style.warning(message))
}

/**
 * Prompt user for input from stdin
 */
export async function promptUser(question: string): Promise<string> {
	const readline = await import("readline")
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	})

	return new Promise((resolve) => {
		rl.question(style.info(question) + " ", (answer: string) => {
			rl.close()
			resolve(answer.trim())
		})
	})
}

/**
 * Prompt user for yes/no confirmation
 */
export async function promptConfirmation(question: string): Promise<boolean> {
	const answer = await promptUser(`${question} ${style.dim("(y/n)")}`)
	return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes"
}

/**
 * Set the terminal session title using OSC escape sequence.
 * Works in most modern terminal emulators (iTerm2, Terminal.app, GNOME Terminal, etc.)
 */
export function setTerminalTitle(title: string): void {
	if (process.stdout.isTTY) {
		const maxLength = 80
		const truncated = title.length > maxLength ? title.slice(0, maxLength) + "..." : title
		process.stdout.write(`\x1b]0;${truncated}\x07`)
	}
}
