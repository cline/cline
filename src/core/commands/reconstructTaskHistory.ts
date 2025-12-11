import { getSavedClineMessages, getTaskMetadata, readTaskHistoryFromState, writeTaskHistoryToState } from "@core/storage/disk"
import { HostProvider } from "@hosts/host-provider"
import { ClineMessage } from "@shared/ExtensionMessage"
import { HistoryItem } from "@shared/HistoryItem"
import { ShowMessageType } from "@shared/proto/host/window"
import { fileExistsAtPath } from "@utils/fs"
import * as path from "path"
import { ulid } from "ulid"

interface TaskReconstructionResult {
	totalTasks: number
	reconstructedTasks: number
	skippedTasks: number
	errors: string[]
}

/**
 * Reconstructs task history from existing task folders
 * @param showNotifications Whether to show user-facing notifications and dialogs
 * @returns Reconstruction result or null if cancelled
 */
export async function reconstructTaskHistory(showNotifications = true): Promise<TaskReconstructionResult | null> {
	try {
		// Show confirmation dialog using HostProvider
		const proceed = await HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message:
				"This will rebuild your task history from existing task data. This operation will backup your current task history and attempt to reconstruct it from task folders. Continue?",
			options: {
				items: ["Yes, Reconstruct", "Cancel"],
			},
		})

		if (proceed?.selectedOption !== "Yes, Reconstruct") {
			return null
		}

		if (showNotifications) {
			// Show initial progress message
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "Reconstructing task history...",
			})
		}

		const result = await performTaskHistoryReconstruction()

		// Show results
		if (showNotifications) {
			if (result.errors.length > 0) {
				const errorMessage = `Reconstruction completed with warnings:\n- Reconstructed: ${result.reconstructedTasks} tasks\n- Skipped: ${result.skippedTasks} tasks\n- Errors: ${result.errors.length}\n\nFirst few errors:\n${result.errors.slice(0, 3).join("\n")}`

				HostProvider.window.showMessage({
					type: ShowMessageType.WARNING,
					message: errorMessage,
				})
			} else {
				HostProvider.window.showMessage({
					type: ShowMessageType.INFORMATION,
					message: `Task history successfully reconstructed! Found and restored ${result.reconstructedTasks} tasks.`,
				})
			}
		}

		return result
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		if (showNotifications) {
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Failed to reconstruct task history: ${errorMessage}`,
			})
		}
		return null
	}
}

async function performTaskHistoryReconstruction(): Promise<TaskReconstructionResult> {
	const result: TaskReconstructionResult = {
		totalTasks: 0,
		reconstructedTasks: 0,
		skippedTasks: 0,
		errors: [],
	}

	// Backup existing task history
	await backupExistingTaskHistory()

	// Get tasks directory
	const tasksDir = path.join(HostProvider.get().globalStorageFsPath, "tasks")

	// Check if tasks directory exists
	if (!(await fileExistsAtPath(tasksDir))) {
		throw new Error("No tasks directory found. Nothing to reconstruct.")
	}

	// Scan for task directories
	const taskIds = await scanTaskDirectories(tasksDir)
	result.totalTasks = taskIds.length

	if (taskIds.length === 0) {
		throw new Error("No task directories found. Nothing to reconstruct.")
	}

	// Process each task
	const reconstructedItems: HistoryItem[] = []

	for (const taskId of taskIds) {
		try {
			const historyItem = await reconstructTaskHistoryItem(taskId)
			if (historyItem) {
				reconstructedItems.push(historyItem)
				result.reconstructedTasks++
			} else {
				result.skippedTasks++
			}
		} catch (error) {
			result.skippedTasks++
			const errorMsg = error instanceof Error ? error.message : String(error)
			result.errors.push(`Task ${taskId}: ${errorMsg}`)
		}
	}

	// Sort by timestamp (newest first)
	reconstructedItems.sort((a, b) => b.ts - a.ts)

	// Write reconstructed history
	await writeTaskHistoryToState(reconstructedItems)

	return result
}

async function backupExistingTaskHistory(): Promise<void> {
	try {
		const existingHistory = await readTaskHistoryFromState()
		if (existingHistory.length > 0) {
			const backupPath = path.join(HostProvider.get().globalStorageFsPath, "state", `taskHistory.backup.${Date.now()}.json`)

			// Ensure state directory exists
			const fs = await import("fs/promises")
			await fs.mkdir(path.dirname(backupPath), { recursive: true })
			await fs.writeFile(backupPath, JSON.stringify(existingHistory, null, 2))
		}
	} catch (error) {
		// Non-fatal error, just log it
		console.warn("Failed to backup existing task history:", error)
	}
}

async function scanTaskDirectories(tasksDir: string): Promise<string[]> {
	const fs = await import("fs/promises")

	try {
		const entries = await fs.readdir(tasksDir, { withFileTypes: true })
		return entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.filter((name) => /^\d+$/.test(name)) // Only numeric task IDs
	} catch (error) {
		throw new Error(`Failed to scan tasks directory: ${error}`)
	}
}

async function reconstructTaskHistoryItem(taskId: string): Promise<HistoryItem | null> {
	try {
		// Load UI messages to extract task info
		const clineMessages = await getSavedClineMessages(taskId)
		if (clineMessages.length === 0) {
			return null // Skip empty tasks
		}

		// Load task metadata for token usage
		const metadata = await getTaskMetadata(taskId)

		// Extract task information
		const taskInfo = extractTaskInformation(clineMessages, metadata)

		// Create HistoryItem
		const historyItem: HistoryItem = {
			id: taskId,
			ulid: taskInfo.ulid || ulid(), // Generate new ULID if missing
			ts: taskInfo.timestamp,
			task: taskInfo.taskDescription,
			tokensIn: taskInfo.tokensIn,
			tokensOut: taskInfo.tokensOut,
			cacheWrites: taskInfo.cacheWrites,
			cacheReads: taskInfo.cacheReads,
			totalCost: taskInfo.totalCost,
			size: taskInfo.size,
			isFavorited: taskInfo.isFavorited,
			conversationHistoryDeletedRange: taskInfo.conversationHistoryDeletedRange,
		}

		return historyItem
	} catch (error) {
		throw new Error(`Failed to reconstruct task ${taskId}: ${error}`)
	}
}

interface TaskInfo {
	ulid?: string
	timestamp: number
	taskDescription: string
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	size?: number
	isFavorited?: boolean
	conversationHistoryDeletedRange?: [number, number]
}

function extractTaskInformation(clineMessages: ClineMessage[], metadata: any): TaskInfo {
	// Find the first user message (task description)
	const firstUserMessage = clineMessages.find((msg) => msg.type === "say" && msg.say === "text" && msg.text)

	// Extract timestamp from first message or use task ID as fallback
	const timestamp = clineMessages.length > 0 ? clineMessages[0].ts : Date.now()

	// Extract task description
	let taskDescription = "Untitled Task"
	if (firstUserMessage?.text) {
		// Clean up the task description
		const cleanText = firstUserMessage.text
			.replace(/<task>\s*/g, "")
			.replace(/\s*<\/task>/g, "")
			.trim()

		const firstLine = cleanText.split("\n")[0]
		if (firstLine) {
			taskDescription = firstLine.substring(0, 100) // Limit length
		}
	}

	// Calculate token usage from API request messages
	let tokensIn = 0
	let tokensOut = 0
	let cacheWrites = 0
	let cacheReads = 0
	let totalCost = 0

	// Look for api_req_started messages with token info
	const apiReqMessages = clineMessages.filter((msg) => msg.type === "say" && msg.say === "api_req_started" && msg.text)

	for (const msg of apiReqMessages) {
		try {
			if (msg.text) {
				const apiInfo = JSON.parse(msg.text)
				if (apiInfo.tokensIn) tokensIn += apiInfo.tokensIn
				if (apiInfo.tokensOut) tokensOut += apiInfo.tokensOut
				if (apiInfo.cacheWrites) cacheWrites += apiInfo.cacheWrites
				if (apiInfo.cacheReads) cacheReads += apiInfo.cacheReads
				if (apiInfo.cost) totalCost += apiInfo.cost
			}
		} catch {
			// Ignore parsing errors
		}
	}

	// Use metadata if available and no tokens found in messages
	if (tokensIn === 0 && tokensOut === 0 && metadata.model_usage) {
		for (const usage of metadata.model_usage) {
			tokensIn += usage.tokensIn || 0
			tokensOut += usage.tokensOut || 0
			cacheWrites += usage.cacheWrites || 0
			cacheReads += usage.cacheReads || 0
			totalCost += usage.totalCost || 0
		}
	}

	// Calculate approximate size (rough estimate)
	const messageSize = JSON.stringify(clineMessages).length
	const size = Math.floor(messageSize / 1024) // KB

	return {
		timestamp,
		taskDescription,
		tokensIn,
		tokensOut,
		cacheWrites: cacheWrites > 0 ? cacheWrites : undefined,
		cacheReads: cacheReads > 0 ? cacheReads : undefined,
		totalCost,
		size,
	}
}
