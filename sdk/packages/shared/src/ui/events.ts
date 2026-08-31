import type {
	MissionLogEntry,
	TeamMailboxMessage,
	TeamMessageType,
	TeammateLifecycleSpec,
	TeamOutcome,
	TeamOutcomeFragment,
	TeamRunRecord,
	TeamTask,
} from "../team/types";

/**
 * Team lifecycle events that UI surfaces render. This is the presentation
 * subset of the runtime `TeamEvent` union owned by `@cline/core`: members
 * that embed agent-runtime payloads (`task_start`, `task_end`,
 * `agent_event`) are host-internal and are filtered out by host adapters
 * before events reach a UI.
 */
export type TeamUiEvent =
	| {
			type: TeamMessageType.TeammateSpawned;
			agentId: string;
			role?: string;
			teammate: TeammateLifecycleSpec;
	  }
	| { type: TeamMessageType.TeammateShutdown; agentId: string; reason?: string }
	| { type: TeamMessageType.TeamTaskUpdated; task: TeamTask }
	| { type: TeamMessageType.TeamMessage; message: TeamMailboxMessage }
	| { type: TeamMessageType.TeamMissionLog; entry: MissionLogEntry }
	| { type: TeamMessageType.RunQueued; run: TeamRunRecord }
	| { type: TeamMessageType.RunStarted; run: TeamRunRecord }
	| { type: TeamMessageType.RunProgress; run: TeamRunRecord; message: string }
	| { type: TeamMessageType.RunCompleted; run: TeamRunRecord }
	| { type: TeamMessageType.RunFailed; run: TeamRunRecord }
	| { type: TeamMessageType.RunCancelled; run: TeamRunRecord; reason?: string }
	| {
			type: TeamMessageType.RunInterrupted;
			run: TeamRunRecord;
			reason?: string;
	  }
	| { type: TeamMessageType.OutcomeCreated; outcome: TeamOutcome }
	| {
			type: TeamMessageType.OutcomeFragmentAttached;
			fragment: TeamOutcomeFragment;
	  }
	| {
			type: TeamMessageType.OutcomeFragmentReviewed;
			fragment: TeamOutcomeFragment;
	  }
	| { type: TeamMessageType.OutcomeFinalized; outcome: TeamOutcome };
