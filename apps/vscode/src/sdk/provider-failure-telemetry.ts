export const PROVIDER_FAILURE_ERROR_TYPE = {
	AUTH: "auth",
	BALANCE: "balance",
	SEND_ERROR: "send_error",
	TASK_INIT: "task_init",
	SDK_AGENT_ERROR: "sdk_agent_error",
	SDK_AGENT_DONE_ERROR: "sdk_agent_done_error",
} as const

export const PROVIDER_FAILURE_PHASE = {
	PREFLIGHT: "preflight",
	STREAMING: "streaming",
} as const

export type ProviderFailureErrorType = (typeof PROVIDER_FAILURE_ERROR_TYPE)[keyof typeof PROVIDER_FAILURE_ERROR_TYPE]

export type ProviderFailurePhase = (typeof PROVIDER_FAILURE_PHASE)[keyof typeof PROVIDER_FAILURE_PHASE]

export type ProviderFailureTelemetry = {
	sessionId?: string
	error: unknown
	providerId?: string
	modelId?: string
	errorType: ProviderFailureErrorType
	failurePhase: ProviderFailurePhase
}

export class ProviderFailureTelemetryTurnGate {
	private turnCounter = 0
	private activeTurnId: number | undefined
	private streamingFailureCapturedTurnId: number | undefined

	beginTurn(): void {
		this.turnCounter += 1
		this.activeTurnId = this.turnCounter
	}

	shouldCaptureStreamingFailure(): boolean {
		if (this.activeTurnId === undefined) {
			return true
		}
		if (this.streamingFailureCapturedTurnId === this.activeTurnId) {
			return false
		}
		this.streamingFailureCapturedTurnId = this.activeTurnId
		return true
	}
}
