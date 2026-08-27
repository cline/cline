import { Logger } from "@/shared/services/Logger"

export const MAX_RETRY_DELAY_SECONDS = 300

// Errors that can never succeed by retrying (oversized prompts, bad credentials,
// billing, invalid requests). Retrying these wedges the session in an endless
// futile loop, so the controller excludes them before scheduling a retry.
const PERMANENT_API_ERROR_PATTERNS = [
	"prompt is too long",
	"input too long",
	"context_length_exceeded",
	"context length",
	"context window",
	"maximum number of tokens",
	"request too large",
	"payload too large",
	"entity too large",
	"input validation error",
	"invalid_request_error",
	"invalid request",
	"invalid api key",
	"incorrect api key",
	"invalid_api_key",
	"missing api key",
	"unauthorized",
	"forbidden",
	"permission denied",
	"authentication",
	"insufficient_quota",
	"insufficient credit",
	"billing",
	"model_not_found",
	"model not found",
	"invalid model",
	"unsupported model",
	"no longer supported",
	"decommissioned",
	"does not exist",
]

export function isPermanentApiErrorMessage(message: string): boolean {
	const lower = message.toLowerCase()
	return PERMANENT_API_ERROR_PATTERNS.some((pattern) => lower.includes(pattern))
}

export interface RetryAttemptInfo {
	readonly attempt: number
	readonly delaySeconds: number
	readonly error: unknown
}

export interface SdkApiRetryCoordinatorOptions {
	isAutoRetryEnabled: () => boolean
	isSessionActive: (sessionId: string) => boolean
	sendTurn: (sessionId: string) => void
	emitRetryScheduled: (info: RetryAttemptInfo) => void
	onRetryAbandoned?: () => void
	scheduleTimer?: (fn: () => void, delayMs: number) => ReturnType<typeof setTimeout>
	cancelTimer?: (handle: ReturnType<typeof setTimeout>) => void
}

export function getFibonacciBackoffSeconds(attempt: number, maxSeconds: number = MAX_RETRY_DELAY_SECONDS): number {
	if (!Number.isInteger(attempt) || attempt < 1) {
		return 0
	}
	let prev = 0
	let curr = 1
	for (let i = 2; i <= attempt; i++) {
		const next = prev + curr
		prev = curr
		curr = next
	}
	return Math.min(curr, maxSeconds)
}

export class SdkApiRetryCoordinator {
	private retryCount = 0
	private pendingTimer: ReturnType<typeof setTimeout> | undefined
	private readonly scheduleTimer: (fn: () => void, delayMs: number) => ReturnType<typeof setTimeout>
	private readonly cancelTimer: (handle: ReturnType<typeof setTimeout>) => void

	constructor(private readonly options: SdkApiRetryCoordinatorOptions) {
		this.scheduleTimer = options.scheduleTimer ?? ((fn, delayMs) => setTimeout(fn, delayMs))
		this.cancelTimer = options.cancelTimer ?? ((handle) => clearTimeout(handle))
	}

	/** How many retries have been scheduled for the current failure streak. */
	get currentRetryCount(): number {
		return this.retryCount
	}

	get hasPendingRetry(): boolean {
		return this.pendingTimer !== undefined
	}

	handleSendError(error: unknown, sessionId: string): boolean {
		this.clearPending()
		if (!this.options.isAutoRetryEnabled() || !this.options.isSessionActive(sessionId)) {
			return false
		}
		this.retryCount += 1
		const attempt = this.retryCount
		const delaySeconds = getFibonacciBackoffSeconds(attempt)
		this.options.emitRetryScheduled({ attempt, delaySeconds, error })
		this.pendingTimer = this.scheduleTimer(() => {
			this.pendingTimer = undefined
			if (!this.options.isSessionActive(sessionId)) {
				Logger.log(`[ApiRetry] Session ${sessionId} inactive; abandoning retry #${attempt}`)
				this.options.onRetryAbandoned?.()
				return
			}
			Logger.log(`[ApiRetry] Retrying turn #${attempt} for session ${sessionId} after ${delaySeconds}s`)
			this.options.sendTurn(sessionId)
		}, delaySeconds * 1000)
		return true
	}

	reset(): void {
		this.clearPending()
		this.retryCount = 0
	}

	cancel(): void {
		this.clearPending()
		this.retryCount = 0
	}

	private clearPending(): void {
		if (this.pendingTimer !== undefined) {
			this.cancelTimer(this.pendingTimer)
			this.pendingTimer = undefined
		}
	}
}
