import fs from "fs/promises"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { ClineMessage } from "@/shared/ExtensionMessage"
import { HistoryItem } from "@/shared/HistoryItem"
import { fileExistsAtPath } from "@/utils/fs"
import { getSavedClineMessages, readTaskHistoryFromState, writeTaskHistoryToState } from "../disk"

/**
 * Extract workspace IDs from task messages using multiple fallback strategies
 * Matches the 4-strategy approach from the recovery script for maximum success rate
 */
async function extractWorkspaceIds(firstMessage: ClineMessage, allMessages: ClineMessage[], taskDir: string): Promise<string[]> {
	const workspaces: string[] = []

	// Strategy 1: Check environment_details in first message for "Current Working Directory"
	if (firstMessage.text) {
		// Try exact format: # Current Working Directory (/path/to/workspace)
		const cwdMatch = firstMessage.text.match(/# Current Working Directory \(([^)]+)\)/)
		if (cwdMatch) {
			workspaces.push(cwdMatch[1])
		}
	}

	// Strategy 2: Check first 5 messages for environment_details (in case first message doesn't have it)
	if (workspaces.length === 0) {
		for (const message of allMessages.slice(0, 5)) {
			if (message.text && message.text.includes("environment_details")) {
				const cwdMatch = message.text.match(/# Current Working Directory \(([^)]+)\)/)
				if (cwdMatch) {
					workspaces.push(cwdMatch[1])
					break
				}
			}
		}
	}

	// Strategy 3: Check settings.json in task directory
	if (workspaces.length === 0) {
		try {
			const settingsPath = path.join(taskDir, "settings.json")
			if (await fileExistsAtPath(settingsPath)) {
				const settingsContent = await fs.readFile(settingsPath, "utf8")
				const settings = JSON.parse(settingsContent)
				if (settings?.cwdOnTaskInitialization) {
					workspaces.push(settings.cwdOnTaskInitialization)
				} else if (settings?.shadowGitConfigWorkTree) {
					workspaces.push(settings.shadowGitConfigWorkTree)
				}
			}
		} catch {
			// Settings file doesn't exist or can't be read
		}
	}

	// Strategy 4: Look for workspace configuration in environment details
	if (workspaces.length === 0 && firstMessage.text) {
		// Try to find workspace configuration section
		const workspaceMatch = firstMessage.text.match(/# Workspace Configuration[\s\S]*?"workspaces": \{[\s\S]*?"([^"]+)"/)
		if (workspaceMatch) {
			workspaces.push(workspaceMatch[1])
		}
	}

	return workspaces
}

/**
 * Extract metadata from a single task directory
 * Returns HistoryItem or null if extraction fails
 */
async function extractTaskMetadata(taskId: string, taskDir: string): Promise<HistoryItem | null> {
	try {
		// 1. Read ui_messages.json (required)
		const messages = await getSavedClineMessages(taskId)

		if (!messages || !Array.isArray(messages) || messages.length === 0) {
			return null
		}

		// 2. Get first user message for task description and timestamp
		const firstMessage = messages.find((m) => m.type === "say" && m.say === "text")
		if (!firstMessage || !firstMessage.text) {
			return null
		}

		// 3. Extract core fields
		const ts = firstMessage.ts
		let task = firstMessage.text

		// Truncate very long task descriptions
		if (task.length > 500) {
			task = task.substring(0, 497) + "..."
		}

		// 4. Extract workspace information using 4-strategy approach
		const workspaceIds = await extractWorkspaceIds(firstMessage, messages, taskDir)

		// 5. Get file size for size field
		const uiMessagesPath = path.join(taskDir, "ui_messages.json")
		const uiMessagesStats = await fs.stat(uiMessagesPath)
		const size = uiMessagesStats.size

		// 6. Build HistoryItem (token usage and cost will be 0 for recovered items)
		const historyItem: HistoryItem = {
			id: taskId,
			ts,
			task,
			tokensIn: 0,
			tokensOut: 0,
			cacheWrites: 0,
			cacheReads: 0,
			totalCost: 0,
			size,
			workspaceIds: workspaceIds.length > 0 ? workspaceIds : undefined,
		}

		return historyItem
	} catch (_error) {
		// Silently fail for corrupted tasks
		return null
	}
}

/**
 * Get count of task directories in storage
 */
async function getTaskDirectoriesCount(): Promise<number> {
	try {
		const tasksDir = path.join(HostProvider.get().globalStorageFsPath, "tasks")
		const dirs = await fs.readdir(tasksDir)
		// Only count directories with numeric names (task IDs are timestamps)
		return dirs.filter((dir) => /^\d+$/.test(dir)).length
	} catch {
		return 0
	}
}

/**
 * Get all task directory IDs from storage
 */
async function getTaskDirectoryIds(): Promise<string[]> {
	try {
		const tasksDir = path.join(HostProvider.get().globalStorageFsPath, "tasks")
		const dirs = await fs.readdir(tasksDir)
		// Only return directories with numeric names (task IDs are timestamps)
		return dirs.filter((dir) => /^\d+$/.test(dir))
	} catch {
		return []
	}
}

/**
 * Recover missing task history entries by scanning task directories
 *
 * This migration automatically detects and recovers task history entries that are
 * missing from taskHistory.json by scanning all task directories and extracting
 * metadata from their ui_messages.json files.
 *
 * Features:
 * - Scans all task directories for missing entries
 * - Uses 4-strategy workspace ID extraction for maximum success rate
 * - Preserves all existing entries (merge strategy)
 * - Idempotent (safe to re-run)
 * - Automatic backup created by parent migration system
 * - Handles corrupted tasks gracefully
 *
 * Only runs when there's a significant mismatch between directory count
 * and indexed entries (50% or more missing).
 */
export async function recoverMissingTaskHistory(): Promise<void> {
	console.log("[Migration] Starting recoverMissingTaskHistory migration...")

	// 1. Get current task history
	const existingHistory = await readTaskHistoryFromState()
	const existingMap = new Map<string, HistoryItem>()
	existingHistory.forEach((item) => existingMap.set(item.id, item))

	console.log(`[Migration] Current indexed tasks: ${existingHistory.length}`)

	// 2. Get all task directories
	const taskIds = await getTaskDirectoryIds()
	console.log(`[Migration] Total task directories: ${taskIds.length}`)

	if (taskIds.length === 0) {
		console.log("[Migration] No task directories found, skipping recovery")
		return
	}

	// 3. Extract metadata from missing tasks
	let recoveredCount = 0
	let failedCount = 0
	let skippedCount = 0

	const newHistory: HistoryItem[] = [...existingHistory]

	for (const taskId of taskIds) {
		// Skip if already indexed
		if (existingMap.has(taskId)) {
			skippedCount++
			continue
		}

		// Extract metadata
		const tasksDir = path.join(HostProvider.get().globalStorageFsPath, "tasks")
		const taskDir = path.join(tasksDir, taskId)
		const metadata = await extractTaskMetadata(taskId, taskDir)

		if (metadata) {
			newHistory.push(metadata)
			recoveredCount++
		} else {
			failedCount++
		}
	}

	// 4. Sort by timestamp (newest first)
	newHistory.sort((a, b) => b.ts - a.ts)

	// 5. Write back to storage
	await writeTaskHistoryToState(newHistory)

	console.log(`[Migration] recoverMissingTaskHistory complete:`, {
		totalDirectories: taskIds.length,
		existingEntries: existingHistory.length,
		skippedCount,
		recoveredCount,
		failedCount,
		finalTotal: newHistory.length,
		successRate: taskIds.length > 0 ? `${((recoveredCount / (taskIds.length - skippedCount)) * 100).toFixed(1)}%` : "N/A",
	})
}

/**
 * Check if recovery migration should run
 * Returns true if there's a significant mismatch (50% or more tasks missing)
 */
export async function shouldRunRecoveryMigration(): Promise<boolean> {
	try {
		const taskHistory = await readTaskHistoryFromState()
		const directoryCount = await getTaskDirectoriesCount()

		// No directories or already fully indexed
		if (directoryCount === 0 || directoryCount <= taskHistory.length) {
			return false
		}

		// Calculate missing percentage
		const missingCount = directoryCount - taskHistory.length
		const missingPercentage = (missingCount / directoryCount) * 100

		// Only run if 50% or more tasks are missing
		return missingPercentage >= 50
	} catch (error) {
		console.error("[Migration] Failed to check if recovery migration should run:", error)
		return false
	}
}
