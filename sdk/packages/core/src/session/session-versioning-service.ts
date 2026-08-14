import type * as LlmsProviders from "@cline/llms";
import type {
	CheckpointEntry,
	CheckpointMetadata,
} from "../hooks/checkpoint-hooks";
import { retainCheckpointRefs as defaultRetainCheckpointRefs } from "../hooks/checkpoint-hooks";
import type { RestoreSessionInput } from "../runtime/host/runtime-host";
import type { SessionRecord } from "../types/sessions";
import {
	applyCheckpointToWorktree,
	beginWorktreeRestoreTransaction,
	type CheckpointRestorePlan,
	createCheckpointRestorePlan,
	createRestoredCheckpointMetadata,
	trimMessagesBeforeUserRun,
	type WorktreeRestoreTransaction,
} from "./checkpoint-restore";
import {
	type CoreSessionSnapshot,
	createCoreSessionSnapshot,
} from "./session-snapshot";

export type SessionVersioningErrorCode =
	| "invalid_restore"
	| "session_not_found"
	| "session_messages_not_found";

export class SessionVersioningError extends Error {
	constructor(
		readonly code: SessionVersioningErrorCode,
		message: string,
	) {
		super(message);
		this.name = "SessionVersioningError";
	}
}

export interface SessionCheckpointRestoreContext {
	sourceSession: SessionRecord;
	sourceMessages?: LlmsProviders.MessageWithMetadata[];
	sourceSnapshot: CoreSessionSnapshot;
	plan: CheckpointRestorePlan;
	restoredCheckpointMetadata?: CheckpointMetadata;
	initialMessages: LlmsProviders.MessageWithMetadata[];
	restoreMessages: boolean;
	restoreWorkspace: boolean;
	checkpointRunCount: number;
}

export interface SessionCheckpointRestoreResult<TStartResult = unknown> {
	sessionId?: string;
	startResult?: TStartResult;
	messages?: LlmsProviders.MessageWithMetadata[];
	checkpoint: CheckpointEntry;
	sourceSnapshot: CoreSessionSnapshot;
	restoredSnapshot?: CoreSessionSnapshot;
}

export interface SessionCheckpointRestoreInput<
	TRestoreStartInput,
	TStartInput,
	TStartResult,
> {
	sessionId: string;
	checkpointRunCount: number;
	cwd?: string;
	restore?: RestoreSessionInput["restore"];
	start?: TRestoreStartInput;
	getSession(sessionId: string): Promise<SessionRecord | undefined>;
	readMessages(sessionId: string): Promise<LlmsProviders.MessageWithMetadata[]>;
	buildStartInput?: (
		context: SessionCheckpointRestoreContext,
		start: TRestoreStartInput,
	) => TStartInput | Promise<TStartInput>;
	startSession?: (input: TStartInput) => Promise<TStartResult>;
	getStartedSessionId?: (result: TStartResult) => string | undefined;
	cleanupStartedSession?: (result: Awaited<TStartResult>) => Promise<void>;
	readRestoredSession?: (
		sessionId: string,
	) => Promise<SessionRecord | undefined>;
	applyWorkspaceCheckpoint?: (
		cwd: string,
		checkpoint: CheckpointEntry,
	) => Promise<void>;
	beginWorkspaceRestoreTransaction?: (
		cwd: string,
	) => Promise<WorktreeRestoreTransaction>;
	retainCheckpointRefs?: (
		cwd: string,
		sessionId: string,
		history: CheckpointEntry[],
	) => Promise<void>;
}

function validateRestoreOptions(input: {
	sessionId: string;
	restoreMessages: boolean;
	restoreWorkspace: boolean;
	requiresStart: boolean;
	checkpointRunCount: number;
}): string {
	const sourceSessionId = input.sessionId.trim();
	if (!sourceSessionId) {
		throw new SessionVersioningError(
			"invalid_restore",
			"sessionId is required",
		);
	}
	if (!input.restoreMessages && !input.restoreWorkspace) {
		throw new SessionVersioningError(
			"invalid_restore",
			"restore.messages or restore.workspace must be true",
		);
	}
	if (input.restoreMessages && input.requiresStart) {
		throw new SessionVersioningError(
			"invalid_restore",
			"start is required when restore.messages is true",
		);
	}
	if (
		!Number.isInteger(input.checkpointRunCount) ||
		input.checkpointRunCount < 1
	) {
		throw new SessionVersioningError(
			"invalid_restore",
			"checkpointRunCount must be a positive integer",
		);
	}
	return sourceSessionId;
}

export class SessionVersioningService {
	async restoreCheckpoint<TRestoreStartInput, TStartInput, TStartResult>(
		input: SessionCheckpointRestoreInput<
			TRestoreStartInput,
			TStartInput,
			TStartResult
		>,
	): Promise<SessionCheckpointRestoreResult<TStartResult>> {
		const restoreMessages = input.restore?.messages !== false;
		const restoreWorkspace = input.restore?.workspace !== false;
		const sourceSessionId = validateRestoreOptions({
			sessionId: input.sessionId,
			restoreMessages,
			restoreWorkspace,
			requiresStart: input.start === undefined,
			checkpointRunCount: input.checkpointRunCount,
		});

		const sourceSession = await input.getSession(sourceSessionId);
		if (!sourceSession) {
			throw new SessionVersioningError(
				"session_not_found",
				`Session ${sourceSessionId} not found`,
			);
		}
		const sourceMessages = restoreMessages
			? await input.readMessages(sourceSessionId)
			: undefined;
		if (restoreMessages && sourceMessages?.length === 0) {
			throw new SessionVersioningError(
				"session_messages_not_found",
				`No messages found for session ${sourceSessionId}`,
			);
		}

		const plan = createCheckpointRestorePlan({
			session: sourceSession,
			messages: sourceMessages,
			checkpointRunCount: input.checkpointRunCount,
			cwd: input.cwd,
			restoreMessages,
		});
		const sourceSnapshot = createCoreSessionSnapshot({
			session: sourceSession,
			messages: sourceMessages,
		});
		let restoredCheckpointMetadata: CheckpointMetadata | undefined;
		let initialMessages: LlmsProviders.MessageWithMetadata[] = [];
		let startInput: TStartInput | undefined;
		let messageRestoreOperations:
			| {
					startSession: (input: TStartInput) => Promise<TStartResult>;
					getStartedSessionId: (result: TStartResult) => string | undefined;
					cleanupStartedSession: (
						result: Awaited<TStartResult>,
					) => Promise<void>;
			  }
			| undefined;
		if (restoreMessages) {
			const { startSession, getStartedSessionId, cleanupStartedSession } =
				input;
			if (
				!input.start ||
				!startSession ||
				!getStartedSessionId ||
				!cleanupStartedSession
			) {
				throw new SessionVersioningError(
					"invalid_restore",
					"startSession, getStartedSessionId, and cleanupStartedSession are required when restore.messages is true",
				);
			}
			messageRestoreOperations = {
				startSession,
				getStartedSessionId,
				cleanupStartedSession,
			};
			restoredCheckpointMetadata = createRestoredCheckpointMetadata(
				sourceSession,
				input.checkpointRunCount,
			);
			initialMessages = input.restore?.omitCheckpointMessageFromSession
				? trimMessagesBeforeUserRun(
						sourceMessages ?? [],
						input.checkpointRunCount,
					)
				: (plan.messages ?? []);
			const context: SessionCheckpointRestoreContext = {
				sourceSession,
				sourceMessages,
				sourceSnapshot,
				plan,
				restoredCheckpointMetadata,
				initialMessages,
				restoreMessages,
				restoreWorkspace,
				checkpointRunCount: input.checkpointRunCount,
			};
			startInput = input.buildStartInput
				? await input.buildStartInput(context, input.start)
				: (input.start as unknown as TStartInput);
		}

		const applyWorkspaceCheckpoint =
			input.applyWorkspaceCheckpoint ?? applyCheckpointToWorktree;
		const beginWorkspaceRestoreTransaction =
			input.beginWorkspaceRestoreTransaction ??
			(input.applyWorkspaceCheckpoint
				? undefined
				: beginWorktreeRestoreTransaction);
		const transaction =
			restoreWorkspace && beginWorkspaceRestoreTransaction
				? await beginWorkspaceRestoreTransaction(plan.cwd)
				: undefined;
		let workspaceCommitted = false;
		let startedSession:
			| {
					result: Awaited<TStartResult>;
					cleanup: (result: Awaited<TStartResult>) => Promise<void>;
			  }
			| undefined;
		try {
			if (restoreWorkspace) {
				await applyWorkspaceCheckpoint(plan.cwd, plan.checkpoint);
			}
			if (!messageRestoreOperations) {
				await transaction?.commit();
				workspaceCommitted = true;
				return { checkpoint: plan.checkpoint, sourceSnapshot };
			}

			const startResult = await messageRestoreOperations.startSession(
				startInput as TStartInput,
			);
			startedSession = {
				result: startResult,
				cleanup: messageRestoreOperations.cleanupStartedSession,
			};
			const newSessionId =
				messageRestoreOperations.getStartedSessionId(startResult);
			if (!newSessionId) {
				throw new SessionVersioningError(
					"invalid_restore",
					"Restored session did not return a session id",
				);
			}
			await (input.retainCheckpointRefs ?? defaultRetainCheckpointRefs)(
				plan.cwd,
				newSessionId,
				restoredCheckpointMetadata?.history ?? [],
			);
			const restoredSession = input.readRestoredSession
				? await input.readRestoredSession(newSessionId)
				: undefined;
			const restoredSnapshot = restoredSession
				? createCoreSessionSnapshot({
						session: restoredSession,
						messages: initialMessages,
					})
				: undefined;
			await transaction?.commit();
			workspaceCommitted = true;
			return {
				sessionId: newSessionId,
				startResult,
				messages: plan.messages,
				checkpoint: plan.checkpoint,
				sourceSnapshot,
				...(restoredSnapshot ? { restoredSnapshot } : {}),
			};
		} catch (error) {
			const recoveryErrors: unknown[] = [];
			if (startedSession) {
				try {
					await startedSession.cleanup(startedSession.result);
				} catch (cleanupError) {
					recoveryErrors.push(cleanupError);
				}
			}
			if (transaction && !workspaceCommitted) {
				try {
					await transaction.rollback();
				} catch (rollbackError) {
					recoveryErrors.push(rollbackError);
				}
			}
			if (recoveryErrors.length > 0) {
				throw new AggregateError(
					[error, ...recoveryErrors],
					"Checkpoint restore failed and recovery did not complete",
				);
			}
			throw error;
		}
	}
}
