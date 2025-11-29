/**
 * Trajectory Manager
 *
 * High-level utilities for managing ATIF trajectories in Cline.
 * Provides functions for creating, updating, and exporting trajectories.
 */

import type { ATIFMetricsSchema, ATIFObservationSchema, ATIFStepObject, ATIFTrajectory } from "./atif"
import {
	type ClineToATIFOptions,
	convertATIFToClineMessages,
	convertClineMessagesToATIF,
	parseATIFTrajectory,
	serializeATIFTrajectory,
} from "./atif-converter"
import type { ClineStorageMessage } from "./content"

/**
 * TrajectoryBuilder - Fluent API for building ATIF trajectories
 */
export class TrajectoryBuilder {
	private messages: ClineStorageMessage[] = []
	private sessionId: string
	private agentVersion: string
	private defaultModelName?: string
	private notes?: string

	constructor(sessionId: string, agentVersion: string) {
		this.sessionId = sessionId
		this.agentVersion = agentVersion
	}

	/**
	 * Set the default model name for the trajectory
	 */
	setDefaultModel(modelName: string): this {
		this.defaultModelName = modelName
		return this
	}

	/**
	 * Add notes to the trajectory
	 */
	setNotes(notes: string): this {
		this.notes = notes
		return this
	}

	/**
	 * Add a message to the trajectory
	 */
	addMessage(message: ClineStorageMessage): this {
		this.messages.push(message)
		return this
	}

	/**
	 * Add multiple messages to the trajectory
	 */
	addMessages(messages: ClineStorageMessage[]): this {
		this.messages.push(...messages)
		return this
	}

	/**
	 * Build the ATIF trajectory
	 */
	build(): ATIFTrajectory {
		const options: ClineToATIFOptions = {
			sessionId: this.sessionId,
			agentVersion: this.agentVersion,
			defaultModelName: this.defaultModelName,
			notes: this.notes,
		}

		return convertClineMessagesToATIF(this.messages, options)
	}

	/**
	 * Build and serialize the trajectory to JSON
	 */
	buildJSON(pretty = true): string {
		return serializeATIFTrajectory(this.build(), pretty)
	}
}

/**
 * TrajectoryUpdater - Utilities for updating existing trajectories
 */
export class TrajectoryUpdater {
	private trajectory: ATIFTrajectory

	constructor(trajectory: ATIFTrajectory) {
		this.trajectory = trajectory
	}

	/**
	 * Add a new step to the trajectory
	 */
	addStep(step: ATIFStepObject): this {
		// Ensure step_id is sequential
		const lastStepId = this.trajectory.steps[this.trajectory.steps.length - 1]?.step_id || 0
		const newStep = { ...step, step_id: lastStepId + 1 }
		this.trajectory.steps.push(newStep)
		this.updateFinalMetrics()
		return this
	}

	/**
	 * Update metrics for a specific step
	 */
	updateStepMetrics(stepId: number, metrics: ATIFMetricsSchema): this {
		const step = this.trajectory.steps.find((s) => s.step_id === stepId)
		if (step) {
			step.metrics = { ...step.metrics, ...metrics }
			this.updateFinalMetrics()
		}
		return this
	}

	/**
	 * Add observation to a specific step
	 */
	addStepObservation(stepId: number, observation: ATIFObservationSchema): this {
		const step = this.trajectory.steps.find((s) => s.step_id === stepId)
		if (step) {
			step.observation = observation
		}
		return this
	}

	/**
	 * Update the trajectory notes
	 */
	setNotes(notes: string): this {
		this.trajectory.notes = notes
		return this
	}

	/**
	 * Recalculate and update final metrics
	 */
	private updateFinalMetrics(): void {
		let total_prompt_tokens = 0
		let total_completion_tokens = 0
		let total_cached_tokens = 0
		let total_cost_usd = 0

		for (const step of this.trajectory.steps) {
			if (step.metrics) {
				total_prompt_tokens += step.metrics.prompt_tokens || 0
				total_completion_tokens += step.metrics.completion_tokens || 0
				total_cached_tokens += step.metrics.cached_tokens || 0
				total_cost_usd += step.metrics.cost_usd || 0
			}
		}

		this.trajectory.final_metrics = {
			total_prompt_tokens,
			total_completion_tokens,
			total_cached_tokens,
			total_cost_usd,
			total_steps: this.trajectory.steps.length,
			extra: this.trajectory.final_metrics?.extra || {},
		}
	}

	/**
	 * Get the updated trajectory
	 */
	getTrajectory(): ATIFTrajectory {
		return this.trajectory
	}

	/**
	 * Serialize the trajectory to JSON
	 */
	toJSON(pretty = true): string {
		return serializeATIFTrajectory(this.trajectory, pretty)
	}
}

/**
 * TrajectoryReader - Utilities for reading and querying trajectories
 */
export class TrajectoryReader {
	private trajectory: ATIFTrajectory

	constructor(trajectory: ATIFTrajectory) {
		this.trajectory = trajectory
	}

	/**
	 * Load a trajectory from JSON string
	 */
	static fromJSON(json: string): TrajectoryReader {
		return new TrajectoryReader(parseATIFTrajectory(json))
	}

	/**
	 * Get the raw trajectory object
	 */
	getTrajectory(): ATIFTrajectory {
		return this.trajectory
	}

	/**
	 * Get all steps in the trajectory
	 */
	getSteps(): ATIFStepObject[] {
		return this.trajectory.steps
	}

	/**
	 * Get a specific step by ID
	 */
	getStep(stepId: number): ATIFStepObject | undefined {
		return this.trajectory.steps.find((s) => s.step_id === stepId)
	}

	/**
	 * Get all steps from a specific source (system/user/agent)
	 */
	getStepsBySource(source: "system" | "user" | "agent"): ATIFStepObject[] {
		return this.trajectory.steps.filter((s) => s.source === source)
	}

	/**
	 * Get all agent steps (assistant responses)
	 */
	getAgentSteps(): ATIFStepObject[] {
		return this.getStepsBySource("agent")
	}

	/**
	 * Get all user steps
	 */
	getUserSteps(): ATIFStepObject[] {
		return this.getStepsBySource("user")
	}

	/**
	 * Get all system steps
	 */
	getSystemSteps(): ATIFStepObject[] {
		return this.getStepsBySource("system")
	}

	/**
	 * Get steps that contain tool calls
	 */
	getStepsWithToolCalls(): ATIFStepObject[] {
		return this.trajectory.steps.filter((s) => s.tool_calls && s.tool_calls.length > 0)
	}

	/**
	 * Get steps that contain observations
	 */
	getStepsWithObservations(): ATIFStepObject[] {
		return this.trajectory.steps.filter((s) => s.observation && s.observation.results.length > 0)
	}

	/**
	 * Get the total cost of the trajectory
	 */
	getTotalCost(): number {
		return this.trajectory.final_metrics?.total_cost_usd || 0
	}

	/**
	 * Get the total number of tokens (prompt + completion)
	 */
	getTotalTokens(): number {
		const prompt = this.trajectory.final_metrics?.total_prompt_tokens || 0
		const completion = this.trajectory.final_metrics?.total_completion_tokens || 0
		return prompt + completion
	}

	/**
	 * Get token statistics
	 */
	getTokenStats(): {
		prompt: number
		completion: number
		cached: number
		total: number
	} {
		return {
			prompt: this.trajectory.final_metrics?.total_prompt_tokens || 0,
			completion: this.trajectory.final_metrics?.total_completion_tokens || 0,
			cached: this.trajectory.final_metrics?.total_cached_tokens || 0,
			total: this.getTotalTokens(),
		}
	}

	/**
	 * Convert trajectory to Cline messages
	 */
	toClineMessages(): ClineStorageMessage[] {
		return convertATIFToClineMessages(this.trajectory)
	}

	/**
	 * Get a summary of the trajectory
	 */
	getSummary(): {
		sessionId: string
		agentName: string
		agentVersion: string
		totalSteps: number
		userSteps: number
		agentSteps: number
		systemSteps: number
		toolCallCount: number
		totalCost: number
		totalTokens: number
	} {
		const agentSteps = this.getAgentSteps()
		const toolCallCount = agentSteps.reduce((count, step) => {
			return count + (step.tool_calls?.length || 0)
		}, 0)

		return {
			sessionId: this.trajectory.session_id,
			agentName: this.trajectory.agent.name,
			agentVersion: this.trajectory.agent.version,
			totalSteps: this.trajectory.steps.length,
			userSteps: this.getUserSteps().length,
			agentSteps: agentSteps.length,
			systemSteps: this.getSystemSteps().length,
			toolCallCount,
			totalCost: this.getTotalCost(),
			totalTokens: this.getTotalTokens(),
		}
	}
}

/**
 * Helper function to create a new trajectory builder
 */
export function createTrajectoryBuilder(sessionId: string, agentVersion: string): TrajectoryBuilder {
	return new TrajectoryBuilder(sessionId, agentVersion)
}

/**
 * Helper function to update an existing trajectory
 */
export function updateTrajectory(trajectory: ATIFTrajectory): TrajectoryUpdater {
	return new TrajectoryUpdater(trajectory)
}

/**
 * Helper function to read a trajectory
 */
export function readTrajectory(trajectory: ATIFTrajectory): TrajectoryReader {
	return new TrajectoryReader(trajectory)
}

/**
 * Helper function to read a trajectory from JSON
 */
export function readTrajectoryFromJSON(json: string): TrajectoryReader {
	return TrajectoryReader.fromJSON(json)
}
