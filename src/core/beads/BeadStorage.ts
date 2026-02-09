/**
 * BeadStorage - Persistence layer for bead data.
 *
 * Handles saving and loading bead state to/from disk, providing
 * durability for the Ralph Wiggum loop pattern.
 */

import fs from "fs/promises"
import * as path from "path"

import { Logger } from "@shared/services/Logger"
import { fileExistsAtPath } from "@utils/fs"
import type {
	Bead,
	BeadManagerState,
	BeadTaskDefinition,
	BeadTaskStatus,
	BeadTaskSummary,
} from "@shared/beads"
import { ensureTaskDirectoryExists } from "@core/storage/disk"

/**
 * File names used for bead storage.
 */
export const BeadFileNames = {
	/** Current bead manager state */
	beadState: "bead_state.json",
	/** Individual bead data (indexed by bead ID) */
	beadData: (beadId: string) => `bead_${beadId}.json`,
	/** Task summary after completion */
	taskSummary: "task_summary.json",
	/** Beads directory within task */
	beadsDir: "beads",
}

/**
 * Atomically write data to a file using temp file + rename pattern.
 * Retries on EPERM errors which are common on Windows due to file locking.
 */
async function atomicWriteFile(filePath: string, data: string, retries = 3): Promise<void> {
	const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(7)}.json`
	try {
		await fs.writeFile(tmpPath, data, "utf8")
		await fs.rename(tmpPath, filePath)
	} catch (error: unknown) {
		fs.unlink(tmpPath).catch(() => {})
		const isEperm = error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EPERM"
		if (isEperm && retries > 0) {
			await new Promise((resolve) => setTimeout(resolve, 100))
			return atomicWriteFile(filePath, data, retries - 1)
		}
		throw error
	}
}

/**
 * Storage interface for bead persistence.
 */
export interface IBeadStorage {
	saveState(taskId: string, state: BeadManagerState): Promise<void>
	loadState(taskId: string): Promise<BeadManagerState | null>
	saveBead(taskId: string, bead: Bead): Promise<void>
	loadBead(taskId: string, beadId: string): Promise<Bead | null>
	loadAllBeads(taskId: string): Promise<Bead[]>
	saveTaskSummary(taskId: string, summary: BeadTaskSummary): Promise<void>
	loadTaskSummary(taskId: string): Promise<BeadTaskSummary | null>
	deleteBeadData(taskId: string): Promise<void>
}

/**
 * File-based storage for bead data.
 *
 * Directory structure:
 * ```
 * tasks/{taskId}/
 *   bead_state.json         - Current BeadManagerState
 *   task_summary.json       - Final task summary (after completion)
 *   beads/
 *     bead_{beadId}.json    - Individual bead data
 * ```
 */
export class BeadStorage implements IBeadStorage {
	/**
	 * Ensure the beads directory exists for a task.
	 */
	private async ensureBeadsDir(taskId: string): Promise<string> {
		const taskDir = await ensureTaskDirectoryExists(taskId)
		const beadsDir = path.join(taskDir, BeadFileNames.beadsDir)
		await fs.mkdir(beadsDir, { recursive: true })
		return beadsDir
	}

	/**
	 * Save the current bead manager state.
	 */
	async saveState(taskId: string, state: BeadManagerState): Promise<void> {
		try {
			const taskDir = await ensureTaskDirectoryExists(taskId)
			const filePath = path.join(taskDir, BeadFileNames.beadState)

			// Create a serializable version of the state
			const serializable: SerializableBeadManagerState = {
				currentTask: state.currentTask,
				status: state.status,
				currentBeadNumber: state.currentBeadNumber,
				beadIds: state.beads.map((b) => b.id),
				totalTokensUsed: state.totalTokensUsed,
				totalIterationCount: state.totalIterationCount,
				lastCriteriaResult: state.lastCriteriaResult,
				savedAt: Date.now(),
			}

			await atomicWriteFile(filePath, JSON.stringify(serializable, null, 2))

			// Also save each bead individually
			for (const bead of state.beads) {
				await this.saveBead(taskId, bead)
			}

			Logger.debug(`[BeadStorage] Saved state for task ${taskId}`)
		} catch (error) {
			Logger.error("[BeadStorage] Failed to save state:", error)
			throw error
		}
	}

	/**
	 * Load the bead manager state for a task.
	 */
	async loadState(taskId: string): Promise<BeadManagerState | null> {
		try {
			const taskDir = await ensureTaskDirectoryExists(taskId)
			const filePath = path.join(taskDir, BeadFileNames.beadState)

			if (!(await fileExistsAtPath(filePath))) {
				return null
			}

			const content = await fs.readFile(filePath, "utf8")
			const serialized: SerializableBeadManagerState = JSON.parse(content)

			// Load all beads referenced in the state
			const beads: Bead[] = []
			for (const beadId of serialized.beadIds) {
				const bead = await this.loadBead(taskId, beadId)
				if (bead) {
					beads.push(bead)
				}
			}

			// Reconstruct the full state
			const state: BeadManagerState = {
				currentTask: serialized.currentTask,
				status: serialized.status,
				currentBeadNumber: serialized.currentBeadNumber,
				beads,
				totalTokensUsed: serialized.totalTokensUsed,
				totalIterationCount: serialized.totalIterationCount,
				lastCriteriaResult: serialized.lastCriteriaResult,
			}

			Logger.debug(`[BeadStorage] Loaded state for task ${taskId}`)
			return state
		} catch (error) {
			Logger.error("[BeadStorage] Failed to load state:", error)
			return null
		}
	}

	/**
	 * Save an individual bead.
	 */
	async saveBead(taskId: string, bead: Bead): Promise<void> {
		try {
			const beadsDir = await this.ensureBeadsDir(taskId)
			const filePath = path.join(beadsDir, BeadFileNames.beadData(bead.id))

			await atomicWriteFile(filePath, JSON.stringify(bead, null, 2))

			Logger.debug(`[BeadStorage] Saved bead ${bead.id} for task ${taskId}`)
		} catch (error) {
			Logger.error(`[BeadStorage] Failed to save bead ${bead.id}:`, error)
			throw error
		}
	}

	/**
	 * Load an individual bead by ID.
	 */
	async loadBead(taskId: string, beadId: string): Promise<Bead | null> {
		try {
			const beadsDir = await this.ensureBeadsDir(taskId)
			const filePath = path.join(beadsDir, BeadFileNames.beadData(beadId))

			if (!(await fileExistsAtPath(filePath))) {
				return null
			}

			const content = await fs.readFile(filePath, "utf8")
			return JSON.parse(content) as Bead
		} catch (error) {
			Logger.error(`[BeadStorage] Failed to load bead ${beadId}:`, error)
			return null
		}
	}

	/**
	 * Load all beads for a task.
	 */
	async loadAllBeads(taskId: string): Promise<Bead[]> {
		try {
			const beadsDir = await this.ensureBeadsDir(taskId)

			const files = await fs.readdir(beadsDir)
			const beadFiles = files.filter(
				(f) => f.startsWith("bead_") && f.endsWith(".json")
			)

			const beads: Bead[] = []
			for (const file of beadFiles) {
				const filePath = path.join(beadsDir, file)
				const content = await fs.readFile(filePath, "utf8")
				beads.push(JSON.parse(content) as Bead)
			}

			// Sort by bead number
			beads.sort((a, b) => a.beadNumber - b.beadNumber)

			Logger.debug(`[BeadStorage] Loaded ${beads.length} beads for task ${taskId}`)
			return beads
		} catch (error) {
			Logger.error("[BeadStorage] Failed to load all beads:", error)
			return []
		}
	}

	/**
	 * Save the final task summary.
	 */
	async saveTaskSummary(taskId: string, summary: BeadTaskSummary): Promise<void> {
		try {
			const taskDir = await ensureTaskDirectoryExists(taskId)
			const filePath = path.join(taskDir, BeadFileNames.taskSummary)

			await atomicWriteFile(filePath, JSON.stringify(summary, null, 2))

			Logger.debug(`[BeadStorage] Saved task summary for ${taskId}`)
		} catch (error) {
			Logger.error("[BeadStorage] Failed to save task summary:", error)
			throw error
		}
	}

	/**
	 * Load the task summary if it exists.
	 */
	async loadTaskSummary(taskId: string): Promise<BeadTaskSummary | null> {
		try {
			const taskDir = await ensureTaskDirectoryExists(taskId)
			const filePath = path.join(taskDir, BeadFileNames.taskSummary)

			if (!(await fileExistsAtPath(filePath))) {
				return null
			}

			const content = await fs.readFile(filePath, "utf8")
			return JSON.parse(content) as BeadTaskSummary
		} catch (error) {
			Logger.error("[BeadStorage] Failed to load task summary:", error)
			return null
		}
	}

	/**
	 * Delete all bead data for a task.
	 */
	async deleteBeadData(taskId: string): Promise<void> {
		try {
			const taskDir = await ensureTaskDirectoryExists(taskId)

			// Delete state file
			const stateFilePath = path.join(taskDir, BeadFileNames.beadState)
			if (await fileExistsAtPath(stateFilePath)) {
				await fs.unlink(stateFilePath)
			}

			// Delete summary file
			const summaryFilePath = path.join(taskDir, BeadFileNames.taskSummary)
			if (await fileExistsAtPath(summaryFilePath)) {
				await fs.unlink(summaryFilePath)
			}

			// Delete beads directory
			const beadsDir = path.join(taskDir, BeadFileNames.beadsDir)
			if (await fileExistsAtPath(beadsDir)) {
				await fs.rm(beadsDir, { recursive: true })
			}

			Logger.debug(`[BeadStorage] Deleted bead data for task ${taskId}`)
		} catch (error) {
			Logger.error("[BeadStorage] Failed to delete bead data:", error)
			throw error
		}
	}
}

/**
 * Serializable version of BeadManagerState for storage.
 * Stores bead IDs instead of full beads to avoid duplication.
 */
interface SerializableBeadManagerState {
	currentTask: BeadTaskDefinition | null
	status: BeadTaskStatus
	currentBeadNumber: number
	beadIds: string[]
	totalTokensUsed: number
	totalIterationCount: number
	lastCriteriaResult?: {
		allPassed: boolean
		results: Record<string, boolean>
		details?: string
	}
	savedAt: number
}

/**
 * Create a BeadStorage instance.
 */
export function createBeadStorage(): BeadStorage {
	return new BeadStorage()
}

/**
 * Global singleton instance for bead storage.
 */
let globalBeadStorage: BeadStorage | null = null

/**
 * Get the global BeadStorage instance.
 */
export function getBeadStorage(): BeadStorage {
	if (!globalBeadStorage) {
		globalBeadStorage = createBeadStorage()
	}
	return globalBeadStorage
}
