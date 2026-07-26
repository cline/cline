import { redactBedrockDiagnostics } from "@/services/bedrock/bedrock-errors"

export type AgentRunPhase =
	| "idle"
	| "submitting"
	| "awaitingFirstEvent"
	| "streaming"
	| "waitingForApproval"
	| "runningTool"
	| "cancelling"
	| "completed"
	| "cancelled"
	| "failed"

export type AgentRunFailureSource = "stream" | "tool" | "approval" | "rendering" | "persistence"

export interface AgentRunFailure {
	source: AgentRunFailureSource
	category?: string
	code?: string
	httpStatus?: number
	requestId?: string
	message: string
	details?: string
	retrySafe: boolean
}

export interface AgentRunMetrics {
	requestSentAt?: number
	firstEventAt?: number
	firstRenderedAt?: number
	cancellationRequestedAt?: number
	terminalAt?: number
	requestToFirstEventMs?: number
	firstEventToFirstRenderedMs?: number
	cancellationToTerminalMs?: number
}

export interface AgentRunState {
	phase: AgentRunPhase
	seq: number
	runId?: string
	sessionId?: string
	startedAt?: number
	stageStartedAt: number
	invocationId?: string
	currentToolName?: string
	failure?: AgentRunFailure
	metrics?: AgentRunMetrics
}

const TERMINAL_PHASES = new Set<AgentRunPhase>(["completed", "cancelled", "failed"])

/**
 * The extension-host authority for one visible agent run.
 *
 * Callers retain a runId and pass it to mutations that may settle later. A
 * mutation for a superseded run is ignored, which provides the cancellation
 * and late-event fence independently of the webview transcript.
 */
export class AgentRunLifecycle {
	private sequence = 0
	private state: AgentRunState = {
		phase: "idle",
		seq: 0,
		stageStartedAt: Date.now(),
	}

	get(): AgentRunState {
		return structuredClone(this.state)
	}

	get currentRunId(): string | undefined {
		return this.state.runId
	}

	isCurrent(runId: string | undefined): boolean {
		return Boolean(runId && runId === this.state.runId)
	}

	begin(input: { sessionId?: string; invocationId?: string; now?: number } = {}): string {
		const now = input.now ?? Date.now()
		const runId = crypto.randomUUID()
		this.state = {
			phase: "submitting",
			seq: ++this.sequence,
			runId,
			sessionId: input.sessionId,
			startedAt: now,
			stageStartedAt: now,
			invocationId: input.invocationId,
			metrics: {},
		}
		return runId
	}

	bindSession(runId: string, sessionId: string): boolean {
		if (!this.isMutable(runId)) return false
		this.state = { ...this.state, sessionId, seq: ++this.sequence }
		return true
	}

	requestSent(runId: string, now = Date.now()): boolean {
		if (this.isCurrent(runId) && this.state.phase === "awaitingFirstEvent") return true
		if (!this.isMutable(runId) || this.state.phase !== "submitting") return false
		return this.transition(runId, "awaitingFirstEvent", now, {
			metrics: { ...this.state.metrics, requestSentAt: now },
		})
	}

	firstEvent(runId: string, now = Date.now()): boolean {
		if (!this.isMutable(runId)) return false
		if (this.state.metrics?.firstEventAt !== undefined) return true
		const requestSentAt = this.state.metrics?.requestSentAt
		return this.transition(runId, "streaming", now, {
			currentToolName: undefined,
			metrics: {
				...this.state.metrics,
				firstEventAt: this.state.metrics?.firstEventAt ?? now,
				...(requestSentAt !== undefined ? { requestToFirstEventMs: Math.max(0, now - requestSentAt) } : {}),
			},
		})
	}

	firstRendered(runId: string, now = Date.now()): boolean {
		if (!this.isMutable(runId) || this.state.metrics?.firstRenderedAt !== undefined) return false
		const firstEventAt = this.state.metrics?.firstEventAt
		this.state = {
			...this.state,
			seq: ++this.sequence,
			metrics: {
				...this.state.metrics,
				firstRenderedAt: now,
				...(firstEventAt !== undefined ? { firstEventToFirstRenderedMs: Math.max(0, now - firstEventAt) } : {}),
			},
		}
		return true
	}

	waitingForApproval(runId: string, toolName?: string, now = Date.now()): boolean {
		return this.transition(runId, "waitingForApproval", now, { currentToolName: toolName })
	}

	runningTool(runId: string, toolName: string, now = Date.now()): boolean {
		return this.transition(runId, "runningTool", now, { currentToolName: toolName })
	}

	streaming(runId: string, now = Date.now()): boolean {
		return this.transition(runId, "streaming", now, { currentToolName: undefined })
	}

	requestCancellation(runId: string, now = Date.now()): boolean {
		if (!this.isOpen(runId)) return false
		if (this.state.phase === "cancelling") return true
		return this.transition(runId, "cancelling", now, {
			metrics: { ...this.state.metrics, cancellationRequestedAt: now },
		})
	}

	complete(runId: string, now = Date.now()): boolean {
		return this.terminal(runId, "completed", now)
	}

	cancelled(runId: string, now = Date.now()): boolean {
		return this.terminal(runId, "cancelled", now)
	}

	fail(runId: string, failure: AgentRunFailure, now = Date.now()): boolean {
		return this.terminal(runId, "failed", now, { failure })
	}

	reset(now = Date.now()): void {
		this.state = { phase: "idle", seq: ++this.sequence, stageStartedAt: now }
	}

	private terminal(
		runId: string,
		phase: Extract<AgentRunPhase, "completed" | "cancelled" | "failed">,
		now: number,
		extra: Partial<AgentRunState> = {},
	): boolean {
		if (phase === "cancelled" ? !this.isOpen(runId) : !this.isMutable(runId)) return false
		const cancellationRequestedAt = this.state.metrics?.cancellationRequestedAt
		this.state = {
			...this.state,
			...extra,
			phase,
			stageStartedAt: now,
			seq: ++this.sequence,
			currentToolName: undefined,
			metrics: {
				...this.state.metrics,
				terminalAt: now,
				...(cancellationRequestedAt !== undefined
					? { cancellationToTerminalMs: Math.max(0, now - cancellationRequestedAt) }
					: {}),
			},
		}
		return true
	}

	private isMutable(runId: string): boolean {
		return this.isOpen(runId) && this.state.phase !== "cancelling"
	}

	private isOpen(runId: string): boolean {
		return this.isCurrent(runId) && !TERMINAL_PHASES.has(this.state.phase)
	}

	private transition(runId: string, phase: AgentRunPhase, now: number, extra: Partial<AgentRunState>): boolean {
		if (!this.isMutable(runId)) return false
		this.state = {
			...this.state,
			...extra,
			phase,
			stageStartedAt: now,
			seq: ++this.sequence,
		}
		return true
	}
}

function recordFromUnknown(error: unknown): Record<string, unknown> {
	return error && typeof error === "object" ? (error as Record<string, unknown>) : {}
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function optionalNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function sanitizeRunFailure(
	error: unknown,
	source: AgentRunFailureSource,
	options: { retrySafe?: boolean } = {},
): AgentRunFailure {
	const record = recordFromUnknown(error)
	const metadata = recordFromUnknown(record.$metadata)
	const rawMessage = error instanceof Error ? error.message : (optionalString(record.message) ?? String(error))
	const details = redactBedrockDiagnostics(error instanceof Error ? `${error.name}: ${error.message}` : error)
	const code = optionalString(record.code) ?? optionalString(record.name)
	const requestId = optionalString(record.requestId) ?? optionalString(metadata.requestId)
	const httpStatus =
		optionalNumber(record.status) ?? optionalNumber(record.statusCode) ?? optionalNumber(metadata.httpStatusCode)
	const category =
		optionalString(record.category) ??
		(/throttl/i.test(rawMessage)
			? "throttling"
			: /credential|expiredtoken/i.test(rawMessage)
				? "credentials"
				: /accessdenied|unauthoriz|forbidden/i.test(rawMessage)
					? "authorization"
					: /validation|model.*not.*found/i.test(rawMessage)
						? "model-validation"
						: source)

	return {
		source,
		category,
		...(code && code !== "Error" ? { code } : {}),
		...(httpStatus !== undefined ? { httpStatus } : {}),
		...(requestId ? { requestId } : {}),
		message: redactBedrockDiagnostics(rawMessage || "The agent run failed."),
		...(details && details !== rawMessage ? { details } : {}),
		retrySafe: options.retrySafe ?? source === "stream",
	}
}
