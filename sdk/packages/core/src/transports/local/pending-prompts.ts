import { normalizeUserInput } from "@clinebot/shared";
import { nanoid } from "nanoid";
import type {
	PendingPromptMutationResult,
	PendingPromptsDeleteInput,
	PendingPromptsUpdateInput,
} from "../../runtime/host/runtime-host";
import type {
	CoreSessionEvent,
	SessionPendingPrompt,
} from "../../types/events";
import type { ActiveSession, PendingPrompt } from "../../types/session";

export interface PendingPromptsDeps {
	getSession(sessionId: string): ActiveSession | undefined;
	emit(event: CoreSessionEvent): void;
	send(input: {
		sessionId: string;
		prompt: string;
		userImages?: string[];
		userFiles?: string[];
	}): Promise<unknown>;
}

export class PendingPromptsController {
	constructor(private readonly deps: PendingPromptsDeps) {}

	list(sessionId: string): SessionPendingPrompt[] {
		const session = this.deps.getSession(sessionId);
		return session ? snapshotPrompts(session) : [];
	}

	update(input: PendingPromptsUpdateInput): PendingPromptMutationResult {
		const session = this.deps.getSession(input.sessionId);
		if (!session || session.aborting) {
			return { sessionId: input.sessionId, prompts: [], updated: false };
		}
		const promptId = input.promptId.trim();
		const index = session.pendingPrompts.findIndex(
			(entry) => entry.id === promptId,
		);
		if (index < 0) {
			return {
				sessionId: input.sessionId,
				prompts: snapshotPrompts(session),
				updated: false,
			};
		}

		const existing = session.pendingPrompts[index]!;
		const prompt =
			input.prompt === undefined
				? existing.prompt
				: normalizeUserInput(input.prompt).trim();
		if (!prompt) {
			throw new Error("prompt cannot be empty");
		}
		const delivery = input.delivery ?? existing.delivery;
		const next: PendingPrompt = { ...existing, prompt, delivery };
		session.pendingPrompts.splice(index, 1);
		if (delivery === "steer") {
			session.pendingPrompts.unshift(next);
		} else if (existing.delivery === "steer") {
			session.pendingPrompts.push(next);
		} else {
			session.pendingPrompts.splice(index, 0, next);
		}
		this.emitPrompts(session);
		this.scheduleDrain(input.sessionId, session);
		return {
			sessionId: input.sessionId,
			prompts: snapshotPrompts(session),
			prompt: snapshotPrompt(next),
			updated: true,
		};
	}

	delete(input: PendingPromptsDeleteInput): PendingPromptMutationResult {
		const session = this.deps.getSession(input.sessionId);
		if (!session || session.aborting) {
			return { sessionId: input.sessionId, prompts: [], removed: false };
		}
		const promptId = input.promptId.trim();
		const index = session.pendingPrompts.findIndex(
			(entry) => entry.id === promptId,
		);
		if (index < 0) {
			return {
				sessionId: input.sessionId,
				prompts: snapshotPrompts(session),
				removed: false,
			};
		}
		const [removed] = session.pendingPrompts.splice(index, 1);
		this.emitPrompts(session);
		this.scheduleDrain(input.sessionId, session);
		return {
			sessionId: input.sessionId,
			prompts: snapshotPrompts(session),
			prompt: removed ? snapshotPrompt(removed) : undefined,
			removed: true,
		};
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
		const { prompt, delivery, userImages, userFiles } = entry;
		const existingIndex = session.pendingPrompts.findIndex(
			(queued) => queued.prompt === prompt,
		);
		if (existingIndex >= 0) {
			const [existing] = session.pendingPrompts.splice(existingIndex, 1);
			if (delivery === "steer" || existing.delivery === "steer") {
				session.pendingPrompts.unshift({
					id: existing.id,
					prompt,
					delivery: "steer",
					userImages: userImages ?? existing.userImages,
					userFiles: userFiles ?? existing.userFiles,
				});
			} else {
				session.pendingPrompts.push({
					...existing,
					userImages: userImages ?? existing.userImages,
					userFiles: userFiles ?? existing.userFiles,
				});
			}
		} else {
			const newEntry: PendingPrompt = {
				id: `pending_${Date.now()}_${nanoid(5)}`,
				prompt,
				delivery,
				userImages,
				userFiles,
			};
			if (delivery === "steer") {
				session.pendingPrompts.unshift(newEntry);
			} else {
				session.pendingPrompts.push(newEntry);
			}
		}
		this.emitPrompts(session);
		this.scheduleDrain(sessionId, session);
	}

	consumeSteer(sessionId: string): string | undefined {
		const session = this.deps.getSession(sessionId);
		if (!session) return undefined;
		const steerIndex = session.pendingPrompts.findIndex(
			(entry) => entry.delivery === "steer",
		);
		if (steerIndex < 0) return undefined;
		const [steer] = session.pendingPrompts.splice(steerIndex, 1);
		this.emitPrompts(session);
		this.emitSubmitted(session, steer);
		return steer.prompt;
	}

	clearAborted(session: ActiveSession): void {
		if (session.pendingPrompts.length === 0) return;
		session.pendingPrompts.length = 0;
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
		const next = session.pendingPrompts.shift();
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
				session.pendingPrompts.unshift(next);
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
		this.deps.emit({
			type: "pending_prompt_submitted",
			payload: {
				sessionId: session.sessionId,
				id: entry.id,
				prompt: entry.prompt,
				delivery: entry.delivery,
				attachmentCount:
					(entry.userImages?.length ?? 0) + (entry.userFiles?.length ?? 0),
			},
		});
	}
}

function snapshotPrompt(entry: PendingPrompt): SessionPendingPrompt {
	return {
		id: entry.id,
		prompt: entry.prompt,
		delivery: entry.delivery,
		attachmentCount:
			(entry.userImages?.length ?? 0) + (entry.userFiles?.length ?? 0),
	};
}

function snapshotPrompts(session: ActiveSession): SessionPendingPrompt[] {
	return session.pendingPrompts.map(snapshotPrompt);
}
