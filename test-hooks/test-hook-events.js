#!/usr/bin/env node
/**
 * Test script to validate hook event processing
 * Simulates various Cline events and checks hook responses
 */

const { spawn } = require("child_process")
const path = require("path")

const HOOK_SCRIPT = path.join(__dirname, "simple-logger.js")

// Test events
const testEvents = [
	{
		name: "PreToolUse",
		data: {
			hook_event_name: "PreToolUse",
			task_id: "test-123",
			cwd: "/test/project",
			tool_name: "Read",
			tool_input: { path: "/test/file.txt" },
		},
	},
	{
		name: "PostToolUse",
		data: {
			hook_event_name: "PostToolUse",
			task_id: "test-123",
			cwd: "/test/project",
			tool_name: "Read",
			tool_input: { path: "/test/file.txt" },
			tool_response: { content: "File contents here" },
		},
	},
	{
		name: "UserPromptSubmit",
		data: {
			hook_event_name: "UserPromptSubmit",
			task_id: "test-123",
			cwd: "/test/project",
			prompt: "Please help me write a test",
		},
	},
	{
		name: "SessionStart",
		data: {
			hook_event_name: "SessionStart",
			task_id: "test-123",
			cwd: "/test/project",
			source: "startup",
		},
	},
	{
		name: "Stop",
		data: {
			hook_event_name: "Stop",
			task_id: "test-123",
			cwd: "/test/project",
			stop_hook_active: true,
		},
	},
	{
		name: "SessionEnd",
		data: {
			hook_event_name: "SessionEnd",
			task_id: "test-123",
			cwd: "/test/project",
		},
	},
]

async function testHook(eventName, eventData) {
	return new Promise((resolve, reject) => {
		console.log(`\n🧪 Testing ${eventName}...`)
		console.log("📤 Sending:", JSON.stringify(eventData, null, 2))

		const hookProcess = spawn("node", [HOOK_SCRIPT])
		let stdout = ""
		let stderr = ""

		hookProcess.stdout.on("data", (data) => {
			stdout += data.toString()
		})

		hookProcess.stderr.on("data", (data) => {
			stderr += data.toString()
		})

		hookProcess.on("close", (code) => {
			if (stderr) {
				console.error("❌ Hook stderr:", stderr)
			}

			try {
				const response = JSON.parse(stdout)
				console.log("📥 Response:", JSON.stringify(response, null, 2))

				// Validate response
				if (typeof response.approve !== "boolean") {
					console.error("❌ Invalid response: missing approve field")
					reject(new Error("Invalid response"))
					return
				}

				if (response.approve) {
					console.log("✅ Hook approved")
				} else {
					console.log("⛔ Hook denied")
				}

				if (response.message) {
					console.log("💬 Message:", response.message)
				}

				if (response.additionalContext) {
					console.log("📝 Additional context:", response.additionalContext)
				}

				resolve(response)
			} catch (error) {
				console.error("❌ Failed to parse response:", stdout)
				reject(error)
			}
		})

		hookProcess.on("error", (error) => {
			console.error("❌ Failed to execute hook:", error)
			reject(error)
		})

		// Send event data to stdin
		hookProcess.stdin.write(JSON.stringify(eventData))
		hookProcess.stdin.end()
	})
}

async function runTests() {
	console.log("🚀 Starting Cline Hook Tests")
	console.log("============================")

	let passed = 0
	let failed = 0

	for (const test of testEvents) {
		try {
			await testHook(test.name, test.data)
			passed++
		} catch (error) {
			console.error(`❌ Test failed: ${error.message}`)
			failed++
		}
	}

	console.log("\n============================")
	console.log("📊 Test Results:")
	console.log(`✅ Passed: ${passed}`)
	console.log(`❌ Failed: ${failed}`)

	// Check the log file
	const fs = require("fs")
	const os = require("os")
	const logFile = path.join(os.tmpdir(), "cline-hook-test.log")

	if (fs.existsSync(logFile)) {
		console.log(`\n📋 Log file created at: ${logFile}`)
		const logs = fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean)
		console.log(`   Contains ${logs.length} events`)

		// Clean up for next test
		fs.unlinkSync(logFile)
		console.log("   (Log file cleaned up)")
	}

	process.exit(failed > 0 ? 1 : 0)
}

// Run tests
runTests().catch(console.error)
