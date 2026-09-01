import type {
	DetachedCommandCompletedEvent,
	RunCommandDetachKind,
} from "../../../types/events";

export type { RunCommandDetachKind } from "../../../types/events";

export interface RunningCommandRegistration {
	executionId: string;
	sessionId: string;
	toolCallId?: string;
	detach: (kind: RunCommandDetachKind) => boolean;
}

export type DetachedCommandCompletedListener = (
	event: DetachedCommandCompletedEvent,
) => void;

/**
 * Tracks shell processes that can release their owning tool call while the
 * process keeps running. The controller is host-scoped so hub commands can
 * target only commands owned by a particular session/tool call.
 */
export class RunCommandExecutionController {
	private static readonly COMPLETION_DEDUP_LIMIT = 4_096;
	private readonly commands = new Map<string, RunningCommandRegistration>();
	private readonly completionListeners =
		new Set<DetachedCommandCompletedListener>();
	private readonly completedExecutions = new Set<string>();

	register(command: RunningCommandRegistration): () => void {
		this.commands.set(command.executionId, command);
		return () => {
			if (this.commands.get(command.executionId) === command) {
				this.commands.delete(command.executionId);
			}
		};
	}

	subscribeToDetachedCommandCompleted(
		listener: DetachedCommandCompletedListener,
	): () => void {
		this.completionListeners.add(listener);
		return () => this.completionListeners.delete(listener);
	}

	reportDetachedCommandCompleted(event: DetachedCommandCompletedEvent): void {
		const key = `${event.sessionId}\u0000${event.executionId}`;
		if (this.completedExecutions.has(key)) return;
		this.completedExecutions.add(key);
		if (
			this.completedExecutions.size >
			RunCommandExecutionController.COMPLETION_DEDUP_LIMIT
		) {
			const oldestKey = this.completedExecutions.values().next().value;
			if (oldestKey) this.completedExecutions.delete(oldestKey);
		}
		for (const listener of [...this.completionListeners]) {
			try {
				listener(event);
			} catch {
				// One host listener must not prevent other observers from receiving
				// the terminal outcome of a detached process.
			}
		}
	}

	proceedWhileRunning(sessionId: string, toolCallId?: string): number {
		let detachedCount = 0;
		for (const command of [...this.commands.values()]) {
			if (
				command.sessionId !== sessionId ||
				(toolCallId !== undefined && command.toolCallId !== toolCallId)
			) {
				continue;
			}
			try {
				if (command.detach("user")) detachedCount += 1;
			} catch {
				// Detaching one command can fail while preparing its log. Continue so
				// parallel commands from the same tool call still get a chance to detach.
			}
		}
		return detachedCount;
	}
}
