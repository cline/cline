import * as assert from "assert"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import * as vscode from "vscode"

import type { ClineMessage } from "@roo-code/types"

import { waitFor, sleep } from "../utils"
import { setDefaultSuiteTimeout } from "../test-utils"

suite("Roo Code use_mcp_tool Tool", function () {
	setDefaultSuiteTimeout(this)

	let tempDir: string
	let testFiles: {
		simple: string
		testData: string
		mcpConfig: string
	}

	// Create a temporary directory and test files
	suiteSetup(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-test-mcp-"))

		// Create test files in VSCode workspace directory
		const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || tempDir

		// Create test files for MCP filesystem operations
		testFiles = {
			simple: path.join(workspaceDir, `mcp-test-${Date.now()}.txt`),
			testData: path.join(workspaceDir, `mcp-data-${Date.now()}.json`),
			mcpConfig: path.join(workspaceDir, ".roo", "mcp.json"),
		}

		// Create initial test files
		await fs.writeFile(testFiles.simple, "Initial content for MCP test")
		await fs.writeFile(testFiles.testData, JSON.stringify({ test: "data", value: 42 }, null, 2))

		// Create .roo directory and MCP configuration file
		const rooDir = path.join(workspaceDir, ".roo")
		await fs.mkdir(rooDir, { recursive: true })

		const mcpConfig = {
			mcpServers: {
				filesystem: {
					command: "npx",
					args: ["-y", "@modelcontextprotocol/server-filesystem", workspaceDir],
					alwaysAllow: [],
				},
			},
		}
		await fs.writeFile(testFiles.mcpConfig, JSON.stringify(mcpConfig, null, 2))

		console.log("MCP test files created in:", workspaceDir)
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

		// Clean up .roo directory
		const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || tempDir
		const rooDir = path.join(workspaceDir, ".roo")
		try {
			await fs.rm(rooDir, { recursive: true, force: true })
		} catch {
			// Directory might not exist
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

	test("Should request MCP filesystem read_file tool and complete successfully", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskStarted = false
		let _taskCompleted = false
		let mcpToolRequested = false
		let mcpToolName: string | null = null
		let mcpServerResponse: string | null = null
		let attemptCompletionCalled = false
		let errorOccurred: string | null = null

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for MCP tool request
			if (message.type === "ask" && message.ask === "use_mcp_server") {
				mcpToolRequested = true
				console.log("MCP tool request:", message.text?.substring(0, 200))

				// Parse the MCP request to verify structure and tool name
				if (message.text) {
					try {
						const mcpRequest = JSON.parse(message.text)
						mcpToolName = mcpRequest.toolName
						console.log("MCP request parsed:", {
							type: mcpRequest.type,
							serverName: mcpRequest.serverName,
							toolName: mcpRequest.toolName,
							hasArguments: !!mcpRequest.arguments,
						})
					} catch (e) {
						console.log("Failed to parse MCP request:", e)
					}
				}
			}

			// Check for MCP server response
			if (message.type === "say" && message.say === "mcp_server_response") {
				mcpServerResponse = message.text || null
				console.log("MCP server response received:", message.text?.substring(0, 200))
			}

			// Check for attempt_completion
			if (message.type === "say" && message.say === "completion_result") {
				attemptCompletionCalled = true
				console.log("Attempt completion called:", message.text?.substring(0, 200))
			}

			// Log important messages for debugging
			if (message.type === "say" && message.say === "error") {
				errorOccurred = message.text || "Unknown error"
				console.error("Error:", message.text)
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
		await sleep(2000) // Wait for Roo Code to fully initialize

		// Trigger MCP server detection by opening and modifying the file
		console.log("Triggering MCP server detection by modifying the config file...")
		try {
			const mcpConfigUri = vscode.Uri.file(testFiles.mcpConfig)
			const document = await vscode.workspace.openTextDocument(mcpConfigUri)
			const editor = await vscode.window.showTextDocument(document)

			// Make a small modification to trigger the save event, without this Roo Code won't load the MCP server
			const edit = new vscode.WorkspaceEdit()
			const currentContent = document.getText()
			const modifiedContent = currentContent.replace(
				'"alwaysAllow": []',
				'"alwaysAllow": ["read_file", "read_multiple_files", "write_file", "edit_file", "create_directory", "list_directory", "directory_tree", "move_file", "search_files", "get_file_info", "list_allowed_directories"]',
			)

			const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length))

			edit.replace(mcpConfigUri, fullRange, modifiedContent)
			await vscode.workspace.applyEdit(edit)

			// Save the document to trigger MCP server detection
			await editor.document.save()

			// Close the editor
			await vscode.commands.executeCommand("workbench.action.closeActiveEditor")

			console.log("MCP config file modified and saved successfully")
		} catch (error) {
			console.error("Failed to modify/save MCP config file:", error)
		}

		await sleep(5000) // Wait for MCP servers to initialize
		let taskId: string
		try {
			// Start task requesting to use MCP filesystem read_file tool
			const fileName = path.basename(testFiles.simple)
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowMcp: true, // Enable MCP auto-approval
					mcpEnabled: true,
				},
				text: `Use the MCP filesystem server's read_file tool to read the file "${fileName}". The file exists in the workspace and contains "Initial content for MCP test".`,
			})

			console.log("Task ID:", taskId)
			console.log("Requesting MCP filesystem read_file for:", fileName)

			// Wait for task to start
			await waitFor(() => taskStarted, { timeout: 45_000 })

			// Wait for attempt_completion to be called (indicating task finished)
			await waitFor(() => attemptCompletionCalled, { timeout: 45_000 })

			// Verify the MCP tool was requested
			assert.ok(mcpToolRequested, "The use_mcp_tool should have been requested")

			// Verify the correct tool was used
			assert.strictEqual(mcpToolName, "read_file", "Should have used the read_file tool")

			// Verify we got a response from the MCP server
			assert.ok(mcpServerResponse, "Should have received a response from the MCP server")

			// Verify the response contains expected file content (not an error)
			const responseText = mcpServerResponse as string

			// Check for specific file content keywords
			assert.ok(
				responseText.includes("Initial content for MCP test"),
				`MCP server response should contain the exact file content. Got: ${responseText.substring(0, 100)}...`,
			)

			// Verify it contains the specific words from our test file
			assert.ok(
				responseText.includes("Initial") &&
					responseText.includes("content") &&
					responseText.includes("MCP") &&
					responseText.includes("test"),
				`MCP server response should contain all expected keywords: Initial, content, MCP, test. Got: ${responseText.substring(0, 100)}...`,
			)

			// Ensure no errors are present
			assert.ok(
				!responseText.toLowerCase().includes("error") && !responseText.toLowerCase().includes("failed"),
				`MCP server response should not contain error messages. Got: ${responseText.substring(0, 100)}...`,
			)

			// Verify task completed successfully
			assert.ok(attemptCompletionCalled, "Task should have completed with attempt_completion")

			// Check that no errors occurred
			assert.strictEqual(errorOccurred, null, "No errors should have occurred")

			console.log("Test passed! MCP read_file tool used successfully and task completed")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskStarted", taskStartedHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should request MCP filesystem write_file tool and complete successfully", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let _taskCompleted = false
		let mcpToolRequested = false
		let mcpToolName: string | null = null
		let mcpServerResponse: string | null = null
		let attemptCompletionCalled = false
		let errorOccurred: string | null = null

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for MCP tool request
			if (message.type === "ask" && message.ask === "use_mcp_server") {
				mcpToolRequested = true
				console.log("MCP tool request:", message.text?.substring(0, 200))

				// Parse the MCP request to verify structure and tool name
				if (message.text) {
					try {
						const mcpRequest = JSON.parse(message.text)
						mcpToolName = mcpRequest.toolName
						console.log("MCP request parsed:", {
							type: mcpRequest.type,
							serverName: mcpRequest.serverName,
							toolName: mcpRequest.toolName,
							hasArguments: !!mcpRequest.arguments,
						})
					} catch (e) {
						console.log("Failed to parse MCP request:", e)
					}
				}
			}

			// Check for MCP server response
			if (message.type === "say" && message.say === "mcp_server_response") {
				mcpServerResponse = message.text || null
				console.log("MCP server response received:", message.text?.substring(0, 200))
			}

			// Check for attempt_completion
			if (message.type === "say" && message.say === "completion_result") {
				attemptCompletionCalled = true
				console.log("Attempt completion called:", message.text?.substring(0, 200))
			}

			// Log important messages for debugging
			if (message.type === "say" && message.say === "error") {
				errorOccurred = message.text || "Unknown error"
				console.error("Error:", message.text)
			}
		}
		api.on("message", messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				_taskCompleted = true
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task requesting to use MCP filesystem write_file tool
			const newFileName = `mcp-write-test-${Date.now()}.txt`
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowMcp: true,
					mcpEnabled: true,
				},
				text: `Use the MCP filesystem server's write_file tool to create a new file called "${newFileName}" with the content "Hello from MCP!".`,
			})

			// Wait for attempt_completion to be called (indicating task finished)
			await waitFor(() => attemptCompletionCalled, { timeout: 45_000 })

			// Verify the MCP tool was requested
			assert.ok(mcpToolRequested, "The use_mcp_tool should have been requested for writing")

			// Verify the correct tool was used
			assert.strictEqual(mcpToolName, "write_file", "Should have used the write_file tool")

			// Verify we got a response from the MCP server
			assert.ok(mcpServerResponse, "Should have received a response from the MCP server")

			// Verify the response indicates successful file creation (not an error)
			const responseText = mcpServerResponse as string

			// Check for specific success indicators
			const hasSuccessKeyword =
				responseText.toLowerCase().includes("success") ||
				responseText.toLowerCase().includes("created") ||
				responseText.toLowerCase().includes("written") ||
				responseText.toLowerCase().includes("file written") ||
				responseText.toLowerCase().includes("successfully")

			const hasFileName = responseText.includes(newFileName) || responseText.includes("mcp-write-test")

			assert.ok(
				hasSuccessKeyword || hasFileName,
				`MCP server response should indicate successful file creation with keywords like 'success', 'created', 'written' or contain the filename '${newFileName}'. Got: ${responseText.substring(0, 150)}...`,
			)

			// Ensure no errors are present
			assert.ok(
				!responseText.toLowerCase().includes("error") && !responseText.toLowerCase().includes("failed"),
				`MCP server response should not contain error messages. Got: ${responseText.substring(0, 100)}...`,
			)

			// Verify task completed successfully
			assert.ok(attemptCompletionCalled, "Task should have completed with attempt_completion")

			// Check that no errors occurred
			assert.strictEqual(errorOccurred, null, "No errors should have occurred")

			console.log("Test passed! MCP write_file tool used successfully and task completed")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should request MCP filesystem list_directory tool and complete successfully", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let _taskCompleted = false
		let mcpToolRequested = false
		let mcpToolName: string | null = null
		let mcpServerResponse: string | null = null
		let attemptCompletionCalled = false
		let errorOccurred: string | null = null

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for MCP tool request
			if (message.type === "ask" && message.ask === "use_mcp_server") {
				mcpToolRequested = true
				console.log("MCP tool request:", message.text?.substring(0, 300))

				// Parse the MCP request to verify structure and tool name
				if (message.text) {
					try {
						const mcpRequest = JSON.parse(message.text)
						mcpToolName = mcpRequest.toolName
						console.log("MCP request parsed:", {
							type: mcpRequest.type,
							serverName: mcpRequest.serverName,
							toolName: mcpRequest.toolName,
							hasArguments: !!mcpRequest.arguments,
						})
					} catch (e) {
						console.log("Failed to parse MCP request:", e)
					}
				}
			}

			// Check for MCP server response
			if (message.type === "say" && message.say === "mcp_server_response") {
				mcpServerResponse = message.text || null
				console.log("MCP server response received:", message.text?.substring(0, 200))
			}

			// Check for attempt_completion
			if (message.type === "say" && message.say === "completion_result") {
				attemptCompletionCalled = true
				console.log("Attempt completion called:", message.text?.substring(0, 200))
			}

			// Log important messages for debugging
			if (message.type === "say" && message.say === "error") {
				errorOccurred = message.text || "Unknown error"
				console.error("Error:", message.text)
			}
		}
		api.on("message", messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				_taskCompleted = true
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task requesting MCP filesystem list_directory tool
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowMcp: true,
					mcpEnabled: true,
				},
				text: `Use the MCP filesystem server's list_directory tool to list the contents of the current directory. I want to see the files in the workspace.`,
			})

			// Wait for attempt_completion to be called (indicating task finished)
			await waitFor(() => attemptCompletionCalled, { timeout: 45_000 })

			// Verify the MCP tool was requested
			assert.ok(mcpToolRequested, "The use_mcp_tool should have been requested")

			// Verify the correct tool was used
			assert.strictEqual(mcpToolName, "list_directory", "Should have used the list_directory tool")

			// Verify we got a response from the MCP server
			assert.ok(mcpServerResponse, "Should have received a response from the MCP server")

			// Verify the response contains directory listing (not an error)
			const responseText = mcpServerResponse as string

			// Check for specific directory contents - our test files should be listed
			const hasTestFile =
				responseText.includes("mcp-test-") || responseText.includes(path.basename(testFiles.simple))
			const hasDataFile =
				responseText.includes("mcp-data-") || responseText.includes(path.basename(testFiles.testData))
			const hasRooDir = responseText.includes(".roo")

			// At least one of our test files or the .roo directory should be present
			assert.ok(
				hasTestFile || hasDataFile || hasRooDir,
				`MCP server response should contain our test files or .roo directory. Expected to find: '${path.basename(testFiles.simple)}', '${path.basename(testFiles.testData)}', or '.roo'. Got: ${responseText.substring(0, 200)}...`,
			)

			// Check for typical directory listing indicators
			const hasDirectoryStructure =
				responseText.includes("name") ||
				responseText.includes("type") ||
				responseText.includes("file") ||
				responseText.includes("directory") ||
				responseText.includes(".txt") ||
				responseText.includes(".json")

			assert.ok(
				hasDirectoryStructure,
				`MCP server response should contain directory structure indicators like 'name', 'type', 'file', 'directory', or file extensions. Got: ${responseText.substring(0, 200)}...`,
			)

			// Ensure no errors are present
			assert.ok(
				!responseText.toLowerCase().includes("error") && !responseText.toLowerCase().includes("failed"),
				`MCP server response should not contain error messages. Got: ${responseText.substring(0, 100)}...`,
			)

			// Verify task completed successfully
			assert.ok(attemptCompletionCalled, "Task should have completed with attempt_completion")

			// Check that no errors occurred
			assert.strictEqual(errorOccurred, null, "No errors should have occurred")

			console.log("Test passed! MCP list_directory tool used successfully and task completed")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test("Should request MCP filesystem directory_tree tool and complete successfully", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let _taskCompleted = false
		let mcpToolRequested = false
		let mcpToolName: string | null = null
		let mcpServerResponse: string | null = null
		let attemptCompletionCalled = false
		let errorOccurred: string | null = null

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for MCP tool request
			if (message.type === "ask" && message.ask === "use_mcp_server") {
				mcpToolRequested = true
				console.log("MCP tool request:", message.text?.substring(0, 200))

				// Parse the MCP request to verify structure and tool name
				if (message.text) {
					try {
						const mcpRequest = JSON.parse(message.text)
						mcpToolName = mcpRequest.toolName
						console.log("MCP request parsed:", {
							type: mcpRequest.type,
							serverName: mcpRequest.serverName,
							toolName: mcpRequest.toolName,
							hasArguments: !!mcpRequest.arguments,
						})
					} catch (e) {
						console.log("Failed to parse MCP request:", e)
					}
				}
			}

			// Check for MCP server response
			if (message.type === "say" && message.say === "mcp_server_response") {
				mcpServerResponse = message.text || null
				console.log("MCP server response received:", message.text?.substring(0, 200))
			}

			// Check for attempt_completion
			if (message.type === "say" && message.say === "completion_result") {
				attemptCompletionCalled = true
				console.log("Attempt completion called:", message.text?.substring(0, 200))
			}

			// Log important messages for debugging
			if (message.type === "say" && message.say === "error") {
				errorOccurred = message.text || "Unknown error"
				console.error("Error:", message.text)
			}
		}
		api.on("message", messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				_taskCompleted = true
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task requesting MCP filesystem directory_tree tool
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowMcp: true,
					mcpEnabled: true,
				},
				text: `Use the MCP filesystem server's directory_tree tool to show me the directory structure of the current workspace. I want to see the folder hierarchy.`,
			})

			// Wait for attempt_completion to be called (indicating task finished)
			await waitFor(() => attemptCompletionCalled, { timeout: 45_000 })

			// Verify the MCP tool was requested
			assert.ok(mcpToolRequested, "The use_mcp_tool should have been requested")

			// Verify the correct tool was used
			assert.strictEqual(mcpToolName, "directory_tree", "Should have used the directory_tree tool")

			// Verify we got a response from the MCP server
			assert.ok(mcpServerResponse, "Should have received a response from the MCP server")

			// Verify the response contains directory tree structure (not an error)
			const responseText = mcpServerResponse as string

			// Check for tree structure elements (be flexible as different MCP servers format differently)
			const hasTreeStructure =
				responseText.includes("name") ||
				responseText.includes("type") ||
				responseText.includes("children") ||
				responseText.includes("file") ||
				responseText.includes("directory")

			// Check for our test files or common file extensions
			const hasTestFiles =
				responseText.includes("mcp-test-") ||
				responseText.includes("mcp-data-") ||
				responseText.includes(".roo") ||
				responseText.includes(".txt") ||
				responseText.includes(".json") ||
				responseText.length > 10 // At least some content indicating directory structure

			assert.ok(
				hasTreeStructure,
				`MCP server response should contain tree structure indicators like 'name', 'type', 'children', 'file', or 'directory'. Got: ${responseText.substring(0, 200)}...`,
			)

			assert.ok(
				hasTestFiles,
				`MCP server response should contain directory contents (test files, extensions, or substantial content). Got: ${responseText.substring(0, 200)}...`,
			)

			// Ensure no errors are present
			assert.ok(
				!responseText.toLowerCase().includes("error") && !responseText.toLowerCase().includes("failed"),
				`MCP server response should not contain error messages. Got: ${responseText.substring(0, 100)}...`,
			)

			// Verify task completed successfully
			assert.ok(attemptCompletionCalled, "Task should have completed with attempt_completion")

			// Check that no errors occurred
			assert.strictEqual(errorOccurred, null, "No errors should have occurred")

			console.log("Test passed! MCP directory_tree tool used successfully and task completed")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test.skip("Should handle MCP server error gracefully and complete task", async function () {
		// Skipped: This test requires interactive approval for non-whitelisted MCP servers
		// which cannot be automated in the test environment
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let _taskCompleted = false
		let _mcpToolRequested = false
		let _errorHandled = false
		let attemptCompletionCalled = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for MCP tool request
			if (message.type === "ask" && message.ask === "use_mcp_server") {
				_mcpToolRequested = true
				console.log("MCP tool request:", message.text?.substring(0, 200))
			}

			// Check for error handling
			if (message.type === "say" && (message.say === "error" || message.say === "mcp_server_response")) {
				if (message.text && (message.text.includes("Error") || message.text.includes("not found"))) {
					_errorHandled = true
					console.log("MCP error handled:", message.text.substring(0, 100))
				}
			}

			// Check for attempt_completion
			if (message.type === "say" && message.say === "completion_result") {
				attemptCompletionCalled = true
				console.log("Attempt completion called:", message.text?.substring(0, 200))
			}
		}
		api.on("message", messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				_taskCompleted = true
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task requesting non-existent MCP server
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowMcp: true,
					mcpEnabled: true,
				},
				text: `Use the MCP server "nonexistent-server" to perform some operation. This should trigger an error but the task should still complete gracefully.`,
			})

			// Wait for attempt_completion to be called (indicating task finished)
			await waitFor(() => attemptCompletionCalled, { timeout: 45_000 })

			// Verify task completed successfully even with error
			assert.ok(attemptCompletionCalled, "Task should have completed with attempt_completion even with MCP error")

			console.log("Test passed! MCP error handling verified and task completed")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})

	test.skip("Should validate MCP request message format and complete successfully", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let _taskCompleted = false
		let mcpToolRequested = false
		let validMessageFormat = false
		let mcpToolName: string | null = null
		let mcpServerResponse: string | null = null
		let attemptCompletionCalled = false
		let errorOccurred: string | null = null

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for MCP tool request and validate format
			if (message.type === "ask" && message.ask === "use_mcp_server") {
				mcpToolRequested = true
				console.log("MCP tool request:", message.text?.substring(0, 200))

				// Validate the message format matches ClineAskUseMcpServer interface
				if (message.text) {
					try {
						const mcpRequest = JSON.parse(message.text)
						mcpToolName = mcpRequest.toolName

						// Check required fields
						const hasType = typeof mcpRequest.type === "string"
						const hasServerName = typeof mcpRequest.serverName === "string"
						const validType =
							mcpRequest.type === "use_mcp_tool" || mcpRequest.type === "access_mcp_resource"

						if (hasType && hasServerName && validType) {
							validMessageFormat = true
							console.log("Valid MCP message format detected:", {
								type: mcpRequest.type,
								serverName: mcpRequest.serverName,
								toolName: mcpRequest.toolName,
								hasArguments: !!mcpRequest.arguments,
							})
						}
					} catch (e) {
						console.log("Failed to parse MCP request:", e)
					}
				}
			}

			// Check for MCP server response
			if (message.type === "say" && message.say === "mcp_server_response") {
				mcpServerResponse = message.text || null
				console.log("MCP server response received:", message.text?.substring(0, 200))
			}

			// Check for attempt_completion
			if (message.type === "say" && message.say === "completion_result") {
				attemptCompletionCalled = true
				console.log("Attempt completion called:", message.text?.substring(0, 200))
			}

			// Log important messages for debugging
			if (message.type === "say" && message.say === "error") {
				errorOccurred = message.text || "Unknown error"
				console.error("Error:", message.text)
			}
		}
		api.on("message", messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				_taskCompleted = true
			}
		}
		api.on("taskCompleted", taskCompletedHandler)

		let taskId: string
		try {
			// Start task requesting MCP filesystem get_file_info tool
			const fileName = path.basename(testFiles.simple)
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowMcp: true,
					mcpEnabled: true,
				},
				text: `Use the MCP filesystem server's get_file_info tool to get information about the file "${fileName}". This file exists in the workspace and will validate proper message formatting.`,
			})

			// Wait for attempt_completion to be called (indicating task finished)
			await waitFor(() => attemptCompletionCalled, { timeout: 45_000 })

			// Verify the MCP tool was requested with valid format
			assert.ok(mcpToolRequested, "The use_mcp_tool should have been requested")
			assert.ok(validMessageFormat, "The MCP request should have valid message format")

			// Verify the correct tool was used
			assert.strictEqual(mcpToolName, "get_file_info", "Should have used the get_file_info tool")

			// Verify we got a response from the MCP server
			assert.ok(mcpServerResponse, "Should have received a response from the MCP server")

			// Verify the response contains file information (not an error)
			const responseText = mcpServerResponse as string

			// Check for specific file metadata fields
			const hasSize = responseText.includes("size") && (responseText.includes("28") || /\d+/.test(responseText))
			const hasTimestamps =
				responseText.includes("created") ||
				responseText.includes("modified") ||
				responseText.includes("accessed")
			const hasDateInfo =
				responseText.includes("2025") || responseText.includes("GMT") || /\d{4}-\d{2}-\d{2}/.test(responseText)

			assert.ok(
				hasSize,
				`MCP server response should contain file size information. Expected 'size' with a number (like 28 bytes for our test file). Got: ${responseText.substring(0, 200)}...`,
			)

			assert.ok(
				hasTimestamps,
				`MCP server response should contain timestamp information like 'created', 'modified', or 'accessed'. Got: ${responseText.substring(0, 200)}...`,
			)

			assert.ok(
				hasDateInfo,
				`MCP server response should contain date/time information (year, GMT timezone, or ISO date format). Got: ${responseText.substring(0, 200)}...`,
			)

			// Note: get_file_info typically returns metadata only, not the filename itself
			// So we'll focus on validating the metadata structure instead of filename reference
			const hasValidMetadata =
				(hasSize && hasTimestamps) || (hasSize && hasDateInfo) || (hasTimestamps && hasDateInfo)

			assert.ok(
				hasValidMetadata,
				`MCP server response should contain valid file metadata (combination of size, timestamps, and date info). Got: ${responseText.substring(0, 200)}...`,
			)

			// Ensure no errors are present
			assert.ok(
				!responseText.toLowerCase().includes("error") && !responseText.toLowerCase().includes("failed"),
				`MCP server response should not contain error messages. Got: ${responseText.substring(0, 100)}...`,
			)

			// Verify task completed successfully
			assert.ok(attemptCompletionCalled, "Task should have completed with attempt_completion")

			// Check that no errors occurred
			assert.strictEqual(errorOccurred, null, "No errors should have occurred")

			console.log("Test passed! MCP message format validation successful and task completed")
		} finally {
			// Clean up
			api.off("message", messageHandler)
			api.off("taskCompleted", taskCompletedHandler)
		}
	})
})
