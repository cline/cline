import { RunCommandExecutionController } from "@cline/core"

type RunningCommandRegistration = Parameters<RunCommandExecutionController["register"]>[0]

export interface VscodeRunCommandExecutionControllerOptions {
	/** Called only when the aggregate running state changes. */
	onRunningChanged?: (running: boolean) => void
}

/**
 * The SDK command controller used by both VS Code terminal and background
 * executions, with the aggregate running flag required by the existing
 * webview footer layered on top.
 */
export class VscodeRunCommandExecutionController extends RunCommandExecutionController {
	private readonly registrations = new Set<symbol>()
	private legacyExecutionId = 0

	constructor(private readonly options: VscodeRunCommandExecutionControllerOptions = {}) {
		super()
	}

	get isRunning(): boolean {
		return this.registrations.size > 0
	}

	override register(
		command:
			| RunningCommandRegistration
			| (Omit<RunningCommandRegistration, "executionId" | "sessionId" | "detach"> & {
					executionId?: string
					sessionId?: string
					detach: (kind: Parameters<RunningCommandRegistration["detach"]>[0]) => boolean | void
			  }),
	): () => void {
		const wasRunning = this.isRunning
		const normalized: RunningCommandRegistration = {
			executionId: command.executionId ?? `vscode-command-${++this.legacyExecutionId}`,
			sessionId: command.sessionId ?? "",
			toolCallId: command.toolCallId,
			detach: (kind) => command.detach(kind) !== false,
		}
		const registration = Symbol(normalized.executionId)
		const unregisterSdk = super.register(normalized)
		this.registrations.add(registration)
		this.notifyIfChanged(wasRunning)

		return () => {
			const wasRunningBefore = this.isRunning
			if (!this.registrations.delete(registration)) {
				return
			}
			unregisterSdk()
			this.notifyIfChanged(wasRunningBefore)
		}
	}

	override proceedWhileRunning(sessionId = "", toolCallId?: string): number {
		return super.proceedWhileRunning(sessionId, toolCallId)
	}

	private notifyIfChanged(wasRunning: boolean): void {
		if (this.isRunning !== wasRunning) {
			this.options.onRunningChanged?.(this.isRunning)
		}
	}
}
