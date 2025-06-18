export { IntentManager } from "./IntentManager"
export type {
	ClineIntent,
	IntentHistory,
	IntentScope,
	IntentStatus,
	OperationType,
	ImpactEstimate,
	LineRange,
} from "./ClineIntent"

export {
	createIntent,
	updateIntentStatus,
	addIntentToHistory,
	revertIntent,
	getIntentById,
	canRevertIntent,
	getIntentChain,
	getReversibleIntents,
} from "./ClineIntent"
