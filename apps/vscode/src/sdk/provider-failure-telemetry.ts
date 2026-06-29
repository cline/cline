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
	dedupeKey?: string
}

const PROVIDER_FAILURE_DEDUPE_KEY_PREFIX = "provider-failure"

export function getProviderFailureDedupeKey(
	sessionId: string | undefined,
	failurePhase: ProviderFailurePhase,
): string | undefined {
	return sessionId ? `${PROVIDER_FAILURE_DEDUPE_KEY_PREFIX}:${sessionId}:${failurePhase}` : undefined
}

export class ProviderFailureTelemetryDeduper {
	private readonly capturedKeys = new Set<string>()

	shouldCapture(event: Pick<ProviderFailureTelemetry, "dedupeKey">): boolean {
		if (!event.dedupeKey) {
			return true
		}
		if (this.capturedKeys.has(event.dedupeKey)) {
			return false
		}
		this.capturedKeys.add(event.dedupeKey)
		return true
	}

	resetSession(sessionId: string): void {
		const sessionPrefix = `${PROVIDER_FAILURE_DEDUPE_KEY_PREFIX}:${sessionId}:`
		for (const key of this.capturedKeys) {
			if (key.startsWith(sessionPrefix)) {
				this.capturedKeys.delete(key)
			}
		}
	}
}
