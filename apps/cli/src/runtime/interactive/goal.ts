/**
 * Native /goal completion guard for the interactive CLI.
 *
 * The guard implementation is shared with the VS Code extension and lives in
 * @cline/core (session/goal-guard). This module re-exports it so CLI
 * consumers keep a stable local import path.
 */
export {
	type CompletedGoalRecord,
	createInteractiveGoalGuard,
	formatGoalTaskPrompt,
	formatGoalVerificationPrompt,
	GOAL_COMMAND_USAGE,
	type InteractiveGoalGuard,
	type InteractiveGoalRecord,
	isGoalVerificationPrompt,
	MAX_GOAL_VERIFICATION_ROUNDS,
	sendTurnWithGoalVerification,
} from "@cline/core";
