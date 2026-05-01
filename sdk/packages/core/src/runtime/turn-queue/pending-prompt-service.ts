import { normalizeUserInput } from "@clinebot/shared";
import { nanoid } from "nanoid";
import type {
	CoreSessionEvent,
	SessionPendingPrompt,
} from "../../types/events";
import type { ActiveSession, PendingPrompt } from "../../types/session";
import type {
	PendingPromptMutationResult,
	PendingPromptsDeleteInput,
	PendingPromptsUpdateInput,
} from "../host/runtime-host";

export type PendingPromptDelivery = "queue" | "steer";

export interface PendingPromptEntry {
	id: string;
	prompt: string;
	delivery: PendingPromptDelivery;
	userImages?: string[];
	userFiles?: string[];
}

export interface PendingPromptQueueState {
	pendingPrompts: PendingPromptEntry[];
}

export interface PendingPromptsControllerDeps {
	getSession(sessionId: string): ActiveSession | undefined;
	emit(event: CoreSessionEvent): void;
	send(input: {
		sessionId: string;
		prompt: string;
		userImages?: string[];
		userFiles?: string[];
	}): Promise<unknown>;
}

export interface PendingPromptEnqueueInput {
	prompt: string;
	delivery: PendingPromptDelivery;
	userImages?: string[];
	userFiles?: string[];
}

export interface PendingPromptConsumeResult {
	entry?: PendingPromptEntry;
	prompts: SessionPendingPrompt[];
}

export class PendingPromptService {
	list(state: PendingPromptQueueState | undefined): SessionPendingPrompt[] {
		return state ? snapshotPrompts(state) : [];
	}

	update(
		state: PendingPromptQueueState | undefined,
		input: PendingPromptsUpdateInput,
	): PendingPromptMutationResult {
		if (!state) {
			return { sessionId: input.sessionId, prompts: [], updated: false };
		}
		const promptId = input.promptId.trim();
		const index = state.pendingPrompts.findIndex(
			(entry) => entry.id === promptId,
		);
		if (index < 0) {
			return {
				sessionId: input.sessionId,
				prompts: snapshotPrompts(state),
				updated: false,
			};
		}

		const existing = state.pendingPrompts[index];
		if (!existing) {
			return {
				sessionId: input.sessionId,
				prompts: snapshotPrompts(state),
				updated: false,
			};
		}
		const prompt =
			input.prompt === undefined
				? existing.prompt
				: normalizeUserInput(input.prompt).trim();
		if (!prompt) {
			throw new Error("prompt cannot be empty");
		}
		const delivery = input.delivery ?? existing.delivery;
		const next: PendingPromptEntry = { ...existing, prompt, delivery };
		state.pendingPrompts.splice(index, 1);
		insertUpdatedPrompt(state, next, index, existing.delivery);
		return {
			sessionId: input.sessionId,
			prompts: snapshotPrompts(state),
			prompt: snapshotPrompt(next),
			updated: true,
		};
	}

	delete(
		state: PendingPromptQueueState | undefined,
		input: PendingPromptsDeleteInput,
	): PendingPromptMutationResult {
		if (!state) {
			return { sessionId: input.sessionId, prompts: [], removed: false };
		}
		const promptId = input.promptId.trim();
		const index = state.pendingPrompts.findIndex(
			(entry) => entry.id === promptId,
		);
		if (index < 0) {
			return {
				sessionId: input.sessionId,
				prompts: snapshotPrompts(state),
				removed: false,
			};
		}
		const [removed] = state.pendingPrompts.splice(index, 1);
		return {
			sessionId: input.sessionId,
			prompts: snapshotPrompts(state),
			prompt: removed ? snapshotPrompt(removed) : undefined,
			removed: true,
		};
	}

	enqueue(
		state: PendingPromptQueueState,
		input: PendingPromptEnqueueInput,
	): SessionPendingPrompt[] {
		const { prompt, delivery, userImages, userFiles } = input;
		const existingIndex = state.pendingPrompts.findIndex(
			(queued) => queued.prompt === prompt,
		);
		if (existingIndex >= 0) {
			const [existing] = state.pendingPrompts.splice(existingIndex, 1);
			const next: PendingPromptEntry = {
				...existing,
				prompt,
				userImages: userImages ?? existing.userImages,
				userFiles: userFiles ?? existing.userFiles,
			};
			if (delivery === "steer" || existing.delivery === "steer") {
				state.pendingPrompts.unshift({ ...next, delivery: "steer" });
			} else {
				state.pendingPrompts.push(next);
			}
		} else {
			const newEntry: PendingPromptEntry = {
				id: `pending_${Date.now()}_${nanoid(5)}`,
				prompt,
				delivery,
				userImages,
				userFiles,
			};
			if (delivery === "steer") {
				state.pendingPrompts.unshift(newEntry);
			} else {
				state.pendingPrompts.push(newEntry);
			}
		}
		return snapshotPrompts(state);
	}

	consumeSteer(state: PendingPromptQueueState): PendingPromptConsumeResult {
		const steerIndex = state.pendingPrompts.findIndex(
			(entry) => entry.delivery === "steer",
		);
		if (steerIndex < 0) {
			return { prompts: snapshotPrompts(state) };
		}
		const [entry] = state.pendingPrompts.splice(steerIndex, 1);
		return { entry, prompts: snapshotPrompts(state) };
	}

	shiftNext(state: PendingPromptQueueState): PendingPromptConsumeResult {
		const entry = state.pendingPrompts.shift();
		return { entry, prompts: snapshotPrompts(state) };
	}

	requeueFront(
		state: PendingPromptQueueState,
		entry: PendingPromptEntry,
	): SessionPendingPrompt[] {
		state.pendingPrompts.unshift(entry);
		return snapshotPrompts(state);
	}

	clear(state: PendingPromptQueueState): SessionPendingPrompt[] {
		state.pendingPrompts.length = 0;
		return [];
	}
}

export class PendingPromptsController {
	private readonly service = new PendingPromptService();

	constructor(private readonly deps: PendingPromptsControllerDeps) {}

	list(sessionId: string): SessionPendingPrompt[] {
		return this.service.list(this.deps.getSession(sessionId));
	}

	update(input: PendingPromptsUpdateInput): PendingPromptMutationResult {
		const session = this.deps.getSession(input.sessionId);
		if (!session || session.aborting) {
			return { sessionId: input.sessionId, prompts: [], updated: false };
		}
		const result = this.service.update(session, input);
		this.emitPrompts(session);
		this.scheduleDrain(input.sessionId, session);
		return result;
	}

	delete(input: PendingPromptsDeleteInput): PendingPromptMutationResult {
		const session = this.deps.getSession(input.sessionId);
		if (!session || session.aborting) {
			return { sessionId: input.sessionId, prompts: [], removed: false };
		}
		const result = this.service.delete(session, input);
		this.emitPrompts(session);
		this.scheduleDrain(input.sessionId, session);
		return result;
	}

	enqueue(
		sessionId: string,
		entry: {
			prompt: string;
			delivery: "queue" | "steer";
			userImages?: string[];
			userFiles?: string[];
		},
	): void {
		const session = this.deps.getSession(sessionId);
		if (!session || session.aborting) return;
		this.service.enqueue(session, entry);
		this.emitPrompts(session);
		this.scheduleDrain(sessionId, session);
	}

	consumeSteer(sessionId: string): string | undefined {
		const session = this.deps.getSession(sessionId);
		if (!session) return undefined;
		const { entry: steer } = this.service.consumeSteer(session);
		if (!steer) return undefined;
		this.emitPrompts(session);
		this.emitSubmitted(session, steer);
		return steer.prompt;
	}

	clearAborted(session: ActiveSession): void {
		if (session.pendingPrompts.length === 0) return;
		this.service.clear(session);
		this.emitPrompts(session);
	}

	emitPrompts(session: ActiveSession): void {
		this.deps.emit({
			type: "pending_prompts",
			payload: {
				sessionId: session.sessionId,
				prompts: snapshotPrompts(session),
			},
		});
	}

	scheduleDrain(sessionId: string, session: ActiveSession): void {
		if (
			session.pendingPrompts.length === 0 ||
			session.aborting ||
			session.drainingPendingPrompts ||
			!session.agent.canStartRun()
		) {
			return;
		}
		queueMicrotask(() => {
			void this.drain(sessionId);
		});
	}

	async drain(sessionId: string): Promise<void> {
		const session = this.deps.getSession(sessionId);
		if (!session || session.aborting || session.drainingPendingPrompts) return;
		if (!session.agent.canStartRun()) return;
		const { entry: next } = this.service.shiftNext(session);
		if (!next) return;
		this.emitPrompts(session);
		this.emitSubmitted(session, next);
		session.drainingPendingPrompts = true;
		try {
			await this.deps.send({
				sessionId,
				prompt: next.prompt,
				userImages: next.userImages,
				userFiles: next.userFiles,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message.includes("already in progress")) {
				this.service.requeueFront(session, next);
				this.emitPrompts(session);
			} else {
				throw error;
			}
		} finally {
			session.drainingPendingPrompts = false;
			if (session.pendingPrompts.length > 0) {
				queueMicrotask(() => {
					void this.drain(sessionId);
				});
			}
		}
	}

	private emitSubmitted(session: ActiveSession, entry: PendingPrompt): void {
		const prompt = snapshotPrompt(entry);
		this.deps.emit({
			type: "pending_prompt_submitted",
			payload: {
				sessionId: session.sessionId,
				id: prompt.id,
				prompt: prompt.prompt,
				delivery: prompt.delivery,
				attachmentCount: prompt.attachmentCount,
			},
		});
	}
}

function snapshotPrompt(entry: PendingPromptEntry): SessionPendingPrompt {
	return {
		id: entry.id,
		prompt: entry.prompt,
		delivery: entry.delivery,
		attachmentCount:
			(entry.userImages?.length ?? 0) + (entry.userFiles?.length ?? 0),
	};
}

function snapshotPrompts(
	state: PendingPromptQueueState,
): SessionPendingPrompt[] {
	return state.pendingPrompts.map(snapshotPrompt);
}

function insertUpdatedPrompt(
	state: PendingPromptQueueState,
	next: PendingPromptEntry,
	previousIndex: number,
	previousDelivery: PendingPromptDelivery,
): void {
	if (next.delivery === "steer") {
		state.pendingPrompts.unshift(next);
	} else if (previousDelivery === "steer") {
		state.pendingPrompts.push(next);
	} else {
		state.pendingPrompts.splice(previousIndex, 0, next);
	}
}
