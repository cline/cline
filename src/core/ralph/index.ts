/**
 * Ralph Wiggum Loop Module
 *
 * The core engine for iterative AI-driven development.
 * Simple loop pattern: fresh context each iteration, completion via promise string.
 */

export {
	type BackpressureResult,
	createRalphLoopController,
	type RalphLoopConfig,
	RalphLoopController,
	type RalphLoopEvents,
	type RalphLoopState,
} from "./RalphLoopController"

export {
	type ContextResetCallback,
	getRalphLoopIntegration,
	type RalphIntegrationEvents,
	type RalphIntegrationState,
	RalphLoopIntegration,
	resetRalphLoopIntegration,
	type StartIterationCallback,
} from "./RalphLoopIntegration"
