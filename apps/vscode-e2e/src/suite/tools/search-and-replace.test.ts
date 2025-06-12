import * as assert from "assert"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"

import type { ClineMessage } from "@roo-code/types"

import { waitFor, sleep } from "../utils"

suite("Roo Code search_and_replace Tool", () => {
	let workspaceDir: string

	// Pre-created test files that will be used across tests
	const testFiles = {
		simpleReplace: {
			name: `test-simple-replace-${Date.now()}.txt`,
			content: "Hello World\nThis is a test file\nWith multiple lines\nHello again",
			path: "",
		},
		regexReplace: {
			name: `test-regex-replace-${Date.now()}.js`,
			content: `function oldFunction() {
	console.log("old implementation")
	return "old result"
}

function anotherOldFunction() {
	console.log("another old implementation")
	return "another old result"
}`,
			path: "",
		},
		caseInsensitive: {
			name: `test-case-insensitive-${Date.now()}.txt`,
			content: `Hello World
HELLO UNIVERSE
hello everyone
HeLLo ThErE`,
			path: "",
		},
		multipleMatches: {
			name: `test-multiple-matches-${Date.now()}.txt`,
			content: `TODO: Fix this bug
This is some content
TODO: Add more tests
Some more content
TODO: Update documentation
Final content`,
			path: "",
		},
		noMatches: {
			name: `test-no-matches-${Date.now()}.txt`,
			content: "This file has no matching patterns\nJust regular content\nNothing special here",
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

	test("Should perform simple text replacement", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		const testFile = testFiles.simpleReplace
		const expectedContent = "Hello Universe\nThis is a test file\nWith multiple lines\nHello again"
		let taskStarted = false
		let taskCompleted = false
		let errorOccurred: string | null = null
		let searchReplaceExecuted = false

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
					if (requestData.request && requestData.request.includes("search_and_replace")) {
						searchReplaceExecuted = true
						console.log("search_and_replace tool executed!")
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
			// Start task with search_and_replace instruction
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowWrite: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use search_and_replace on the file ${testFile.name} to replace "Hello World" with "Hello Universe".

The file is located at: ${testFile.path}

The file already exists with this content:
${testFile.content}

Assume the file exists and you can modify it directly.`,
			})

			console.log("Task ID:", taskId)
			console.log("Test filename:", testFile.name)

			// Wait for task to start
			await waitFor(() => taskStarted, { timeout: 45_000 })

			// Check for early errors
			if (errorOccurred) {
				console.error("Early error detected:", errorOccurred)
			}

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 45_000 })

			// Give extra time for file system operations
			await sleep(2000)

			// Check if the file was modified correctly
			const actualContent = await fs.readFile(testFile.path, "utf-8")
			console.log("File content after modification:", actualContent)

			// Verify tool was executed
			assert.strictEqual(searchReplaceExecuted, true, "search_and_replace tool should have been executed")

			// Verify file content
			assert.strictEqual(
				actualContent.trim(),
				expectedContent.trim(),
				"File content should be modified correctly",
			)

			console.log("Test passed! search_and_replace tool executed and file modified successfully")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskStarted", taskStartedHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should perform regex pattern replacement", async function () {
		// Increase timeout for this test
		this.timeout(90_000)

		const api = globalThis.api
		const messages: ClineMessage[] = []
		const testFile = testFiles.regexReplace
		const expectedContent = `function newFunction() {
	console.log("new implementation")
	return "new result"
}

function anotherNewFunction() {
	console.log("another new implementation")
	return "another new result"
}`
		let taskStarted = false
		let taskCompleted = false
		let errorOccurred: string | null = null
		let searchReplaceExecuted = false

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
					if (requestData.request && requestData.request.includes("search_and_replace")) {
						searchReplaceExecuted = true
						console.log("search_and_replace tool executed!")
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
			// Start task with search_and_replace instruction - simpler and more direct
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowWrite: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use search_and_replace on the file ${testFile.name} to:
1. First, replace "old" with "new" (use_regex: false)
2. Then, replace "Old" with "New" (use_regex: false)

The file is located at: ${testFile.path}

Assume the file exists and you can modify it directly.

Use the search_and_replace tool twice - once for each replacement.`,
			})

			console.log("Task ID:", taskId)
			console.log("Test filename:", testFile.name)

			// Wait for task to start
			await waitFor(() => taskStarted, { timeout: 90_000 })

			// Check for early errors
			if (errorOccurred) {
				console.error("Early error detected:", errorOccurred)
			}

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 90_000 })

			// Give extra time for file system operations
			await sleep(2000)

			// Check if the file was modified correctly
			const actualContent = await fs.readFile(testFile.path, "utf-8")
			console.log("File content after modification:", actualContent)

			// Verify tool was executed
			assert.strictEqual(searchReplaceExecuted, true, "search_and_replace tool should have been executed")

			// Verify file content
			assert.strictEqual(
				actualContent.trim(),
				expectedContent.trim(),
				"File content should be modified with regex replacement",
			)

			console.log("Test passed! search_and_replace tool executed with regex successfully")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskStarted", taskStartedHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should replace multiple matches in file", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		const testFile = testFiles.multipleMatches
		const expectedContent = `DONE: Fix this bug
This is some content
DONE: Add more tests
Some more content
DONE: Update documentation
Final content`
		let taskStarted = false
		let taskCompleted = false
		let errorOccurred: string | null = null
		let searchReplaceExecuted = false

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
					if (requestData.request && requestData.request.includes("search_and_replace")) {
						searchReplaceExecuted = true
						console.log("search_and_replace tool executed!")
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
			// Start task with search_and_replace instruction for multiple matches
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowWrite: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use search_and_replace on the file ${testFile.name} to replace all occurrences of "TODO" with "DONE".

The file is located at: ${testFile.path}

The file already exists with this content:
${testFile.content}

Assume the file exists and you can modify it directly.`,
			})

			console.log("Task ID:", taskId)
			console.log("Test filename:", testFile.name)

			// Wait for task to start
			await waitFor(() => taskStarted, { timeout: 45_000 })

			// Check for early errors
			if (errorOccurred) {
				console.error("Early error detected:", errorOccurred)
			}

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 45_000 })

			// Give extra time for file system operations
			await sleep(2000)

			// Check if the file was modified correctly
			const actualContent = await fs.readFile(testFile.path, "utf-8")
			console.log("File content after modification:", actualContent)

			// Verify tool was executed
			assert.strictEqual(searchReplaceExecuted, true, "search_and_replace tool should have been executed")

			// Verify file content
			assert.strictEqual(
				actualContent.trim(),
				expectedContent.trim(),
				"All TODO occurrences should be replaced with DONE",
			)

			console.log("Test passed! search_and_replace tool executed and replaced multiple matches successfully")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskStarted", taskStartedHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should handle case when no matches are found", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		const testFile = testFiles.noMatches
		const expectedContent = testFile.content // Should remain unchanged
		let taskStarted = false
		let taskCompleted = false
		let errorOccurred: string | null = null
		let searchReplaceExecuted = false

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
					if (requestData.request && requestData.request.includes("search_and_replace")) {
						searchReplaceExecuted = true
						console.log("search_and_replace tool executed!")
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
			// Start task with search_and_replace instruction for pattern that won't match
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowWrite: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use search_and_replace on the file ${testFile.name} to replace "NONEXISTENT_PATTERN" with "REPLACEMENT". This pattern should not be found in the file.

The file is located at: ${testFile.path}

The file already exists with this content:
${testFile.content}

Assume the file exists and you can modify it directly.`,
			})

			console.log("Task ID:", taskId)
			console.log("Test filename:", testFile.name)

			// Wait for task to start
			await waitFor(() => taskStarted, { timeout: 45_000 })

			// Check for early errors
			if (errorOccurred) {
				console.error("Early error detected:", errorOccurred)
			}

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 45_000 })

			// Give extra time for file system operations
			await sleep(2000)

			// Check if the file remains unchanged
			const actualContent = await fs.readFile(testFile.path, "utf-8")
			console.log("File content after search (should be unchanged):", actualContent)

			// Verify tool was executed
			assert.strictEqual(searchReplaceExecuted, true, "search_and_replace tool should have been executed")

			// Verify file content remains unchanged
			assert.strictEqual(
				actualContent.trim(),
				expectedContent.trim(),
				"File content should remain unchanged when no matches are found",
			)

			console.log("Test passed! search_and_replace tool executed and handled no matches correctly")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskStarted", taskStartedHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})
})
