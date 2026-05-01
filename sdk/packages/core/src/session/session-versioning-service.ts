import type * as LlmsProviders from "@clinebot/llms";
import type {
	CheckpointEntry,
	CheckpointMetadata,
} from "../hooks/checkpoint-hooks";
import { retainCheckpointRefs as defaultRetainCheckpointRefs } from "../hooks/checkpoint-hooks";
import type { RestoreSessionInput } from "../runtime/host/runtime-host";
import type { SessionRecord } from "../types/sessions";
import {
	applyCheckpointToWorktree,
	type CheckpointRestorePlan,
	createCheckpointRestorePlan,
	createRestoredCheckpointMetadata,
	trimMessagesBeforeCheckpoint,
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
	sourceMessages?: LlmsProviders.Message[];
	sourceSnapshot: CoreSessionSnapshot;
	plan: CheckpointRestorePlan;
	restoredCheckpointMetadata?: CheckpointMetadata;
	initialMessages: LlmsProviders.Message[];
	restoreMessages: boolean;
	restoreWorkspace: boolean;
	checkpointRunCount: number;
}

export interface SessionCheckpointRestoreResult<TStartResult = unknown> {
	sessionId?: string;
	startResult?: TStartResult;
	messages?: LlmsProviders.Message[];
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
	readMessages(sessionId: string): Promise<LlmsProviders.Message[]>;
	buildStartInput?: (
		context: SessionCheckpointRestoreContext,
		start: TRestoreStartInput,
	) => TStartInput | Promise<TStartInput>;
	startSession?: (input: TStartInput) => Promise<TStartResult>;
	getStartedSessionId?: (result: TStartResult) => string | undefined;
	readRestoredSession?: (
		sessionId: string,
	) => Promise<SessionRecord | undefined>;
	applyWorkspaceCheckpoint?: (
		cwd: string,
		checkpoint: CheckpointEntry,
	) => Promise<void>;
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
		if (restoreWorkspace) {
			await (input.applyWorkspaceCheckpoint ?? applyCheckpointToWorktree)(
				plan.cwd,
				plan.checkpoint,
			);
		}

		const sourceSnapshot = createCoreSessionSnapshot({
			session: sourceSession,
			messages: sourceMessages,
		});
		if (!restoreMessages) {
			return { checkpoint: plan.checkpoint, sourceSnapshot };
		}

		const restoredCheckpointMetadata = createRestoredCheckpointMetadata(
			sourceSession,
			input.checkpointRunCount,
		);
		const initialMessages = input.restore?.omitCheckpointMessageFromSession
			? trimMessagesBeforeCheckpoint(
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

		if (!input.start || !input.startSession) {
			throw new SessionVersioningError(
				"invalid_restore",
				"start is required when restore.messages is true",
			);
		}

		const startInput = input.buildStartInput
			? await input.buildStartInput(context, input.start)
			: (input.start as unknown as TStartInput);
		const startResult = await input.startSession(startInput);
		const newSessionId = input.getStartedSessionId?.(startResult);
		if (newSessionId) {
			await (input.retainCheckpointRefs ?? defaultRetainCheckpointRefs)(
				plan.cwd,
				newSessionId,
				restoredCheckpointMetadata?.history ?? [],
			);
		}
		const restoredSession =
			newSessionId && input.readRestoredSession
				? await input.readRestoredSession(newSessionId)
				: undefined;
		return {
			sessionId: newSessionId,
			startResult,
			messages: plan.messages,
			checkpoint: plan.checkpoint,
			sourceSnapshot,
			...(restoredSession
				? {
						restoredSnapshot: createCoreSessionSnapshot({
							session: restoredSession,
							messages: initialMessages,
						}),
					}
				: {}),
		};
	}
}
