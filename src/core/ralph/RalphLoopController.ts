/**
 * RalphLoopController - Core engine for the Ralph Wiggum loop pattern.
 *
 * Ralph is fundamentally simple: `while true; do cat PROMPT.md | claude-code; done`
 * State lives in files, fresh context each iteration, completion detected via promise string.
 *
 * This controller manages:
 * - Iteration counting
 * - Completion promise detection
 * - Context reset between iterations
 * - Optional bead integration for reviewable checkpoints
 */

import { Logger } from "@shared/services/Logger"
import { exec } from "child_process"
import { EventEmitter } from "events"
import { promisify } from "util"
import { v4 as uuidv4 } from "uuid"

const execAsync = promisify(exec)

import type { BeadManager } from "@core/beads/BeadManager"

/**
 * Configuration for the Ralph loop.
 */
export interface RalphLoopConfig {
	/** Maximum iterations before forced stop (default: 50) */
	maxIterations: number
	/** Token budget per iteration (default: 100000) */
	tokenBudget: number
	/** String that signals task completion (default: "COMPLETE") */
	completionPromise: string
	/** Whether beads are enabled for reviewable checkpoints */
	beadsEnabled: boolean
	/** Test command to run for backpressure (optional) */
	testCommand?: string
	/** Type check command for backpressure (optional) */
	typeCheckCommand?: string
	/** Lint command for backpressure (optional) */
	lintCommand?: string
	/** Workspace root directory for running commands (optional) */
	workspaceRoot?: string
}

/**
 * State of the Ralph loop.
 */
export interface RalphLoopState {
	/** Unique ID for this loop session */
	sessionId: string
	/** The original prompt (immutable) */
	originalPrompt: string
	/** Current iteration number (1-indexed) */
	currentIteration: number
	/** Status of the loop */
	status: "idle" | "running" | "paused" | "completed" | "failed" | "cancelled"
	/** When the loop started */
	startedAt?: number
	/** When the loop ended */
	endedAt?: number
	/** Total tokens used across all iterations */
	totalTokensUsed: number
	/** Last response from the agent */
	lastResponse?: string
	/** Whether completion promise was detected */
	completionDetected: boolean
	/** Errors encountered */
	errors: string[]
	/** Results of backpressure checks (tests, types, lint) */
	backpressureResults?: BackpressureResult
}

/**
 * Results from backpressure checks.
 */
export interface BackpressureResult {
	testsPass: boolean
	typesPass: boolean
	lintPass: boolean
	testOutput?: string
	typeOutput?: string
	lintOutput?: string
}

/**
 * Events emitted by the RalphLoopController.
 */
export interface RalphLoopEvents {
	iterationStarted: (iteration: number, state: RalphLoopState) => void
	iterationCompleted: (iteration: number, response: string, state: RalphLoopState) => void
	completionDetected: (state: RalphLoopState) => void
	backpressureTriggered: (result: BackpressureResult, state: RalphLoopState) => void
	loopCompleted: (state: RalphLoopState) => void
	loopFailed: (errors: string[], state: RalphLoopState) => void
	loopCancelled: (state: RalphLoopState) => void
	stateChanged: (state: RalphLoopState) => void
}

const DEFAULT_CONFIG: RalphLoopConfig = {
	maxIterations: 50,
	tokenBudget: 100000,
	completionPromise: "COMPLETE",
	beadsEnabled: false,
}

/**
 * RalphLoopController orchestrates the Ralph Wiggum loop pattern.
 *
 * The core loop is simple:
 * 1. Start with original prompt
 * 2. Agent processes request
 * 3. Check for completion promise in response
 * 4. If not complete, reset context and repeat
 * 5. If complete, finish the loop
 *
 * Backpressure is applied via tests/types/lint - if they fail,
 * the loop continues with fresh context to fix the issues.
 */
export class RalphLoopController extends EventEmitter {
	private state: RalphLoopState
	private config: RalphLoopConfig
	private beadManager: BeadManager | null
	private abortRequested: boolean = false

	constructor(beadManager?: BeadManager) {
		super()
		this.beadManager = beadManager ?? null
		this.config = { ...DEFAULT_CONFIG }
		this.state = this.createInitialState("")
	}

	/**
	 * Create initial state for a new loop.
	 */
	private createInitialState(prompt: string): RalphLoopState {
		return {
			sessionId: uuidv4(),
			originalPrompt: prompt,
			currentIteration: 0,
			status: "idle",
			totalTokensUsed: 0,
			completionDetected: false,
			errors: [],
		}
	}

	/**
	 * Get the current state.
	 */
	getState(): RalphLoopState {
		return { ...this.state }
	}

	/**
	 * Get the current configuration.
	 */
	getConfig(): RalphLoopConfig {
		return { ...this.config }
	}

	/**
	 * Update configuration.
	 */
	configure(config: Partial<RalphLoopConfig>): void {
		this.config = { ...this.config, ...config }
	}

	/**
	 * Check if the loop is currently running.
	 */
	isRunning(): boolean {
		return this.state.status === "running"
	}

	/**
	 * Check if the loop can be started.
	 */
	canStart(): boolean {
		return (
			this.state.status === "idle" ||
			this.state.status === "completed" ||
			this.state.status === "failed" ||
			this.state.status === "cancelled"
		)
	}

	/**
	 * Start the Ralph loop with the given prompt.
	 * Returns the session ID for tracking.
	 */
	startLoop(prompt: string): string {
		if (!this.canStart()) {
			throw new Error(`Cannot start loop: currently in ${this.state.status} state`)
		}

		this.abortRequested = false
		this.state = this.createInitialState(prompt)
		this.state.status = "running"
		this.state.startedAt = Date.now()

		this.emitStateChanged()

		// If beads are enabled, start a bead task
		if (this.config.beadsEnabled && this.beadManager) {
			this.beadManager.startTask(prompt, [{ type: "done_tag" }]).catch((error) => {
				Logger.error("[RalphLoop] Failed to start bead task:", error)
			})
		}

		return this.state.sessionId
	}

	/**
	 * Called when a new iteration is about to start.
	 * Returns the prompt to use for this iteration.
	 */
	beginIteration(): { prompt: string; iteration: number } {
		if (this.state.status !== "running") {
			throw new Error(`Cannot begin iteration: loop is ${this.state.status}`)
		}

		this.state.currentIteration++
		this.emitStateChanged()

		this.emit("iterationStarted", this.state.currentIteration, this.getState())

		// Always return the original prompt - Ralph uses fresh context each time
		return {
			prompt: this.state.originalPrompt,
			iteration: this.state.currentIteration,
		}
	}

	/**
	 * Called when an iteration completes with a response.
	 * Returns whether the loop should continue.
	 */
	async completeIteration(
		response: string,
		tokensUsed: number,
	): Promise<{ shouldContinue: boolean; needsContextReset: boolean }> {
		if (this.state.status !== "running") {
			return { shouldContinue: false, needsContextReset: false }
		}

		this.state.lastResponse = response
		this.state.totalTokensUsed += tokensUsed

		// Check for abort request
		if (this.abortRequested) {
			this.state.status = "cancelled"
			this.state.endedAt = Date.now()
			this.emitStateChanged()
			this.emit("loopCancelled", this.getState())
			return { shouldContinue: false, needsContextReset: false }
		}

		// Check for completion promise
		if (this.detectCompletionPromise(response)) {
			this.state.completionDetected = true

			// Run backpressure checks before accepting completion
			const backpressureResult = await this.runBackpressureChecks()
			this.state.backpressureResults = backpressureResult

			if (!this.passesBackpressure(backpressureResult)) {
				// Backpressure failed - continue with fresh context
				this.emit("backpressureTriggered", backpressureResult, this.getState())
				this.state.completionDetected = false // Reset - not actually complete

				if (this.state.currentIteration >= this.config.maxIterations) {
					this.state.status = "failed"
					this.state.errors.push("Max iterations reached with failing backpressure checks")
					this.state.endedAt = Date.now()
					this.emitStateChanged()
					this.emit("loopFailed", this.state.errors, this.getState())
					return { shouldContinue: false, needsContextReset: false }
				}

				this.emitStateChanged()
				return { shouldContinue: true, needsContextReset: true }
			}

			// Completion accepted
			this.state.status = "completed"
			this.state.endedAt = Date.now()
			this.emitStateChanged()
			this.emit("completionDetected", this.getState())
			this.emit("loopCompleted", this.getState())

			// Complete bead if enabled
			if (this.config.beadsEnabled && this.beadManager) {
				try {
					await this.beadManager.completeBead(response, "")
				} catch (error) {
					Logger.error("[RalphLoop] Failed to complete bead:", error)
				}
			}

			return { shouldContinue: false, needsContextReset: false }
		}

		// Check max iterations
		if (this.state.currentIteration >= this.config.maxIterations) {
			this.state.status = "failed"
			this.state.errors.push("Max iterations reached without completion")
			this.state.endedAt = Date.now()
			this.emitStateChanged()
			this.emit("loopFailed", this.state.errors, this.getState())
			return { shouldContinue: false, needsContextReset: false }
		}

		// Continue with fresh context
		this.emit("iterationCompleted", this.state.currentIteration, response, this.getState())
		this.emitStateChanged()

		return { shouldContinue: true, needsContextReset: true }
	}

	/**
	 * Record an error during iteration.
	 */
	recordError(error: string): void {
		this.state.errors.push(error)
		this.emitStateChanged()
	}

	/**
	 * Cancel the running loop.
	 */
	cancel(): void {
		if (this.state.status !== "running" && this.state.status !== "paused") {
			return
		}

		this.abortRequested = true

		// If loop is paused, transition to cancelled immediately
		if (this.state.status === "paused") {
			this.state.status = "cancelled"
			this.state.endedAt = Date.now()
			this.emitStateChanged()
			this.emit("loopCancelled", this.getState())
		}
		// If running, the next completeIteration call will handle it
	}

	/**
	 * Pause the loop.
	 */
	pause(): void {
		if (this.state.status !== "running") {
			return
		}

		this.state.status = "paused"
		this.emitStateChanged()
	}

	/**
	 * Resume a paused loop.
	 */
	resume(): void {
		if (this.state.status !== "paused") {
			return
		}

		this.state.status = "running"
		this.emitStateChanged()
	}

	/**
	 * Check if the response contains the completion promise.
	 */
	private detectCompletionPromise(response: string): boolean {
		return response.includes(this.config.completionPromise)
	}

	/**
	 * Run backpressure checks (tests, types, lint).
	 */
	private async runBackpressureChecks(): Promise<BackpressureResult> {
		const result: BackpressureResult = {
			testsPass: true,
			typesPass: true,
			lintPass: true,
		}

		// Run configured commands and check exit codes
		if (this.config.testCommand) {
			Logger.debug(`[RalphLoop] Running tests: ${this.config.testCommand}`)
			result.testsPass = await this.runCommand(this.config.testCommand, 60000) // 60s timeout for tests
		}

		if (this.config.typeCheckCommand) {
			Logger.debug(`[RalphLoop] Running type check: ${this.config.typeCheckCommand}`)
			result.typesPass = await this.runCommand(this.config.typeCheckCommand, 30000) // 30s timeout
		}

		if (this.config.lintCommand) {
			Logger.debug(`[RalphLoop] Running lint: ${this.config.lintCommand}`)
			result.lintPass = await this.runCommand(this.config.lintCommand, 30000) // 30s timeout
		}

		return result
	}

	/**
	 * Run a command and return true if it exits with code 0.
	 */
	private async runCommand(command: string, timeoutMs: number): Promise<boolean> {
		try {
			await execAsync(command, {
				cwd: this.config.workspaceRoot,
				timeout: timeoutMs,
				maxBuffer: 10 * 1024 * 1024, // 10MB buffer
			})
			Logger.debug(`[RalphLoop] Command succeeded: ${command}`)
			return true
		} catch (error) {
			Logger.debug(`[RalphLoop] Command failed: ${command}`, error)
			return false
		}
	}

	/**
	 * Check if all backpressure checks pass.
	 */
	private passesBackpressure(result: BackpressureResult): boolean {
		return result.testsPass && result.typesPass && result.lintPass
	}

	/**
	 * Emit a state changed event.
	 */
	private emitStateChanged(): void {
		this.emit("stateChanged", this.getState())
	}
}

/**
 * Create a RalphLoopController instance with optional configuration.
 */
export function createRalphLoopController(beadManager?: BeadManager, options?: Partial<RalphLoopConfig>): RalphLoopController {
	const controller = new RalphLoopController(beadManager)

	if (options) {
		controller.configure(options)
	}

	return controller
}
