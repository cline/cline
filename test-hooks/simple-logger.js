#!/usr/bin/env node
/**
 * Simple logger hook for testing Cline hook integration
 * Logs all events to a file and always approves
 */

const fs = require("fs")
const path = require("path")
const os = require("os")

const LOG_FILE = path.join(os.tmpdir(), "cline-hook-test.log")

// Read event from stdin
let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => (input += chunk))
process.stdin.on("end", () => {
	try {
		const event = JSON.parse(input)

		// Create log entry
		const logEntry = {
			timestamp: new Date().toISOString(),
			event_name: event.hook_event_name,
			task_id: event.task_id,
			cwd: event.cwd,
			tool_name: event.tool_name || null,
			tool_input: event.tool_input || null,
			prompt: event.prompt || null,
			source: event.source || null,
		}

		// Append to log file
		fs.appendFileSync(LOG_FILE, JSON.stringify(logEntry) + "\n")

		// Create response based on event type
		const response = {
			approve: true,
			message: `✓ Hook logged ${event.hook_event_name} event`,
		}

		// Add some example modifications for testing
		if (event.hook_event_name === "PreToolUse" && event.tool_name === "Read") {
			response.message = `✓ Reading file: ${event.tool_input?.path || "unknown"}`
		} else if (event.hook_event_name === "UserPromptSubmit") {
			response.additionalContext = [`[Hook: User prompt received at ${new Date().toLocaleTimeString()}]`]
		} else if (event.hook_event_name === "SessionStart") {
			response.message = `✓ Session started (${event.source})`
			response.additionalContext = [`[Hook: Monitoring enabled for task ${event.task_id}]`]
		}

		// Output response
		console.log(JSON.stringify(response))
	} catch (error) {
		// On error, log it and approve silently
		fs.appendFileSync(LOG_FILE, `ERROR: ${error.message}\n`)
		console.log(JSON.stringify({ approve: true }))
	}
})

// No timeout needed for immediate response
