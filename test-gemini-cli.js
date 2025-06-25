// Test script for Gemini CLI integration
// This script tests if the Gemini CLI can be invoked programmatically

const { spawn } = require("child_process")
const path = require("path")

// Path to the Gemini CLI
const geminiCliPath = path.join(__dirname, "gemini-cli/packages/cli/dist/index.js")

// Test prompt
const testPrompt = "Hello, can you respond with a simple greeting?"

console.log("Testing Gemini CLI integration...")
console.log("CLI Path:", geminiCliPath)
console.log("Prompt:", testPrompt)
console.log("---")

// Spawn the Gemini CLI process
// When not in TTY mode, the CLI expects input from stdin
const geminiProcess = spawn("node", [geminiCliPath], {
	env: {
		...process.env,
		// Ensure GEMINI_API_KEY is set
		GEMINI_API_KEY: process.env.GEMINI_API_KEY,
	},
	stdio: ["pipe", "pipe", "pipe"], // Allow writing to stdin
})

// Write the prompt to stdin and close it
geminiProcess.stdin.write(testPrompt)
geminiProcess.stdin.end()

// Capture stdout
let output = ""
geminiProcess.stdout.on("data", (data) => {
	output += data.toString()
	process.stdout.write(data)
})

// Capture stderr
geminiProcess.stderr.on("data", (data) => {
	console.error("Error:", data.toString())
})

// Handle process exit
geminiProcess.on("close", (code) => {
	console.log("\n---")
	console.log(`Process exited with code ${code}`)

	if (code === 0 && output.trim()) {
		console.log("✅ Test passed! Gemini CLI responded successfully.")
	} else {
		console.log("❌ Test failed. Check if:")
		console.log("1. GEMINI_API_KEY environment variable is set")
		console.log("2. The Gemini CLI is built (run npm run build in gemini-cli/packages/cli)")
		console.log("3. The CLI has proper permissions")
	}
})

geminiProcess.on("error", (err) => {
	console.error("Failed to start process:", err)
})
