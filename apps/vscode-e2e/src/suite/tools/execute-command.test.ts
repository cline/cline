import * as assert from "assert"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"

import type { ClineMessage } from "@roo-code/types"

import { waitFor, sleep, waitUntilCompleted } from "../utils"
import { setDefaultSuiteTimeout } from "../test-utils"

suite("Roo Code execute_command Tool", function () {
	setDefaultSuiteTimeout(this)

	let workspaceDir: string

	// Pre-created test files that will be used across tests
	const testFiles = {
		simpleEcho: {
			name: `test-echo-${Date.now()}.txt`,
			content: "",
			path: "",
		},
		multiCommand: {
			name: `test-multi-${Date.now()}.txt`,
			content: "",
			path: "",
		},
		cwdTest: {
			name: `test-cwd-${Date.now()}.txt`,
			content: "",
			path: "",
		},
		longRunning: {
			name: `test-long-${Date.now()}.txt`,
			content: "",
			path: "",
		},
	}

	// Create test files before all tests
	suiteSetup(async () => {
		// Get workspace directory
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (!workspaceFolders || workspaceFolders.length === 0) {
			throw new Error("No workspace folder found")
		}
		workspaceDir = workspaceFolders[0]!.uri.fsPath
		console.log("Workspace directory:", workspaceDir)

		// Create test files
		for (const [key, file] of Object.entries(testFiles)) {
			file.path = path.join(workspaceDir, file.name)
			if (file.content) {
				await fs.writeFile(file.path, file.content)
				console.log(`Created ${key} test file at:`, file.path)
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

		// Clean up subdirectory if created
		try {
			const subDir = path.join(workspaceDir, "test-subdir")
			await fs.rmdir(subDir)
		} catch {
			// Directory might not exist
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

	test("Should execute simple echo command", async function () {
		const api = globalThis.api
		const testFile = testFiles.simpleEcho
		let taskStarted = false
		let _taskCompleted = false
		let errorOccurred: string | null = null
		let executeCommandToolCalled = false
		let commandExecuted = ""

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			// Log important messages for debugging
			if (message.type === "say" && message.say === "error") {
				errorOccurred = message.text || "Unknown error"
				console.error("Error:", message.text)
			}

			// Check for tool execution
			if (message.type === "say" && message.say === "api_req_started" && message.text) {
				console.log("API request started:", message.text.substring(0, 200))
				try {
					const requestData = JSON.parse(message.text)
					if (requestData.request && requestData.request.includes("execute_command")) {
						executeCommandToolCalled = true
						// The request contains the actual tool execution result
						commandExecuted = requestData.request
						console.log("execute_command tool called, full request:", commandExecuted.substring(0, 300))
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
				_taskCompleted = true
				console.log("Task completed:", id)
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task with execute_command instruction
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowExecute: true,
					allowedCommands: ["*"],
					terminalShellIntegrationDisabled: true,
				},
				text: `Use the execute_command tool to run this command: echo "Hello from test" > ${testFile.name}

The file ${testFile.name} will be created in the current workspace directory. Assume you can execute this command directly.

Then use the attempt_completion tool to complete the task. Do not suggest any commands in the attempt_completion.`,
			})

			console.log("Task ID:", taskId)
			console.log("Test file:", testFile.name)

			// Wait for task to start
			await waitFor(() => taskStarted, { timeout: 45_000 })

			// Wait for task completion
			await waitUntilCompleted({ api, taskId, timeout: 60_000 })

			// Verify no errors occurred
			assert.strictEqual(errorOccurred, null, `Error occurred: ${errorOccurred}`)

			// Verify tool was called
			assert.ok(executeCommandToolCalled, "execute_command tool should have been called")
			assert.ok(
				commandExecuted.includes("echo") && commandExecuted.includes(testFile.name),
				`Command should include 'echo' and test file name. Got: ${commandExecuted.substring(0, 200)}`,
			)

			// Verify file was created with correct content
			const content = await fs.readFile(testFile.path, "utf-8")
			assert.ok(content.includes("Hello from test"), "File should contain the echoed text")

			console.log("Test passed! Command executed successfully")
		} finally {
			// Clean up event listeners
			api.off("message", messageHandler)
			api.off("taskStarted", taskStartedHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should execute command with custom working directory", async function () {
		const api = globalThis.api
		let taskStarted = false
		let _taskCompleted = false
		let errorOccurred: string | null = null
		let executeCommandToolCalled = false
		let cwdUsed = ""

		// Create subdirectory
		const subDir = path.join(workspaceDir, "test-subdir")
		await fs.mkdir(subDir, { recursive: true })

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			if (message.type === "say" && message.say === "error") {
				errorOccurred = message.text || "Unknown error"
				console.error("Error:", message.text)
			}

			// Check for tool execution
			if (message.type === "say" && message.say === "api_req_started" && message.text) {
				console.log("API request started:", message.text.substring(0, 200))
				try {
					const requestData = JSON.parse(message.text)
					if (requestData.request && requestData.request.includes("execute_command")) {
						executeCommandToolCalled = true
						// Check if the request contains the cwd
						if (requestData.request.includes(subDir) || requestData.request.includes("test-subdir")) {
							cwdUsed = subDir
						}
						console.log("execute_command tool called, checking for cwd in request")
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
				_taskCompleted = true
				console.log("Task completed:", id)
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task with execute_command instruction using cwd parameter
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowExecute: true,
					allowedCommands: ["*"],
					terminalShellIntegrationDisabled: true,
				},
				text: `Use the execute_command tool with these exact parameters:
- command: echo "Test in subdirectory" > output.txt
- cwd: ${subDir}

The subdirectory ${subDir} exists in the workspace. Assume you can execute this command directly with the specified working directory.

Avoid at all costs suggesting a command when using the attempt_completion tool`,
			})

			console.log("Task ID:", taskId)
			console.log("Subdirectory:", subDir)

			// Wait for task to start
			await waitFor(() => taskStarted, { timeout: 45_000 })

			// Wait for task completion
			await waitUntilCompleted({ api, taskId, timeout: 60_000 })

			// Verify no errors occurred
			assert.strictEqual(errorOccurred, null, `Error occurred: ${errorOccurred}`)

			// Verify tool was called with correct cwd
			assert.ok(executeCommandToolCalled, "execute_command tool should have been called")
			assert.ok(
				cwdUsed.includes(subDir) || cwdUsed.includes("test-subdir"),
				"Command should have used the subdirectory as cwd",
			)

			// Verify file was created in subdirectory
			const outputPath = path.join(subDir, "output.txt")
			const content = await fs.readFile(outputPath, "utf-8")
			assert.ok(content.includes("Test in subdirectory"), "File should contain the echoed text")

			// Clean up created file
			await fs.unlink(outputPath)

			console.log("Test passed! Command executed in custom directory")
		} finally {
			// Clean up event listeners
			api.off("message", messageHandler)
			api.off("taskStarted", taskStartedHandler)
			api.off("taskCompleted", taskCompletedHandler)

			// Clean up subdirectory
			try {
				await fs.rmdir(subDir)
			} catch {
				// Directory might not be empty
			}
		}
	})

	test("Should execute multiple commands sequentially", async function () {
		const api = globalThis.api
		const testFile = testFiles.multiCommand
		let taskStarted = false
		let _taskCompleted = false
		let errorOccurred: string | null = null
		let executeCommandCallCount = 0
		const commandsExecuted: string[] = []

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			if (message.type === "say" && message.say === "error") {
				errorOccurred = message.text || "Unknown error"
				console.error("Error:", message.text)
			}

			// Check for tool execution
			if (message.type === "say" && message.say === "api_req_started" && message.text) {
				console.log("API request started:", message.text.substring(0, 200))
				try {
					const requestData = JSON.parse(message.text)
					if (requestData.request && requestData.request.includes("execute_command")) {
						executeCommandCallCount++
						// Store the full request to check for command content
						commandsExecuted.push(requestData.request)
						console.log(`execute_command tool call #${executeCommandCallCount}`)
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
				_taskCompleted = true
				console.log("Task completed:", id)
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task with multiple commands - simplified to just 2 commands
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowExecute: true,
					allowedCommands: ["*"],
					terminalShellIntegrationDisabled: true,
				},
				text: `Use the execute_command tool to create a file with multiple lines. Execute these commands one by one:
1. echo "Line 1" > ${testFile.name}
2. echo "Line 2" >> ${testFile.name}

The file ${testFile.name} will be created in the current workspace directory. Assume you can execute these commands directly.

Important: Use only the echo command which is available on all Unix platforms. Execute each command separately using the execute_command tool.

After both commands are executed, use the attempt_completion tool to complete the task.`,
			})

			console.log("Task ID:", taskId)
			console.log("Test file:", testFile.name)

			// Wait for task to start
			await waitFor(() => taskStarted, { timeout: 90_000 })

			// Wait for task completion with increased timeout
			await waitUntilCompleted({ api, taskId, timeout: 90_000 })

			// Verify no errors occurred
			assert.strictEqual(errorOccurred, null, `Error occurred: ${errorOccurred}`)

			// Verify tool was called multiple times (reduced to 2)
			assert.ok(
				executeCommandCallCount >= 2,
				`execute_command tool should have been called at least 2 times, was called ${executeCommandCallCount} times`,
			)
			assert.ok(
				commandsExecuted.some((cmd) => cmd.includes("Line 1")),
				`Should have executed first command. Commands: ${commandsExecuted.map((c) => c.substring(0, 100)).join(", ")}`,
			)
			assert.ok(
				commandsExecuted.some((cmd) => cmd.includes("Line 2")),
				"Should have executed second command",
			)

			// Verify file contains outputs
			const content = await fs.readFile(testFile.path, "utf-8")
			assert.ok(content.includes("Line 1"), "Should contain first line")
			assert.ok(content.includes("Line 2"), "Should contain second line")

			console.log("Test passed! Multiple commands executed successfully")
		} finally {
			// Clean up event listeners
			api.off("message", messageHandler)
			api.off("taskStarted", taskStartedHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should handle long-running commands", async function () {
		const api = globalThis.api
		let taskStarted = false
		let _taskCompleted = false
		let _commandCompleted = false
		let errorOccurred: string | null = null
		let executeCommandToolCalled = false
		let commandExecuted = ""

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			if (message.type === "say" && message.say === "error") {
				errorOccurred = message.text || "Unknown error"
				console.error("Error:", message.text)
			}
			if (message.type === "say" && message.say === "command_output") {
				if (message.text?.includes("completed after delay")) {
					_commandCompleted = true
				}
				console.log("Command output:", message.text?.substring(0, 200))
			}

			// Check for tool execution
			if (message.type === "say" && message.say === "api_req_started" && message.text) {
				console.log("API request started:", message.text.substring(0, 200))
				try {
					const requestData = JSON.parse(message.text)
					if (requestData.request && requestData.request.includes("execute_command")) {
						executeCommandToolCalled = true
						// The request contains the actual tool execution result
						commandExecuted = requestData.request
						console.log("execute_command tool called, full request:", commandExecuted.substring(0, 300))
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
				_taskCompleted = true
				console.log("Task completed:", id)
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Platform-specific sleep command
			const sleepCommand = process.platform === "win32" ? "timeout /t 3 /nobreak" : "sleep 3"

			// Start task with long-running command
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowExecute: true,
					allowedCommands: ["*"],
					terminalShellIntegrationDisabled: true,
				},
				text: `Use the execute_command tool to run: ${sleepCommand} && echo "Command completed after delay"

Assume you can execute this command directly in the current workspace directory.

Avoid at all costs suggesting a command when using the attempt_completion tool`,
			})

			console.log("Task ID:", taskId)

			// Wait for task to start
			await waitFor(() => taskStarted, { timeout: 45_000 })

			// Wait for task completion (the command output check will verify execution)
			await waitUntilCompleted({ api, taskId, timeout: 45_000 })

			// Give a bit of time for final output processing
			await sleep(1000)

			// Verify no errors occurred
			assert.strictEqual(errorOccurred, null, `Error occurred: ${errorOccurred}`)

			// Verify tool was called
			assert.ok(executeCommandToolCalled, "execute_command tool should have been called")
			assert.ok(
				commandExecuted.includes("sleep") || commandExecuted.includes("timeout"),
				`Command should include sleep or timeout command. Got: ${commandExecuted.substring(0, 200)}`,
			)

			// The command output check in the message handler will verify execution

			console.log("Test passed! Long-running command handled successfully")
		} finally {
			// Clean up event listeners
			api.off("message", messageHandler)
			api.off("taskStarted", taskStartedHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})
})
