/**
 * Ralph Wiggum Loop Module
 *
 * The core engine for iterative AI-driven development.
 * Simple loop pattern: fresh context each iteration, completion via promise string.
 */

export {
	RalphLoopController,
	createRalphLoopController,
	type RalphLoopConfig,
	type RalphLoopState,
	type RalphLoopEvents,
	type BackpressureResult,
} from "./RalphLoopController"

export {
	RalphLoopIntegration,
	getRalphLoopIntegration,
	resetRalphLoopIntegration,
	type RalphIntegrationState,
	type RalphIntegrationEvents,
	type ContextResetCallback,
	type StartIterationCallback,
} from "./RalphLoopIntegration"
