import * as assert from "assert"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"

import type { ClineMessage } from "@roo-code/types"

import { waitFor, sleep } from "../utils"
import { setDefaultSuiteTimeout } from "../test-utils"

suite("Roo Code apply_diff Tool", function () {
	setDefaultSuiteTimeout(this)

	let workspaceDir: string

	// Pre-created test files that will be used across tests
	const testFiles = {
		simpleModify: {
			name: `test-file-simple-${Date.now()}.txt`,
			content: "Hello World\nThis is a test file\nWith multiple lines",
			path: "",
		},
		multipleReplace: {
			name: `test-func-multiple-${Date.now()}.js`,
			content: `function calculate(x, y) {
	const sum = x + y
	const product = x * y
	return { sum: sum, product: product }
}`,
			path: "",
		},
		lineNumbers: {
			name: `test-lines-${Date.now()}.js`,
			content: `// Header comment
function oldFunction() {
	console.log("Old implementation")
}

// Another function
function keepThis() {
	console.log("Keep this")
}

// Footer comment`,
			path: "",
		},
		errorHandling: {
			name: `test-error-${Date.now()}.txt`,
			content: "Original content",
			path: "",
		},
		multiSearchReplace: {
			name: `test-multi-search-${Date.now()}.js`,
			content: `function processData(data) {
	console.log("Processing data")
	return data.map(item => item * 2)
}

// Some other code in between
const config = {
	timeout: 5000,
	retries: 3
}

function validateInput(input) {
	console.log("Validating input")
	if (!input) {
		throw new Error("Invalid input")
	}
	return true
}`,
			path: "",
		},
	}

	// Get the actual workspace directory that VSCode is using and create all test files
	suiteSetup(async function () {
		// Get the workspace folder from VSCode
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (!workspaceFolders || workspaceFolders.length === 0) {
			throw new Error("No workspace folder found")
		}
		workspaceDir = workspaceFolders[0]!.uri.fsPath
		console.log("Using workspace directory:", workspaceDir)

		// Create all test files before any tests run
		console.log("Creating test files in workspace...")
		for (const [key, file] of Object.entries(testFiles)) {
			file.path = path.join(workspaceDir, file.name)
			await fs.writeFile(file.path, file.content)
			console.log(`Created ${key} test file at:`, file.path)
		}

		// Verify all files exist
		for (const [key, file] of Object.entries(testFiles)) {
			const exists = await fs
				.access(file.path)
				.then(() => true)
				.catch(() => false)
			if (!exists) {
				throw new Error(`Failed to create ${key} test file at ${file.path}`)
			}
		}
	})

	// Clean up after all tests
	suiteTeardown(async () => {
		// Cancel any running tasks before cleanup
		try {
			await globalThis.api.cancelCurrentTask()
		} catch {
			// Task might not be running
		}

		// Clean up all test files
		console.log("Cleaning up test files...")
		for (const [key, file] of Object.entries(testFiles)) {
			try {
				await fs.unlink(file.path)
				console.log(`Cleaned up ${key} test file`)
			} catch (error) {
				console.log(`Failed to clean up ${key} test file:`, error)
			}
		}
	})

	// Clean up before each test
	setup(async () => {
		// Cancel any previous task
		try {
			await globalThis.api.cancelCurrentTask()
		} catch {
			// Task might not be running
		}

		// Small delay to ensure clean state
		await sleep(100)
	})

	// Clean up after each test
	teardown(async () => {
		// Cancel the current task
		try {
			await globalThis.api.cancelCurrentTask()
		} catch {
			// Task might not be running
		}

		// Small delay to ensure clean state
		await sleep(100)
	})

	test("Should apply diff to modify existing file content", async function () {
		// Increase timeout for this specific test

		const api = globalThis.api
		const messages: ClineMessage[] = []
		const testFile = testFiles.simpleModify
		const expectedContent = "Hello Universe\nThis is a test file\nWith multiple lines"
		let taskStarted = false
		let taskCompleted = false
		let errorOccurred: string | null = null
		let applyDiffExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Log important messages for debugging
			if (message.type === "say" && message.say === "error") {
				errorOccurred = message.text || "Unknown error"
				console.error("Error:", message.text)
			}
			if (message.type === "ask" && message.ask === "tool") {
				console.log("Tool request:", message.text?.substring(0, 200))
			}
			if (message.type === "say" && (message.say === "completion_result" || message.say === "text")) {
				console.log("AI response:", message.text?.substring(0, 200))
			}

			// Check for tool execution
			if (message.type === "say" && message.say === "api_req_started" && message.text) {
				console.log("API request started:", message.text.substring(0, 200))
				try {
					const requestData = JSON.parse(message.text)
					if (requestData.request && requestData.request.includes("apply_diff")) {
						applyDiffExecuted = true
						console.log("apply_diff tool executed!")
					}
				} catch (e) {
					console.log("Failed to parse api_req_started message:", e)
				}
			}
		}
		api.on("message", messageHandler)

		// Listen for task events
		const taskStartedHandler = (id: string) => {
			if (id === taskId) {
				taskStarted = true
				console.log("Task started:", id)
			}
		}
		api.on("taskStarted", taskStartedHandler)

		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
				console.log("Task completed:", id)
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task with apply_diff instruction - file already exists
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowWrite: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use apply_diff on the file ${testFile.name} to change "Hello World" to "Hello Universe". The file already exists with this content:
${testFile.content}\nAssume the file exists and you can modify it directly.`,
			}) //Temporary measure since list_files ignores all the files inside a tmp workspace

			console.log("Task ID:", taskId)
			console.log("Test filename:", testFile.name)

			// Wait for task to start
			await waitFor(() => taskStarted, { timeout: 60_000 })

			// Check for early errors
			if (errorOccurred) {
				console.error("Early error detected:", errorOccurred)
			}

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Give extra time for file system operations
			await sleep(2000)

			// Check if the file was modified correctly
			const actualContent = await fs.readFile(testFile.path, "utf-8")
			console.log("File content after modification:", actualContent)

			// Verify tool was executed
			assert.strictEqual(applyDiffExecuted, true, "apply_diff tool should have been executed")

			// Verify file content
			assert.strictEqual(
				actualContent.trim(),
				expectedContent.trim(),
				"File content should be modified correctly",
			)

			console.log("Test passed! apply_diff tool executed and file modified successfully")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskStarted", taskStartedHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should apply multiple search/replace blocks in single diff", async function () {
		// Increase timeout for this specific test

		const api = globalThis.api
		const messages: ClineMessage[] = []
		const testFile = testFiles.multipleReplace
		const expectedContent = `function compute(a, b) {
	const total = a + b
	const result = a * b
	return { total: total, result: result }
}`
		let taskStarted = false
		let taskCompleted = false
		let applyDiffExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)
			if (message.type === "ask" && message.ask === "tool") {
				console.log("Tool request:", message.text?.substring(0, 200))
			}
			if (message.type === "say" && message.text) {
				console.log("AI response:", message.text.substring(0, 200))
			}

			// Check for tool execution
			if (message.type === "say" && message.say === "api_req_started" && message.text) {
				console.log("API request started:", message.text.substring(0, 200))
				try {
					const requestData = JSON.parse(message.text)
					if (requestData.request && requestData.request.includes("apply_diff")) {
						applyDiffExecuted = true
						console.log("apply_diff tool executed!")
					}
				} catch (e) {
					console.log("Failed to parse api_req_started message:", e)
				}
			}
		}
		api.on("message", messageHandler)

		// Listen for task events
		const taskStartedHandler = (id: string) => {
			if (id === taskId) {
				taskStarted = true
				console.log("Task started:", id)
			}
		}
		api.on("taskStarted", taskStartedHandler)

		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
				console.log("Task completed:", id)
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task with multiple replacements - file already exists
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowWrite: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use apply_diff on the file ${testFile.name} to make ALL of these changes:
1. Rename function "calculate" to "compute"
2. Rename parameters "x, y" to "a, b"
3. Rename variable "sum" to "total" (including in the return statement)
4. Rename variable "product" to "result" (including in the return statement)
5. In the return statement, change { sum: sum, product: product } to { total: total, result: result }

The file already exists with this content:
${testFile.content}\nAssume the file exists and you can modify it directly.`,
			})

			console.log("Task ID:", taskId)
			console.log("Test filename:", testFile.name)

			// Wait for task to start
			await waitFor(() => taskStarted, { timeout: 60_000 })

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Give extra time for file system operations
			await sleep(2000)

			// Check the file was modified correctly
			const actualContent = await fs.readFile(testFile.path, "utf-8")
			console.log("File content after modification:", actualContent)

			// Verify tool was executed
			assert.strictEqual(applyDiffExecuted, true, "apply_diff tool should have been executed")

			// Verify file content
			assert.strictEqual(
				actualContent.trim(),
				expectedContent.trim(),
				"All replacements should be applied correctly",
			)

			console.log("Test passed! apply_diff tool executed and multiple replacements applied successfully")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskStarted", taskStartedHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should handle apply_diff with line number hints", async function () {
		// Increase timeout for this specific test

		const api = globalThis.api
		const messages: ClineMessage[] = []
		const testFile = testFiles.lineNumbers
		const expectedContent = `// Header comment
function newFunction() {
	console.log("New implementation")
}

// Another function
function keepThis() {
	console.log("Keep this")
}

// Footer comment`

		let taskStarted = false
		let taskCompleted = false
		let applyDiffExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)
			if (message.type === "ask" && message.ask === "tool") {
				console.log("Tool request:", message.text?.substring(0, 200))
			}

			// Check for tool execution
			if (message.type === "say" && message.say === "api_req_started" && message.text) {
				console.log("API request started:", message.text.substring(0, 200))
				try {
					const requestData = JSON.parse(message.text)
					if (requestData.request && requestData.request.includes("apply_diff")) {
						applyDiffExecuted = true
						console.log("apply_diff tool executed!")
					}
				} catch (e) {
					console.log("Failed to parse api_req_started message:", e)
				}
			}
		}
		api.on("message", messageHandler)

		// Listen for task events
		const taskStartedHandler = (id: string) => {
			if (id === taskId) {
				taskStarted = true
			}
		}
		api.on("taskStarted", taskStartedHandler)

		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task with line number context - file already exists
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowWrite: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use apply_diff on the file ${testFile.name} to change "oldFunction" to "newFunction" and update its console.log to "New implementation". Keep the rest of the file unchanged.

The file already exists with this content:
${testFile.content}\nAssume the file exists and you can modify it directly.`,
			})

			console.log("Task ID:", taskId)
			console.log("Test filename:", testFile.name)

			// Wait for task to start
			await waitFor(() => taskStarted, { timeout: 60_000 })

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Give extra time for file system operations
			await sleep(2000)

			// Check the file was modified correctly
			const actualContent = await fs.readFile(testFile.path, "utf-8")
			console.log("File content after modification:", actualContent)

			// Verify tool was executed
			assert.strictEqual(applyDiffExecuted, true, "apply_diff tool should have been executed")

			// Verify file content
			assert.strictEqual(
				actualContent.trim(),
				expectedContent.trim(),
				"Only specified function should be modified",
			)

			console.log("Test passed! apply_diff tool executed and targeted modification successful")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskStarted", taskStartedHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should handle apply_diff errors gracefully", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		const testFile = testFiles.errorHandling
		let taskStarted = false
		let taskCompleted = false
		let errorDetected = false
		let applyDiffAttempted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for error messages
			if (message.type === "say" && message.say === "error") {
				errorDetected = true
				console.log("Error detected:", message.text)
			}

			// Check if AI mentions it couldn't find the content
			if (message.type === "say" && message.text?.toLowerCase().includes("could not find")) {
				errorDetected = true
				console.log("AI reported search failure:", message.text)
			}

			// Check for tool execution attempt
			if (message.type === "say" && message.say === "api_req_started" && message.text) {
				console.log("API request started:", message.text.substring(0, 200))
				try {
					const requestData = JSON.parse(message.text)
					if (requestData.request && requestData.request.includes("apply_diff")) {
						applyDiffAttempted = true
						console.log("apply_diff tool attempted!")
					}
				} catch (e) {
					console.log("Failed to parse api_req_started message:", e)
				}
			}
		}
		api.on("message", messageHandler)

		// Listen for task events
		const taskStartedHandler = (id: string) => {
			if (id === taskId) {
				taskStarted = true
			}
		}
		api.on("taskStarted", taskStartedHandler)

		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task with invalid search content - file already exists
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowWrite: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use apply_diff on the file ${testFile.name} to replace "This content does not exist" with "New content".

The file already exists with this content:
${testFile.content}

IMPORTANT: The search pattern "This content does not exist" is NOT in the file. When apply_diff cannot find the search pattern, it should fail gracefully and the file content should remain unchanged. Do NOT try to use write_to_file or any other tool to modify the file. Only use apply_diff, and if the search pattern is not found, report that it could not be found.

Assume the file exists and you can modify it directly.`,
			})

			console.log("Task ID:", taskId)
			console.log("Test filename:", testFile.name)
			// Wait for task to start
			await waitFor(() => taskStarted, { timeout: 90_000 })

			// Wait for task completion or error
			await waitFor(() => taskCompleted || errorDetected, { timeout: 90_000 })

			// Give time for any final operations
			await sleep(2000)

			// The file content should remain unchanged since the search pattern wasn't found
			const actualContent = await fs.readFile(testFile.path, "utf-8")
			console.log("File content after task:", actualContent)

			// The AI should have attempted to use apply_diff
			assert.strictEqual(applyDiffAttempted, true, "apply_diff tool should have been attempted")

			// The content should remain unchanged since the search pattern wasn't found
			assert.strictEqual(
				actualContent.trim(),
				testFile.content.trim(),
				"File content should remain unchanged when search pattern not found",
			)

			console.log("Test passed! apply_diff attempted and error handled gracefully")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskStarted", taskStartedHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should apply multiple search/replace blocks to edit two separate functions", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		const testFile = testFiles.multiSearchReplace
		const expectedContent = `function transformData(data) {
	console.log("Transforming data")
	return data.map(item => item * 2)
}

// Some other code in between
const config = {
	timeout: 5000,
	retries: 3
}

function checkInput(input) {
	console.log("Checking input")
	if (!input) {
		throw new Error("Invalid input")
	}
	return true
}`
		let taskStarted = false
		let taskCompleted = false
		let errorOccurred: string | null = null
		let applyDiffExecuted = false
		let applyDiffCount = 0

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Log important messages for debugging
			if (message.type === "say" && message.say === "error") {
				errorOccurred = message.text || "Unknown error"
				console.error("Error:", message.text)
			}
			if (message.type === "ask" && message.ask === "tool") {
				console.log("Tool request:", message.text?.substring(0, 200))
			}
			if (message.type === "say" && (message.say === "completion_result" || message.say === "text")) {
				console.log("AI response:", message.text?.substring(0, 200))
			}

			// Check for tool execution
			if (message.type === "say" && message.say === "api_req_started" && message.text) {
				console.log("API request started:", message.text.substring(0, 200))
				try {
					const requestData = JSON.parse(message.text)
					if (requestData.request && requestData.request.includes("apply_diff")) {
						applyDiffExecuted = true
						applyDiffCount++
						console.log(`apply_diff tool executed! (count: ${applyDiffCount})`)
					}
				} catch (e) {
					console.log("Failed to parse api_req_started message:", e)
				}
			}
		}
		api.on("message", messageHandler)

		// Listen for task events
		const taskStartedHandler = (id: string) => {
			if (id === taskId) {
				taskStarted = true
				console.log("Task started:", id)
			}
		}
		api.on("taskStarted", taskStartedHandler)

		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
				console.log("Task completed:", id)
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task with instruction to edit two separate functions using multiple search/replace blocks
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowWrite: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use apply_diff on the file ${testFile.name} to make these changes. You MUST use TWO SEPARATE search/replace blocks within a SINGLE apply_diff call:

FIRST search/replace block: Edit the processData function to rename it to "transformData" and change "Processing data" to "Transforming data"

SECOND search/replace block: Edit the validateInput function to rename it to "checkInput" and change "Validating input" to "Checking input"

Important: Use multiple SEARCH/REPLACE blocks in one apply_diff call, NOT multiple apply_diff calls. Each function should have its own search/replace block.

The file already exists with this content:
${testFile.content}

Assume the file exists and you can modify it directly.`,
			})

			console.log("Task ID:", taskId)
			console.log("Test filename:", testFile.name)

			// Wait for task to start
			await waitFor(() => taskStarted, { timeout: 60_000 })

			// Check for early errors
			if (errorOccurred) {
				console.error("Early error detected:", errorOccurred)
			}

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Give extra time for file system operations
			await sleep(2000)

			// Check if the file was modified correctly
			const actualContent = await fs.readFile(testFile.path, "utf-8")
			console.log("File content after modification:", actualContent)

			// Verify tool was executed
			assert.strictEqual(applyDiffExecuted, true, "apply_diff tool should have been executed")
			console.log(`apply_diff was executed ${applyDiffCount} time(s)`)

			// Verify file content
			assert.strictEqual(
				actualContent.trim(),
				expectedContent.trim(),
				"Both functions should be modified with separate search/replace blocks",
			)

			console.log("Test passed! apply_diff tool executed and multiple search/replace blocks applied successfully")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskStarted", taskStartedHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})
})
