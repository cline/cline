/**
 * Bead (Ralph Loop) Management Module
 *
 * Provides the BeadManager for orchestrating iterative, reviewable
 * chunks of work in the Beadsmith+ extension.
 */

export {
	BeadManager,
	createBeadManager,
	type BeadManagerConfig,
	type BeadManagerEvents,
} from "./BeadManager"

export {
	SuccessCriteriaEvaluator,
	createSuccessCriteriaEvaluator,
	type EvaluationContext,
	type TestRunResult,
} from "./SuccessCriteriaEvaluator"

export {
	BeadStorage,
	createBeadStorage,
	getBeadStorage,
	BeadFileNames,
	type IBeadStorage,
} from "./BeadStorage"

export {
	BeadCommitService,
	createBeadCommitService,
	type BeadCommitOptions,
	type BeadCommitResult,
} from "./BeadCommitService"
