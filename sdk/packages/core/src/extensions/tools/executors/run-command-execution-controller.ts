export interface RunningCommandRegistration {
	executionId: string;
	sessionId: string;
	toolCallId?: string;
	detach: () => boolean;
}

/**
 * Tracks shell processes that can release their owning tool call while the
 * process keeps running. The controller is host-scoped so hub commands can
 * target only commands owned by a particular session/tool call.
 */
export class RunCommandExecutionController {
	private readonly commands = new Map<string, RunningCommandRegistration>();

	register(command: RunningCommandRegistration): () => void {
		this.commands.set(command.executionId, command);
		return () => {
			if (this.commands.get(command.executionId) === command) {
				this.commands.delete(command.executionId);
			}
		};
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
				if (command.detach()) detachedCount += 1;
			} catch {
				// Detaching one command can fail while preparing its log. Continue so
				// parallel commands from the same tool call still get a chance to detach.
			}
		}
		return detachedCount;
	}
}
