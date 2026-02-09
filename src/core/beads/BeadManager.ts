/**
 * BeadManager - Orchestrates the Ralph Wiggum loop pattern.
 *
 * Manages the lifecycle of beads: creating them, tracking their state,
 * evaluating success criteria, and coordinating approval flows.
 */

import type { DagBridge } from "@services/dag/DagBridge"
import type {
	Bead,
	BeadFileChange,
	BeadManagerState,
	BeadTaskDefinition,
	SuccessCriteriaResult,
	SuccessCriterion,
} from "@shared/beads"
import { Logger } from "@shared/services/Logger"
import { exec } from "child_process"
import { EventEmitter } from "events"
import { v4 as uuidv4 } from "uuid"

/**
 * Events emitted by the BeadManager.
 */
export interface BeadManagerEvents {
	beadStarted: (bead: Bead) => void
	beadCompleted: (bead: Bead) => void
	beadFailed: (bead: Bead, errors: string[]) => void
	beadAwaitingApproval: (bead: Bead) => void
	taskCompleted: (summary: { success: boolean; beadCount: number; totalTokensUsed: number }) => void
	stateChanged: (state: BeadManagerState) => void
}

/**
 * Configuration for the BeadManager.
 */
export interface BeadManagerConfig {
	maxIterations: number
	tokenBudget: number
	testCommand?: string
	commitMode: "shadow" | "workspace"
	autoApprove: boolean
}

const DEFAULT_CONFIG: BeadManagerConfig = {
	maxIterations: 10,
	tokenBudget: 100000,
	commitMode: "shadow",
	autoApprove: false,
}

/**
 * BeadManager orchestrates the Ralph Wiggum loop pattern.
 *
 * The flow is:
 * 1. Start a task (creates first bead)
 * 2. Agent works on the bead
 * 3. Bead completes → evaluate success criteria
 * 4. If criteria met: request approval
 * 5. If approved: commit and either finish or start next bead
 * 6. If rejected: incorporate feedback and retry
 */
export class BeadManager extends EventEmitter {
	private state: BeadManagerState
	private config: BeadManagerConfig
	private dagBridge: DagBridge | null
	private workspaceRoot: string

	constructor(workspaceRoot: string, dagBridge?: DagBridge) {
		super()
		this.workspaceRoot = workspaceRoot
		this.dagBridge = dagBridge ?? null
		this.config = { ...DEFAULT_CONFIG }

		this.state = {
			currentTask: null,
			status: "idle",
			currentBeadNumber: 0,
			beads: [],
			totalTokensUsed: 0,
			totalIterationCount: 0,
		}
	}

	/**
	 * Get the current state of the bead manager.
	 */
	getState(): BeadManagerState {
		return { ...this.state }
	}

	/**
	 * Update configuration.
	 */
	configure(config: Partial<BeadManagerConfig>): void {
		this.config = { ...this.config, ...config }
	}

	/**
	 * Start a new task with the given definition.
	 */
	async startTask(description: string, successCriteria: SuccessCriterion[] = [{ type: "done_tag" }]): Promise<Bead> {
		if (this.state.status !== "idle" && this.state.status !== "completed" && this.state.status !== "failed") {
			throw new Error(`Cannot start task: manager is in ${this.state.status} state`)
		}

		const task: BeadTaskDefinition = {
			id: uuidv4(),
			description,
			workspaceRoot: this.workspaceRoot,
			successCriteria,
			tokenBudget: this.config.tokenBudget,
			maxIterations: this.config.maxIterations,
			testCommand: this.config.testCommand,
		}

		this.state = {
			currentTask: task,
			status: "running",
			currentBeadNumber: 0,
			beads: [],
			totalTokensUsed: 0,
			totalIterationCount: 0,
		}

		this.emitStateChanged()

		return this.startNextBead()
	}

	/**
	 * Start the next bead in the sequence.
	 */
	private startNextBead(): Bead {
		if (!this.state.currentTask) {
			throw new Error("No active task")
		}

		const beadNumber = this.state.currentBeadNumber + 1

		const bead: Bead = {
			id: uuidv4(),
			taskId: this.state.currentTask.id,
			beadNumber,
			status: "running",
			startedAt: Date.now(),
			filesChanged: [],
			tokensUsed: 0,
			iterationCount: 0,
			errors: [],
		}

		this.state.currentBeadNumber = beadNumber
		this.state.beads.push(bead)
		this.state.status = "running"

		this.emitStateChanged()
		this.emit("beadStarted", bead)

		return bead
	}

	/**
	 * Get the current bead being worked on.
	 */
	getCurrentBead(): Bead | null {
		if (this.state.beads.length === 0) {
			return null
		}
		return this.state.beads[this.state.beads.length - 1]
	}

	/**
	 * Record a file change in the current bead.
	 */
	recordFileChange(change: BeadFileChange): void {
		const bead = this.getCurrentBead()
		if (!bead) return

		bead.filesChanged.push(change)
		this.emitStateChanged()
	}

	/**
	 * Record token usage for the current bead.
	 */
	recordTokenUsage(tokens: number): void {
		const bead = this.getCurrentBead()
		if (!bead) return

		bead.tokensUsed += tokens
		this.state.totalTokensUsed += tokens
		this.emitStateChanged()
	}

	/**
	 * Record an error in the current bead.
	 */
	recordError(error: string): void {
		const bead = this.getCurrentBead()
		if (!bead) return

		bead.errors.push(error)
		this.emitStateChanged()
	}

	/**
	 * Mark the current bead as complete and evaluate success criteria.
	 */
	async completeBead(response: string, diff: string): Promise<{ needsApproval: boolean; canContinue: boolean }> {
		const bead = this.getCurrentBead()
		if (!bead) {
			throw new Error("No active bead")
		}

		bead.response = response

		// Get impact analysis if DAG is available
		if (this.dagBridge && bead.filesChanged.length > 0) {
			try {
				const firstFile = bead.filesChanged[0].filePath
				const impact = await this.dagBridge.getImpact(firstFile)
				bead.impactSummary = {
					affectedFiles: impact.affectedFiles,
					affectedFunctions: impact.affectedFunctions,
					suggestedTests: impact.suggestedTests,
					confidenceBreakdown: {
						high: impact.confidenceBreakdown.high ?? 0,
						medium: impact.confidenceBreakdown.medium ?? 0,
						low: impact.confidenceBreakdown.low ?? 0,
						unsafe: impact.confidenceBreakdown.unsafe ?? 0,
					},
				}
			} catch (error) {
				Logger.error("[BeadManager] Failed to get impact analysis:", error)
			}
		}

		// Evaluate success criteria
		const criteriaResult = await this.evaluateSuccessCriteria(bead, response)
		this.state.lastCriteriaResult = criteriaResult

		if (!criteriaResult.allPassed && bead.iterationCount < this.config.maxIterations) {
			// Criteria not met, can retry
			bead.iterationCount++
			this.state.totalIterationCount++
			this.emitStateChanged()
			return { needsApproval: false, canContinue: true }
		}

		if (!criteriaResult.allPassed) {
			// Max iterations reached without passing criteria
			bead.status = "rejected"
			this.state.status = "failed"
			this.emitStateChanged()
			this.emit("beadFailed", bead, ["Max iterations reached without passing success criteria"])
			return { needsApproval: false, canContinue: false }
		}

		// Criteria passed, request approval
		bead.status = "awaiting_approval"
		this.state.status = "awaiting_approval"
		this.emitStateChanged()
		this.emit("beadAwaitingApproval", bead)

		// If auto-approve is enabled, approve immediately
		if (this.config.autoApprove) {
			await this.approveBead()
			const canContinue = this.state.currentBeadNumber < this.config.maxIterations
			return { needsApproval: false, canContinue }
		}

		return { needsApproval: true, canContinue: true }
	}

	/**
	 * Approve the current bead.
	 */
	async approveBead(commitHash?: string): Promise<void> {
		const bead = this.getCurrentBead()
		if (!bead || bead.status !== "awaiting_approval") {
			throw new Error("No bead awaiting approval")
		}

		bead.status = "approved"
		bead.completedAt = Date.now()
		bead.commitHash = commitHash

		this.emit("beadCompleted", bead)

		// Check if we should continue or complete the task
		const isDone = this.checkIsDone()

		if (isDone) {
			this.state.status = "completed"
			this.emitStateChanged()
			this.emit("taskCompleted", {
				success: true,
				beadCount: this.state.beads.length,
				totalTokensUsed: this.state.totalTokensUsed,
			})
		} else {
			// Start next bead
			this.startNextBead()
		}
	}

	/**
	 * Reject the current bead with feedback.
	 */
	rejectBead(feedback: string): void {
		const bead = this.getCurrentBead()
		if (!bead || bead.status !== "awaiting_approval") {
			throw new Error("No bead awaiting approval")
		}

		bead.status = "rejected"
		bead.rejectionFeedback = feedback
		bead.completedAt = Date.now()

		this.state.status = "running"
		this.emitStateChanged()

		// Start a new bead to address the feedback
		this.startNextBead()
	}

	/**
	 * Skip the current bead.
	 */
	skipBead(): void {
		const bead = this.getCurrentBead()
		if (!bead || bead.status !== "awaiting_approval") {
			throw new Error("No bead awaiting approval")
		}

		bead.status = "skipped"
		bead.completedAt = Date.now()

		// Start next bead
		this.startNextBead()
	}

	/**
	 * Pause the current task.
	 */
	pauseTask(): void {
		if (this.state.status !== "running") {
			throw new Error("Cannot pause: task is not running")
		}

		this.state.status = "paused"
		this.emitStateChanged()
	}

	/**
	 * Resume a paused task.
	 */
	resumeTask(): void {
		if (this.state.status !== "paused") {
			throw new Error("Cannot resume: task is not paused")
		}

		this.state.status = "running"
		this.emitStateChanged()
	}

	/**
	 * Cancel the current task.
	 */
	cancelTask(): void {
		const bead = this.getCurrentBead()
		if (bead && bead.status === "running") {
			bead.status = "rejected"
			bead.completedAt = Date.now()
		}

		this.state.status = "failed"
		this.emitStateChanged()

		this.emit("taskCompleted", {
			success: false,
			beadCount: this.state.beads.length,
			totalTokensUsed: this.state.totalTokensUsed,
		})
	}

	/**
	 * Evaluate success criteria for a bead.
	 */
	private async evaluateSuccessCriteria(bead: Bead, response: string): Promise<SuccessCriteriaResult> {
		if (!this.state.currentTask) {
			return { allPassed: false, results: {} }
		}

		const results: Record<string, boolean> = {}

		for (const criterion of this.state.currentTask.successCriteria) {
			switch (criterion.type) {
				case "done_tag":
					results.done_tag = response.includes("DONE")
					break

				case "no_errors":
					results.no_errors = bead.errors.length === 0
					break

				case "tests_pass":
					// Run tests if test command is configured
					if (this.state.currentTask.testCommand) {
						const testsPassed = await this.runTests(this.state.currentTask.testCommand)
						results.tests_pass = testsPassed
					} else {
						results.tests_pass = true // Skip if no test command
					}
					break

				case "custom":
					// Custom criteria would be evaluated by external handler
					results.custom = true
					break
			}
		}

		const allPassed = Object.values(results).every((v) => v)

		return {
			allPassed,
			results,
		}
	}

	/**
	 * Run tests using the configured test command.
	 * @param testCommand The test command to execute
	 * @returns true if tests pass (exit code 0), false otherwise
	 */
	private async runTests(testCommand: string): Promise<boolean> {
		Logger.info(`[BeadManager] Running tests: ${testCommand}`)

		return new Promise((resolve) => {
			exec(
				testCommand,
				{
					cwd: this.workspaceRoot,
					timeout: 300000, // 5 minute timeout
					maxBuffer: 10 * 1024 * 1024, // 10MB buffer for test output
				},
				(error, stdout, stderr) => {
					if (error) {
						// Log test output for debugging
						if (stdout) {
							Logger.debug(`[BeadManager] Test stdout:\n${stdout}`)
						}
						if (stderr) {
							Logger.debug(`[BeadManager] Test stderr:\n${stderr}`)
						}
						Logger.info(`[BeadManager] Tests failed with exit code: ${error.code ?? "unknown"}`)
						resolve(false)
						return
					}

					Logger.info("[BeadManager] Tests passed")
					if (stdout) {
						Logger.debug(`[BeadManager] Test output:\n${stdout}`)
					}
					resolve(true)
				},
			)
		})
	}

	/**
	 * Check if the task should be considered done.
	 */
	private checkIsDone(): boolean {
		// Task is done if:
		// 1. Max iterations reached
		// 2. Token budget exhausted
		// 3. Last bead contained DONE marker

		if (this.state.currentBeadNumber >= this.config.maxIterations) {
			return true
		}

		if (this.state.totalTokensUsed >= this.config.tokenBudget) {
			return true
		}

		const lastBead = this.getCurrentBead()
		if (lastBead?.response?.includes("DONE")) {
			return true
		}

		return false
	}

	/**
	 * Emit a state changed event.
	 */
	private emitStateChanged(): void {
		this.emit("stateChanged", this.getState())
	}
}

/**
 * Create a BeadManager instance with configuration from VS Code settings.
 */
export function createBeadManager(
	workspaceRoot: string,
	dagBridge?: DagBridge,
	options?: {
		maxIterations?: number
		tokenBudget?: number
		testCommand?: string
		commitMode?: "shadow" | "workspace"
		autoApprove?: boolean
	},
): BeadManager {
	const manager = new BeadManager(workspaceRoot, dagBridge)

	if (options) {
		manager.configure(options)
	}

	return manager
}
