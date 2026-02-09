/**
 * Bead (Ralph Loop) Management Module
 *
 * Provides the BeadManager for orchestrating iterative, reviewable
 * chunks of work in the Beadsmith+ extension.
 */

export {
	type BeadCommitOptions,
	type BeadCommitResult,
	BeadCommitService,
	createBeadCommitService,
} from "./BeadCommitService"
export {
	BeadManager,
	type BeadManagerConfig,
	type BeadManagerEvents,
	createBeadManager,
} from "./BeadManager"

export {
	BeadFileNames,
	BeadStorage,
	createBeadStorage,
	getBeadStorage,
	type IBeadStorage,
} from "./BeadStorage"
export {
	createSuccessCriteriaEvaluator,
	type EvaluationContext,
	SuccessCriteriaEvaluator,
	type TestRunResult,
} from "./SuccessCriteriaEvaluator"
