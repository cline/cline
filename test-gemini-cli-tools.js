const { spawn } = require("child_process")

// Simple test to see if Gemini CLI outputs tool calls in XML format
async function testGeminiCliTools() {
	console.log("Testing Gemini CLI tool call formatting...\n")

	const geminiPath = "gemini"
	const args = ["--model", "gemini-2.5-flash"]

	const child = spawn(geminiPath, args, {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			GEMINI_API_KEY: process.env.GEMINI_API_KEY,
		},
	})

	let output = ""
	let error = ""

	child.stdout.on("data", (data) => {
		output += data.toString()
		process.stdout.write(data)
	})

	child.stderr.on("data", (data) => {
		error += data.toString()
	})

	child.on("close", (code) => {
		console.log("\n\nProcess exited with code:", code)
		if (error) {
			console.error("Error output:", error)
		}
	})

	// Send the test prompt
	const prompt = "Please read the package.json file to understand this project."
	child.stdin.write(prompt)
	child.stdin.end()
}

// Run the test
testGeminiCliTools().catch(console.error)
