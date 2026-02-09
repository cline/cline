/**
 * RalphLoopIntegration - Integrates RalphLoopController with Beadsmith's task system.
 *
 * This module provides the bridge between the Ralph loop pattern and Beadsmith's
 * existing task infrastructure. It hooks into task completion events to decide
 * whether to continue the loop or finish.
 */

import type { BeadManager } from "@core/beads/BeadManager"
import { createBeadManager } from "@core/beads/BeadManager"
import { Logger } from "@shared/services/Logger"
import { EventEmitter } from "events"
import type { RalphLoopConfig, RalphLoopController, RalphLoopState } from "./RalphLoopController"
import { createRalphLoopController } from "./RalphLoopController"

/**
 * Integration state combining loop state with task context.
 */
export interface RalphIntegrationState {
	loopState: RalphLoopState
	isActive: boolean
	taskId?: string
}

/**
 * Callback for resetting conversation context.
 */
export type ContextResetCallback = () => Promise<void>

/**
 * Callback for starting a new task iteration.
 */
export type StartIterationCallback = (prompt: string, iteration: number) => Promise<string>

/**
 * Events emitted by the integration layer.
 */
export interface RalphIntegrationEvents {
	loopActivated: (state: RalphIntegrationState) => void
	loopDeactivated: (state: RalphIntegrationState) => void
	iterationStarting: (iteration: number, prompt: string) => void
	iterationCompleted: (iteration: number, response: string) => void
	contextResetting: () => void
	contextReset: () => void
}

/**
 * RalphLoopIntegration manages the connection between RalphLoopController
 * and Beadsmith's task system.
 */
export class RalphLoopIntegration extends EventEmitter {
	private controller: RalphLoopController
	private beadManager: BeadManager | null = null
	private isActive: boolean = false
	private currentTaskId: string | null = null
	private contextResetCallback: ContextResetCallback | null = null
	private workspaceRoot: string

	constructor(workspaceRoot: string) {
		super()
		this.workspaceRoot = workspaceRoot
		this.controller = createRalphLoopController()
		this.setupControllerListeners()
	}

	/**
	 * Set up listeners for the underlying controller.
	 */
	private setupControllerListeners(): void {
		this.controller.on("iterationStarted", (iteration, state) => {
			this.emit("iterationStarting", iteration, state.originalPrompt)
		})

		this.controller.on("iterationCompleted", (iteration, response, state) => {
			this.emit("iterationCompleted", iteration, response)
		})

		this.controller.on("loopCompleted", (state) => {
			this.deactivate()
		})

		this.controller.on("loopFailed", (errors, state) => {
			Logger.error("[RalphIntegration] Loop failed:", errors)
			this.deactivate()
		})

		this.controller.on("loopCancelled", (state) => {
			this.deactivate()
		})
	}

	/**
	 * Get the current integration state.
	 */
	getState(): RalphIntegrationState {
		return {
			loopState: this.controller.getState(),
			isActive: this.isActive,
			taskId: this.currentTaskId ?? undefined,
		}
	}

	/**
	 * Get the underlying controller.
	 */
	getController(): RalphLoopController {
		return this.controller
	}

	/**
	 * Get the bead manager if beads are enabled.
	 */
	getBeadManager(): BeadManager | null {
		return this.beadManager
	}

	/**
	 * Configure the loop with the given options.
	 */
	configure(config: Partial<RalphLoopConfig>): void {
		this.controller.configure(config)

		// Create or destroy bead manager based on beadsEnabled
		if (config.beadsEnabled && !this.beadManager) {
			this.beadManager = createBeadManager(this.workspaceRoot)
		} else if (config.beadsEnabled === false && this.beadManager) {
			this.beadManager = null
		}
	}

	/**
	 * Set the callback for resetting conversation context.
	 */
	setContextResetCallback(callback: ContextResetCallback): void {
		this.contextResetCallback = callback
	}

	/**
	 * Activate the Ralph loop with a prompt.
	 */
	activate(prompt: string, taskId?: string): string {
		if (this.isActive) {
			throw new Error("Ralph loop is already active")
		}

		this.isActive = true
		this.currentTaskId = taskId ?? null

		const sessionId = this.controller.startLoop(prompt)

		this.emit("loopActivated", this.getState())

		return sessionId
	}

	/**
	 * Deactivate the Ralph loop.
	 */
	deactivate(): void {
		if (!this.isActive) {
			return
		}

		this.isActive = false
		this.currentTaskId = null

		this.emit("loopDeactivated", this.getState())
	}

	/**
	 * Check if the loop is active.
	 */
	isLoopActive(): boolean {
		return this.isActive && this.controller.isRunning()
	}

	/**
	 * Called when a task response is received.
	 * Returns whether the loop should continue.
	 */
	async onTaskResponse(
		response: string,
		tokensUsed: number,
	): Promise<{
		shouldContinue: boolean
		needsContextReset: boolean
		prompt?: string
	}> {
		if (!this.isActive) {
			return { shouldContinue: false, needsContextReset: false }
		}

		const result = await this.controller.completeIteration(response, tokensUsed)

		if (result.shouldContinue) {
			// If context needs reset, do it
			if (result.needsContextReset && this.contextResetCallback) {
				this.emit("contextResetting")
				await this.contextResetCallback()
				this.emit("contextReset")
			}

			// Get the prompt for the next iteration
			const { prompt, iteration } = this.controller.beginIteration()

			return {
				shouldContinue: true,
				needsContextReset: result.needsContextReset,
				prompt,
			}
		}

		return { shouldContinue: false, needsContextReset: false }
	}

	/**
	 * Cancel the currently running loop.
	 */
	cancel(): void {
		if (this.isActive) {
			this.controller.cancel()
		}
	}

	/**
	 * Pause the loop.
	 */
	pause(): void {
		if (this.isActive) {
			this.controller.pause()
		}
	}

	/**
	 * Resume a paused loop.
	 */
	resume(): void {
		if (this.isActive) {
			this.controller.resume()
		}
	}

	/**
	 * Record an error during the current iteration.
	 */
	recordError(error: string): void {
		this.controller.recordError(error)
	}
}

/**
 * Singleton instance for the global Ralph loop integration.
 */
let globalIntegration: RalphLoopIntegration | null = null

/**
 * Get the global Ralph loop integration instance.
 */
export function getRalphLoopIntegration(workspaceRoot?: string): RalphLoopIntegration {
	if (!globalIntegration) {
		if (!workspaceRoot) {
			throw new Error("workspaceRoot is required to create RalphLoopIntegration")
		}
		globalIntegration = new RalphLoopIntegration(workspaceRoot)
	}
	return globalIntegration
}

/**
 * Reset the global integration (for testing).
 */
export function resetRalphLoopIntegration(): void {
	if (globalIntegration) {
		globalIntegration.deactivate()
		globalIntegration = null
	}
}
