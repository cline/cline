import { Controller } from "@core/controller"
import { ClineMessage } from "@shared/ExtensionMessage"
import { HistoryItem } from "@shared/HistoryItem"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"

/**
 * Registers development-only commands for task manipulation.
 * These are only activated in development mode.
 */
export function registerTaskCommands(controller: Controller): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand("cline.dev.expireMcpOAuthTokens", async () => {
			try {
				const stateManager = controller.stateManager
				const secretsJson = stateManager.getSecretKey("mcpOAuthSecrets")

				if (!secretsJson) {
					vscode.window.showInformationMessage("No MCP OAuth secrets found - no servers are authenticated")
					return
				}

				const secrets = JSON.parse(secretsJson)
				let expiredCount = 0

				// Set all tokens_saved_at to 2 hours ago (past expiration)
				for (const hash in secrets) {
					if (secrets[hash].tokens_saved_at) {
						secrets[hash].tokens_saved_at = Date.now() - 2 * 60 * 60 * 1000 // 2 hours ago
						expiredCount++
						console.log(`[Dev] Expired tokens for hash: ${hash}`)
					}
				}

				stateManager.setSecret("mcpOAuthSecrets", JSON.stringify(secrets))

				const action = await vscode.window.showInformationMessage(
					`Expired ${expiredCount} MCP OAuth token(s). Reload window to test token refresh flow.`,
					"Reload Window",
					"Cancel",
				)

				if (action === "Reload Window") {
					vscode.commands.executeCommand("workbench.action.reloadWindow")
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to expire tokens: ${error}`)
				console.error("[Dev] Error expiring MCP OAuth tokens:", error)
			}
		}),
		vscode.commands.registerCommand("cline.dev.createTestTasks", async () => {
			const count = (
				await HostProvider.window.showInputBox({
					title: "Test Tasks",
					prompt: "How many test tasks to create?",
					value: "10",
				})
			).response

			if (count === undefined) {
				return
			}

			const tasksCount = parseInt(count)
			const globalStoragePath = HostProvider.get().globalStorageFsPath
			const tasksDir = path.join(globalStoragePath, "tasks")

			vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Creating ${tasksCount} test tasks...`,
					cancellable: false,
				},
				async (progress) => {
					for (let i = 0; i < tasksCount; i++) {
						// Generate a timestamp to ensure unique IDs
						const timestamp = Date.now() + i
						const taskId = `${timestamp}`
						const taskDir = path.join(tasksDir, taskId)

						await fs.mkdir(taskDir, { recursive: true })

						// Generate a task prompt
						const taskName = getRandomTaskName(i)

						// Create realistic message sequence
						const messages = createRealisticMessageSequence(timestamp, taskName, i)

						// Create API conversation history file
						await fs.writeFile(
							path.join(taskDir, "api_conversation_history.json"),
							JSON.stringify(
								[
									{
										role: "user",
										content: [{ type: "text", text: `<task>\n${taskName}\n</task>` }],
									},
									{
										role: "assistant",
										content: [
											{
												type: "text",
												text: `I'll help you ${taskName.toLowerCase()}. Let me break this down into steps.`,
											},
										],
									},
								],
								null,
								2,
							),
						)

						// Create UI messages file with realistic message sequence
						await fs.writeFile(path.join(taskDir, "ui_messages.json"), JSON.stringify(messages, null, 2))

						// Create history item to be shown in the HistoryView
						const historyItem: HistoryItem = {
							id: taskId,
							ts: timestamp,
							task: taskName,
							tokensIn: Math.floor(100 + Math.random() * 900), // Random token count from 100-1000
							tokensOut: Math.floor(200 + Math.random() * 1800), // Random token count from 200-2000
							cacheWrites: i % 3 === 0 ? Math.floor(50 + Math.random() * 150) : undefined, // Only add cache writes to every 3rd task
							cacheReads: i % 3 === 0 ? Math.floor(20 + Math.random() * 80) : undefined, // Only add cache reads to every 3rd task
							totalCost: Number((0.0001 + Math.random() * 0.01).toFixed(5)), // Random cost from $0.0001 to $0.0101
							size: 1024 * 1024, // 1MB
						}

						// Update task history in global state
						await controller.updateTaskHistory(historyItem)

						progress.report({ increment: 100 / tasksCount })
					}

					// Update the UI to show the new tasks
					await controller.postStateToWebview()

					const message = `Created ${tasksCount} test tasks`
					HostProvider.window.showMessage({
						type: ShowMessageType.INFORMATION,
						message,
					})
				},
			)
		}),
	]
}

/**
 * Creates a realistic sequence of messages that would occur in a typical task
 */
function createRealisticMessageSequence(baseTimestamp: number, taskPrompt: string, taskIndex: number): ClineMessage[] {
	// Use an incrementing timestamp to ensure messages appear in sequence
	let timestamp = baseTimestamp
	const getNextTimestamp = () => {
		timestamp += 1000 // Add 1 second between messages
		return timestamp
	}

	// Variables to make different test tasks look unique
	const fileName = getRandomFileName(taskIndex)
	const commitHash = `commit${taskIndex}${Math.floor(Math.random() * 1000000).toString(16)}`

	// Create a realistic message sequence
	const messages: ClineMessage[] = [
		// Initial task message - uses "say" with "text" which is the format used in Cline.ts
		{
			ts: baseTimestamp,
			type: "say",
			say: "text",
			text: taskPrompt,
		},

		// API request started
		{
			ts: getNextTimestamp(),
			type: "say",
			say: "api_req_started",
			text: JSON.stringify({
				request: `<task>\n${taskPrompt}\n</task>`,
				tokensIn: Math.floor(100 + Math.random() * 200),
				tokensOut: Math.floor(300 + Math.random() * 500),
			}),
		},

		// Reasoning message
		{
			ts: getNextTimestamp(),
			type: "say",
			say: "reasoning",
			text: `I'll approach this task by breaking it down into manageable steps. First, I'll analyze the requirements, then create a plan, and finally implement the solution systematically.`,
		},

		// Text response
		{
			ts: getNextTimestamp(),
			type: "say",
			say: "text",
			text: `I'll help you with this task. Let me start by creating the necessary files and implementing the core functionality.`,
		},
	]

	// Add task-specific messages based on index modulo to create variety
	const messageType = taskIndex % 5

	if (messageType === 0 || messageType === 2) {
		// Tool use - file operations
		messages.push({
			ts: getNextTimestamp(),
			type: "say",
			say: "tool",
			text: JSON.stringify({
				tool: "newFileCreated",
				path: fileName,
				content: `// Sample code for ${taskPrompt}`,
			}),
		})
	}

	if (messageType === 1 || messageType === 3) {
		// Command execution
		messages.push(
			{
				ts: getNextTimestamp(),
				type: "ask",
				ask: "command",
				text: `ls -la`,
			},
			{
				ts: getNextTimestamp(),
				type: "say",
				say: "command_output",
				text: `total 24\ndrwxr-xr-x 3 user staff 96 Mar 10 12:34 .\ndrwxr-xr-x 8 user staff 256 Mar 10 12:30 ..\n-rw-r--r-- 1 user staff 158 Mar 10 12:34 ${fileName}`,
			},
		)
	}

	if (messageType === 2 || messageType === 4) {
		// Browser actions
		messages.push(
			{
				ts: getNextTimestamp(),
				type: "ask",
				ask: "browser_action_launch",
				text: `https://example.com`,
			},
			{
				ts: getNextTimestamp(),
				type: "say",
				say: "browser_action_result",
				text: JSON.stringify({
					logs: "Page loaded successfully",
					screenshot:
						"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
				}),
			},
			{
				ts: getNextTimestamp(),
				type: "say",
				say: "browser_action",
				text: JSON.stringify({
					action: "close",
				}),
			},
		)
	}

	// Add checkpoint
	messages.push({
		ts: getNextTimestamp(),
		type: "say",
		say: "checkpoint_created",
		lastCheckpointHash: commitHash,
	})

	// Add completion result (all tasks end with this)
	messages.push({
		ts: getNextTimestamp(),
		type: "say",
		say: "completion_result",
		text: `I've completed the task to ${taskPrompt.toLowerCase()}. The implementation includes all the required functionality and meets the specifications. ${"x".repeat(1024 * 1024)}`, // 1MB file
		lastCheckpointHash: commitHash,
	})

	return messages
}

/**
 * Returns a random task name for test data
 */
function getRandomTaskName(index: number): string {
	const tasks = [
		"Create a simple todo application",
		"Build a weather forecast widget",
		"Implement a markdown parser",
		"Design a responsive landing page",
		"Develop a currency converter",
		"Create a file upload component",
		"Build a data visualization dashboard",
		"Implement a search functionality",
		"Create a user authentication system",
		"Design a dark mode toggle",
		"Build a countdown timer",
		"Create a drag and drop interface",
		"Implement form validation",
		"Design a multi-step wizard",
		"Create a notification system",
	]

	return tasks[index % tasks.length] + ` (Test ${index + 1})`
}

/**
 * Returns a random file name for test data
 */
function getRandomFileName(index: number): string {
	const files = [
		"index.html",
		"styles.css",
		"script.js",
		"app.jsx",
		"main.ts",
		"utils.py",
		"config.json",
		"server.js",
		"data.csv",
		"README.md",
	]

	return files[index % files.length]
}
