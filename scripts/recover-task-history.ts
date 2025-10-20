#!/usr/bin/env node

/**
 * Task History Recovery Script
 *
 * Recovers missing taskHistory.json entries by scanning all task directories
 * and extracting metadata from task files.
 *
 * Usage:
 *   npm run recover-history -- --storage-dir <path> [options]
 *
 * Options:
 *   --storage-dir <path>    Path to globalStorage directory (required)
 *   --use-backup            Merge with existing backup file
 *   --backup-date <date>    Specific backup date (e.g., 2025-10-05)
 *   --dry-run               Preview changes without writing
 *   --verbose               Detailed logging
 *   --help                  Show this help
 *
 * Examples:
 *   # Dry run on VSCode installation
 *   npm run recover-history -- --storage-dir ~/Library/Application\ Support/Code/User/globalStorage/saoudrizwan.claude-dev --dry-run
 *
 *   # Full recovery with backup merge
 *   npm run recover-history -- --storage-dir ~/Library/Application\ Support/VSCodium/User/globalStorage/saoudrizwan.claude-dev --use-backup --backup-date 2025-10-05
 */

import { Anthropic } from "@anthropic-ai/sdk"
import * as fs from "fs/promises"
import * as path from "path"
import { ClineMessage } from "../src/shared/ExtensionMessage"
import { HistoryItem } from "../src/shared/HistoryItem"

interface RecoveryOptions {
	storageDir: string
	useBackup: boolean
	backupDate?: string
	dryRun: boolean
	verbose: boolean
}

interface RecoveryStats {
	totalDirectories: number
	successfulExtracts: number
	failedExtracts: number
	skippedExisting: number
	newEntries: number
	errors: Array<{ taskId: string; error: string }>
}

// Parse command line arguments
function parseArgs(): RecoveryOptions | null {
	const args = process.argv.slice(2)

	if (args.includes("--help") || args.includes("-h")) {
		console.log(`
Task History Recovery Script

Usage:
  npm run recover-history -- --storage-dir <path> [options]

Options:
  --storage-dir <path>    Path to globalStorage directory (required)
  --use-backup            Merge with existing backup file
  --backup-date <date>    Specific backup date (e.g., 2025-10-05)
  --dry-run               Preview changes without writing
  --verbose               Detailed logging
  --help                  Show this help

Examples:
  # Dry run
  npm run recover-history -- --storage-dir ~/Library/Application\\ Support/Code/User/globalStorage/saoudrizwan.claude-dev --dry-run

  # Full recovery
  npm run recover-history -- --storage-dir ~/Library/Application\\ Support/VSCodium/User/globalStorage/saoudrizwan.claude-dev --use-backup
		`)
		return null
	}

	const storageDirIndex = args.indexOf("--storage-dir")
	if (storageDirIndex === -1 || storageDirIndex === args.length - 1) {
		console.error("❌ Error: --storage-dir is required")
		console.error("Run with --help for usage information")
		return null
	}

	const backupDateIndex = args.indexOf("--backup-date")

	return {
		storageDir: args[storageDirIndex + 1],
		useBackup: args.includes("--use-backup"),
		backupDate: backupDateIndex !== -1 ? args[backupDateIndex + 1] : undefined,
		dryRun: args.includes("--dry-run"),
		verbose: args.includes("--verbose"),
	}
}

// Check if file exists
async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}

// Read JSON file safely
async function readJSON<T>(filePath: string): Promise<T | null> {
	try {
		const content = await fs.readFile(filePath, "utf8")
		return JSON.parse(content)
	} catch (_error) {
		return null
	}
}

// Extract workspace IDs from multiple sources
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

	// Strategy 2: Check all messages for environment_details (in case first message doesn't have it)
	if (workspaces.length === 0) {
		for (const message of allMessages.slice(0, 5)) {
			// Check first 5 messages
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
			const settings = await readJSON<any>(settingsPath)
			if (settings?.cwdOnTaskInitialization) {
				workspaces.push(settings.cwdOnTaskInitialization)
			} else if (settings?.shadowGitConfigWorkTree) {
				workspaces.push(settings.shadowGitConfigWorkTree)
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

// Calculate token usage from API conversation history
async function calculateTokenUsage(taskDir: string): Promise<{
	tokensIn: number
	tokensOut: number
	cacheWrites: number
	cacheReads: number
}> {
	const apiHistoryPath = path.join(taskDir, "api_conversation_history.json")
	const apiHistory = await readJSON<Anthropic.MessageParam[]>(apiHistoryPath)

	if (!apiHistory || !Array.isArray(apiHistory)) {
		return { tokensIn: 0, tokensOut: 0, cacheWrites: 0, cacheReads: 0 }
	}

	const tokensIn = 0
	const tokensOut = 0
	const cacheWrites = 0
	const cacheReads = 0

	// Note: Actual token counting would require parsing the usage data
	// For now, we'll estimate based on content length or look for usage metadata
	// This is a simplified version - the actual implementation might need
	// to parse usage data from the task's metadata or API responses

	return { tokensIn, tokensOut, cacheWrites, cacheReads }
}

// Extract metadata from a single task directory
async function extractTaskMetadata(taskId: string, taskDir: string, verbose: boolean): Promise<HistoryItem | null> {
	try {
		if (verbose) {
			console.log(`  Extracting: ${taskId}`)
		}

		// 1. Read ui_messages.json (required)
		const uiMessagesPath = path.join(taskDir, "ui_messages.json")
		const messages = await readJSON<ClineMessage[]>(uiMessagesPath)

		if (!messages || !Array.isArray(messages) || messages.length === 0) {
			throw new Error("No messages found")
		}

		// 2. Get first user message for task description and timestamp
		const firstMessage = messages.find((m) => m.type === "say" && m.say === "text")
		if (!firstMessage || !firstMessage.text) {
			throw new Error("No text message found")
		}

		// 3. Extract core fields
		const ts = firstMessage.ts
		let task = firstMessage.text

		// Truncate very long task descriptions
		if (task.length > 500) {
			task = task.substring(0, 497) + "..."
		}

		// 4. Extract workspace information
		const workspaceIds = await extractWorkspaceIds(firstMessage, messages, taskDir)

		// 5. Read task metadata if available
		const metadataPath = path.join(taskDir, "task_metadata.json")
		const _metadata = await readJSON<any>(metadataPath)

		// 6. Calculate token usage
		const { tokensIn, tokensOut, cacheWrites, cacheReads } = await calculateTokenUsage(taskDir)

		// 7. Get file size for size field
		const uiMessagesStats = await fs.stat(uiMessagesPath)
		const size = uiMessagesStats.size

		// 8. Build HistoryItem
		const historyItem: HistoryItem = {
			id: taskId,
			ts,
			task,
			tokensIn,
			tokensOut,
			cacheWrites,
			cacheReads,
			totalCost: 0,
			size,
			workspaceIds: workspaceIds.length > 0 ? workspaceIds : undefined,
		}

		return historyItem
	} catch (error) {
		if (verbose) {
			console.log(`  ⚠️  Failed: ${taskId} - ${error instanceof Error ? error.message : String(error)}`)
		}
		return null
	}
}

// Load existing or backup task history
async function loadExistingHistory(storageDir: string, useBackup: boolean, backupDate?: string): Promise<HistoryItem[]> {
	const stateDir = path.join(storageDir, "state")

	if (useBackup && backupDate) {
		const backupPath = path.join(stateDir, `taskHistory.json.backup-${backupDate}T18-56-17`)
		if (await fileExists(backupPath)) {
			console.log(`📦 Loading backup: ${backupDate}`)
			const backup = await readJSON<HistoryItem[]>(backupPath)
			return backup || []
		}
		console.warn(`⚠️  Backup file not found for date ${backupDate}, using current file`)
	}

	if (useBackup) {
		// Find most recent backup
		try {
			const files = await fs.readdir(stateDir)
			const backupFiles = files.filter((f) => f.startsWith("taskHistory.json.backup-"))
			if (backupFiles.length > 0) {
				backupFiles.sort().reverse()
				const latestBackup = backupFiles[0]
				console.log(`📦 Loading latest backup: ${latestBackup}`)
				const backupPath = path.join(stateDir, latestBackup)
				const backup = await readJSON<HistoryItem[]>(backupPath)
				return backup || []
			}
		} catch (_error) {
			console.warn("⚠️  Could not find backup files, using current file")
		}
	}

	// Load current file
	const currentPath = path.join(stateDir, "taskHistory.json")
	if (await fileExists(currentPath)) {
		console.log("📂 Loading current taskHistory.json")
		const current = await readJSON<HistoryItem[]>(currentPath)
		return current || []
	}

	return []
}

// Main recovery function
async function recoverTaskHistory(options: RecoveryOptions): Promise<void> {
	console.log("\n🔧 Task History Recovery Tool")
	console.log("================================\n")

	const { storageDir, useBackup, backupDate, dryRun, verbose } = options

	if (dryRun) {
		console.log("🔍 DRY RUN MODE - No changes will be written\n")
	}

	// Validate storage directory
	if (!(await fileExists(storageDir))) {
		console.error(`❌ Error: Storage directory not found: ${storageDir}`)
		process.exit(1)
	}

	const tasksDir = path.join(storageDir, "tasks")
	if (!(await fileExists(tasksDir))) {
		console.error(`❌ Error: Tasks directory not found: ${tasksDir}`)
		process.exit(1)
	}

	// 1. Load existing history (current or backup)
	console.log("📖 Loading existing history...")
	const existingHistory = await loadExistingHistory(storageDir, useBackup, backupDate)
	console.log(`   Found ${existingHistory.length} existing entries\n`)

	// Create lookup map for existing entries
	const existingMap = new Map<string, HistoryItem>()
	existingHistory.forEach((item) => existingMap.set(item.id, item))

	// 2. Scan task directories
	console.log("🔍 Scanning task directories...")
	const taskDirs = await fs.readdir(tasksDir)
	const taskIds = taskDirs.filter((dir) => /^\d+$/.test(dir)) // Only numeric directory names
	console.log(`   Found ${taskIds.length} task directories\n`)

	// 3. Extract metadata from each task
	console.log("📊 Extracting task metadata...")
	const stats: RecoveryStats = {
		totalDirectories: taskIds.length,
		successfulExtracts: 0,
		failedExtracts: 0,
		skippedExisting: 0,
		newEntries: 0,
		errors: [],
	}

	const newHistory: HistoryItem[] = [...existingHistory]

	for (const taskId of taskIds) {
		const taskDir = path.join(tasksDir, taskId)

		// Skip if already exists and we want to preserve it
		if (existingMap.has(taskId)) {
			stats.skippedExisting++
			if (verbose) {
				console.log(`  ✓ Exists: ${taskId}`)
			}
			continue
		}

		// Extract metadata
		const metadata = await extractTaskMetadata(taskId, taskDir, verbose)

		if (metadata) {
			newHistory.push(metadata)
			stats.successfulExtracts++
			stats.newEntries++
		} else {
			stats.failedExtracts++
			stats.errors.push({ taskId, error: "Failed to extract metadata" })
		}
	}

	// 4. Sort by timestamp (newest first)
	newHistory.sort((a, b) => b.ts - a.ts)

	// 5. Display results
	console.log("\n" + "=".repeat(50))
	console.log("📈 RECOVERY RESULTS")
	console.log("=".repeat(50))
	console.log(`Total directories:    ${stats.totalDirectories}`)
	console.log(`Existing entries:     ${existingHistory.length}`)
	console.log(`Skipped (existing):   ${stats.skippedExisting}`)
	console.log(`Successful extracts:  ${stats.successfulExtracts}`)
	console.log(`Failed extracts:      ${stats.failedExtracts}`)
	console.log(`New entries added:    ${stats.newEntries}`)
	console.log(`Final total:          ${newHistory.length}`)
	console.log("=".repeat(50) + "\n")

	if (stats.errors.length > 0 && verbose) {
		console.log("⚠️  Errors encountered:")
		stats.errors.forEach(({ taskId, error }) => {
			console.log(`   ${taskId}: ${error}`)
		})
		console.log()
	}

	// 6. Write results
	if (!dryRun) {
		const stateDir = path.join(storageDir, "state")
		const outputPath = path.join(stateDir, "taskHistory.json")

		// Create backup of current file
		if (await fileExists(outputPath)) {
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split(".")[0]
			const backupPath = path.join(stateDir, `taskHistory.json.backup-recovery-${timestamp}`)
			await fs.copyFile(outputPath, backupPath)
			console.log(`💾 Created backup: taskHistory.json.backup-recovery-${timestamp}`)
		}

		// Write new history
		await fs.writeFile(outputPath, JSON.stringify(newHistory, null, 2), "utf8")
		console.log(`✅ Wrote ${newHistory.length} entries to taskHistory.json\n`)
	} else {
		console.log("🔍 DRY RUN - No files were modified\n")
	}

	// 7. Success message
	if (!dryRun && stats.newEntries > 0) {
		console.log("✨ Recovery complete! Your task history has been restored.")
		console.log("   Restart VSCode/VSCodium to see the changes in the History view.\n")
	}
}

// Run the script
async function main() {
	const options = parseArgs()

	if (!options) {
		process.exit(0)
	}

	try {
		await recoverTaskHistory(options)
	} catch (error) {
		console.error("\n❌ Fatal error during recovery:")
		console.error(error)
		process.exit(1)
	}
}

main()
