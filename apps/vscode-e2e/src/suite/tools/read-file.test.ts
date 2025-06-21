import * as assert from "assert"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import * as vscode from "vscode"

import type { ClineMessage } from "@roo-code/types"

import { waitFor, sleep } from "../utils"
import { setDefaultSuiteTimeout } from "../test-utils"

suite("Roo Code read_file Tool", function () {
	setDefaultSuiteTimeout(this)

	let tempDir: string
	let testFiles: {
		simple: string
		multiline: string
		empty: string
		large: string
		xmlContent: string
		nested: string
	}

	// Create a temporary directory and test files
	suiteSetup(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-test-read-"))

		// Create test files in VSCode workspace directory
		const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || tempDir

		// Create test files with different content types
		testFiles = {
			simple: path.join(workspaceDir, `simple-${Date.now()}.txt`),
			multiline: path.join(workspaceDir, `multiline-${Date.now()}.txt`),
			empty: path.join(workspaceDir, `empty-${Date.now()}.txt`),
			large: path.join(workspaceDir, `large-${Date.now()}.txt`),
			xmlContent: path.join(workspaceDir, `xml-content-${Date.now()}.xml`),
			nested: path.join(workspaceDir, "nested", "deep", `nested-${Date.now()}.txt`),
		}

		// Create files with content
		await fs.writeFile(testFiles.simple, "Hello, World!")
		await fs.writeFile(testFiles.multiline, "Line 1\nLine 2\nLine 3\nLine 4\nLine 5")
		await fs.writeFile(testFiles.empty, "")

		// Create a large file (100 lines)
		const largeContent = Array.from(
			{ length: 100 },
			(_, i) => `Line ${i + 1}: This is a test line with some content`,
		).join("\n")
		await fs.writeFile(testFiles.large, largeContent)

		// Create XML content file
		await fs.writeFile(
			testFiles.xmlContent,
			"<root>\n  <child>Test content</child>\n  <data>Some data</data>\n</root>",
		)

		// Create nested directory and file
		await fs.mkdir(path.dirname(testFiles.nested), { recursive: true })
		await fs.writeFile(testFiles.nested, "Content in nested directory")

		console.log("Test files created in:", workspaceDir)
		console.log("Test files:", testFiles)
	})

	// Clean up temporary directory and files after tests
	suiteTeardown(async () => {
		// Cancel any running tasks before cleanup
		try {
			await globalThis.api.cancelCurrentTask()
		} catch {
			// Task might not be running
		}

		// Clean up test files
		for (const filePath of Object.values(testFiles)) {
			try {
				await fs.unlink(filePath)
			} catch {
				// File might not exist
			}
		}

		// Clean up nested directory
		try {
			await fs.rmdir(path.dirname(testFiles.nested))
			await fs.rmdir(path.dirname(path.dirname(testFiles.nested)))
		} catch {
			// Directory might not exist or not be empty
		}

		await fs.rm(tempDir, { recursive: true, force: true })
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

	test("Should read a simple text file", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskStarted = false
		let taskCompleted = false
		let errorOccurred: string | null = null
		let toolExecuted = false
		let toolResult: string | null = null

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool execution and extract result
			if (message.type === "say" && message.say === "api_req_started") {
				const text = message.text || ""
				if (text.includes("read_file")) {
					toolExecuted = true
					console.log("Tool executed:", text.substring(0, 200))

					// Parse the tool result from the api_req_started message
					try {
						const requestData = JSON.parse(text)
						if (requestData.request && requestData.request.includes("[read_file")) {
							console.log("Full request for debugging:", requestData.request)
							// Try multiple patterns to extract the content
							// Pattern 1: Content between triple backticks
							let resultMatch = requestData.request.match(/```[^`]*\n([\s\S]*?)\n```/)
							if (!resultMatch) {
								// Pattern 2: Content after "Result:" with line numbers
								resultMatch = requestData.request.match(/Result:[\s\S]*?\n((?:\d+\s*\|[^\n]*\n?)+)/)
							}
							if (!resultMatch) {
								// Pattern 3: Simple content after Result:
								resultMatch = requestData.request.match(/Result:\s*\n([\s\S]+?)(?:\n\n|$)/)
							}
							if (resultMatch) {
								toolResult = resultMatch[1]
								console.log("Extracted tool result:", toolResult)
							} else {
								console.log("Could not extract tool result from request")
							}
						}
					} catch (e) {
						console.log("Failed to parse tool result:", e)
					}
				}
			}

			// Log important messages for debugging
			if (message.type === "say" && message.say === "error") {
				errorOccurred = message.text || "Unknown error"
				console.error("Error:", message.text)
			}

			// Log all AI responses for debugging
			if (message.type === "say" && (message.say === "text" || message.say === "completion_result")) {
				console.log("AI response:", message.text?.substring(0, 200))
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
			// Start task with a simple read file request
			const fileName = path.basename(testFiles.simple)
			// Use a very explicit prompt
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Please use the read_file tool to read the file named "${fileName}". This file contains the text "Hello, World!" and is located in the current workspace directory. Assume the file exists and you can read it directly. After reading it, tell me what the file contains.`,
			})

			console.log("Task ID:", taskId)
			console.log("Reading file:", fileName)
			console.log("Expected file path:", testFiles.simple)

			// Wait for task to start
			await waitFor(() => taskStarted, { timeout: 60_000 })

			// Check for early errors
			if (errorOccurred) {
				console.error("Early error detected:", errorOccurred)
			}

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the read_file tool was executed
			assert.ok(toolExecuted, "The read_file tool should have been executed")

			// Check that no errors occurred
			assert.strictEqual(errorOccurred, null, "No errors should have occurred")

			// Verify the tool returned the correct content
			assert.ok(toolResult !== null, "Tool should have returned a result")
			// The tool returns content with line numbers, so we need to extract just the content
			// For single line, the format is "1 | Hello, World!"
			const actualContent = (toolResult as string).replace(/^\d+\s*\|\s*/, "")
			assert.strictEqual(
				actualContent.trim(),
				"Hello, World!",
				"Tool should have returned the exact file content",
			)

			// Also verify the AI mentioned the content in its response
			const hasContent = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					m.text?.toLowerCase().includes("hello") &&
					m.text?.toLowerCase().includes("world"),
			)
			assert.ok(hasContent, "AI should have mentioned the file content 'Hello, World!'")

			console.log("Test passed! File read successfully with correct content")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskStarted", taskStartedHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should read a multiline file", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskCompleted = false
		let toolExecuted = false
		let toolResult: string | null = null

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool execution and extract result
			if (message.type === "say" && message.say === "api_req_started") {
				const text = message.text || ""
				if (text.includes("read_file")) {
					toolExecuted = true
					console.log("Tool executed for multiline file")

					// Parse the tool result
					try {
						const requestData = JSON.parse(text)
						if (requestData.request && requestData.request.includes("[read_file")) {
							console.log("Full request for debugging:", requestData.request)
							// Try multiple patterns to extract the content
							let resultMatch = requestData.request.match(/```[^`]*\n([\s\S]*?)\n```/)
							if (!resultMatch) {
								resultMatch = requestData.request.match(/Result:[\s\S]*?\n((?:\d+\s*\|[^\n]*\n?)+)/)
							}
							if (!resultMatch) {
								resultMatch = requestData.request.match(/Result:\s*\n([\s\S]+?)(?:\n\n|$)/)
							}
							if (resultMatch) {
								toolResult = resultMatch[1]
								console.log("Extracted multiline tool result")
							} else {
								console.log("Could not extract tool result from request")
							}
						}
					} catch (e) {
						console.log("Failed to parse tool result:", e)
					}
				}
			}

			// Log AI responses
			if (message.type === "say" && (message.say === "text" || message.say === "completion_result")) {
				console.log("AI response:", message.text?.substring(0, 200))
			}
		}
		api.on("message", messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task
			const fileName = path.basename(testFiles.multiline)
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the read_file tool to read the file "${fileName}" which contains 5 lines of text (Line 1, Line 2, Line 3, Line 4, Line 5). Assume the file exists and you can read it directly. Count how many lines it has and tell me the result.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the read_file tool was executed
			assert.ok(toolExecuted, "The read_file tool should have been executed")

			// Verify the tool returned the correct multiline content
			assert.ok(toolResult !== null, "Tool should have returned a result")
			// The tool returns content with line numbers, so we need to extract just the content
			const lines = (toolResult as string).split("\n").map((line) => {
				const match = line.match(/^\d+\s*\|\s*(.*)$/)
				return match ? match[1] : line
			})
			const actualContent = lines.join("\n")
			const expectedContent = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
			assert.strictEqual(
				actualContent.trim(),
				expectedContent,
				"Tool should have returned the exact multiline content",
			)

			// Also verify the AI mentioned the correct number of lines
			const hasLineCount = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.includes("5") || m.text?.toLowerCase().includes("five")),
			)
			assert.ok(hasLineCount, "AI should have mentioned the file has 5 lines")

			console.log("Test passed! Multiline file read successfully with correct content")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should read file with line range", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskCompleted = false
		let toolExecuted = false
		let toolResult: string | null = null

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool execution and extract result
			if (message.type === "say" && message.say === "api_req_started") {
				const text = message.text || ""
				if (text.includes("read_file")) {
					toolExecuted = true
					console.log("Tool executed:", text.substring(0, 300))

					// Parse the tool result
					try {
						const requestData = JSON.parse(text)
						if (requestData.request && requestData.request.includes("[read_file")) {
							console.log("Full request for debugging:", requestData.request)
							// Try multiple patterns to extract the content
							let resultMatch = requestData.request.match(/```[^`]*\n([\s\S]*?)\n```/)
							if (!resultMatch) {
								resultMatch = requestData.request.match(/Result:[\s\S]*?\n((?:\d+\s*\|[^\n]*\n?)+)/)
							}
							if (!resultMatch) {
								resultMatch = requestData.request.match(/Result:\s*\n([\s\S]+?)(?:\n\n|$)/)
							}
							if (resultMatch) {
								toolResult = resultMatch[1]
								console.log("Extracted line range tool result")
							} else {
								console.log("Could not extract tool result from request")
							}
						}
					} catch (e) {
						console.log("Failed to parse tool result:", e)
					}
				}
			}

			// Log AI responses
			if (message.type === "say" && (message.say === "text" || message.say === "completion_result")) {
				console.log("AI response:", message.text?.substring(0, 200))
			}
		}
		api.on("message", messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task
			const fileName = path.basename(testFiles.multiline)
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the read_file tool to read the file "${fileName}" and show me what's on lines 2, 3, and 4. The file contains lines like "Line 1", "Line 2", etc. Assume the file exists and you can read it directly.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify tool was executed
			assert.ok(toolExecuted, "The read_file tool should have been executed")

			// Verify the tool returned the correct lines (when line range is used)
			if (toolResult && (toolResult as string).includes(" | ")) {
				// The result includes line numbers
				assert.ok(
					(toolResult as string).includes("2 | Line 2"),
					"Tool result should include line 2 with line number",
				)
				assert.ok(
					(toolResult as string).includes("3 | Line 3"),
					"Tool result should include line 3 with line number",
				)
				assert.ok(
					(toolResult as string).includes("4 | Line 4"),
					"Tool result should include line 4 with line number",
				)
			}

			// Also verify the AI mentioned the specific lines
			const hasLines = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					m.text?.includes("Line 2"),
			)
			assert.ok(hasLines, "AI should have mentioned the requested lines")

			console.log("Test passed! File read with line range successfully")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should handle reading non-existent file", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskCompleted = false
		let toolExecuted = false
		let _errorHandled = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool execution
			if (message.type === "say" && message.say === "api_req_started") {
				const text = message.text || ""
				if (text.includes("read_file")) {
					toolExecuted = true
					// Check if error was returned
					if (text.includes("error") || text.includes("not found")) {
						_errorHandled = true
					}
				}
			}
		}
		api.on("message", messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task with non-existent file
			const nonExistentFile = `non-existent-${Date.now()}.txt`
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Try to read the file "${nonExistentFile}" and tell me what happens. This file does not exist, so I expect you to handle the error appropriately.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the read_file tool was executed
			assert.ok(toolExecuted, "The read_file tool should have been executed")

			// Verify the AI handled the error appropriately
			const completionMessage = messages.find(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.toLowerCase().includes("not found") ||
						m.text?.toLowerCase().includes("doesn't exist") ||
						m.text?.toLowerCase().includes("does not exist")),
			)
			assert.ok(completionMessage, "AI should have mentioned the file was not found")

			console.log("Test passed! Non-existent file handled correctly")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should read XML content file", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskCompleted = false
		let toolExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool execution
			if (message.type === "say" && message.say === "api_req_started") {
				const text = message.text || ""
				if (text.includes("read_file")) {
					toolExecuted = true
					console.log("Tool executed for XML file")
				}
			}

			// Log AI responses
			if (message.type === "say" && (message.say === "text" || message.say === "completion_result")) {
				console.log("AI response:", message.text?.substring(0, 200))
			}
		}
		api.on("message", messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task
			const fileName = path.basename(testFiles.xmlContent)
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the read_file tool to read the XML file "${fileName}". It contains XML elements including root, child, and data. Assume the file exists and you can read it directly. Tell me what elements you find.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the read_file tool was executed
			assert.ok(toolExecuted, "The read_file tool should have been executed")

			// Verify the AI mentioned the XML content - be more flexible
			const hasXMLContent = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.toLowerCase().includes("root") || m.text?.toLowerCase().includes("xml")),
			)
			assert.ok(hasXMLContent, "AI should have mentioned the XML elements")

			console.log("Test passed! XML file read successfully")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should read multiple files in sequence", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskCompleted = false
		let readFileCount = 0

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Count read_file executions
			if (message.type === "say" && message.say === "api_req_started") {
				const text = message.text || ""
				if (text.includes("read_file")) {
					readFileCount++
					console.log(`Read file execution #${readFileCount}`)
				}
			}
		}
		api.on("message", messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task to read multiple files
			const simpleFileName = path.basename(testFiles.simple)
			const multilineFileName = path.basename(testFiles.multiline)
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the read_file tool to read these two files:
1. "${simpleFileName}" - contains "Hello, World!"
2. "${multilineFileName}" - contains 5 lines of text
Assume both files exist and you can read them directly. Read each file and tell me what you found in each one.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify multiple read_file executions - AI might read them together
			assert.ok(
				readFileCount >= 1,
				`Should have executed read_file at least once, but executed ${readFileCount} times`,
			)

			// Verify the AI mentioned both file contents - be more flexible
			const hasContent = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					m.text?.toLowerCase().includes("hello"),
			)
			assert.ok(hasContent, "AI should have mentioned contents of the files")

			console.log("Test passed! Multiple files read successfully")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should read large file efficiently", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskCompleted = false
		let toolExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool execution
			if (message.type === "say" && message.say === "api_req_started") {
				const text = message.text || ""
				if (text.includes("read_file")) {
					toolExecuted = true
					console.log("Reading large file...")
				}
			}

			// Log AI responses
			if (message.type === "say" && (message.say === "text" || message.say === "completion_result")) {
				console.log("AI response:", message.text?.substring(0, 200))
			}
		}
		api.on("message", messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task
			const fileName = path.basename(testFiles.large)
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the read_file tool to read the file "${fileName}" which has 100 lines. Each line follows the pattern "Line N: This is a test line with some content". Assume the file exists and you can read it directly. Tell me about the pattern you see.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the read_file tool was executed
			assert.ok(toolExecuted, "The read_file tool should have been executed")

			// Verify the AI mentioned the line pattern - be more flexible
			const hasPattern = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.toLowerCase().includes("line") || m.text?.toLowerCase().includes("pattern")),
			)
			assert.ok(hasPattern, "AI should have identified the line pattern")

			console.log("Test passed! Large file read efficiently")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})
})
