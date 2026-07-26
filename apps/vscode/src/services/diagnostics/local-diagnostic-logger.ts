import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Logger } from "@/shared/services/Logger"

const DEFAULT_MAX_BYTES = 512 * 1024
const REDACTED = "[REDACTED]"
const SENSITIVE_KEY =
	/(access.?key|secret|session.?token|authorization|credential|password|cookie|prompt|response|content|diff|payload|command|environment|identity|account|arn)/i
const AWS_ACCESS_KEY = /\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}\b/g
const BEARER_TOKEN = /\b(?:bearer|token)\s+[a-z0-9._~+/=-]{12,}\b/gi
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi

export interface LocalDiagnosticEvent {
	name: string
	category: "extension" | "doctor" | "run" | "bedrock" | "tool" | "history" | "checkpoint" | "team" | "worktree" | "git" | "log"
	level?: "debug" | "info" | "warn" | "error"
	runId?: string
	sessionId?: string
	agentId?: string
	teamTaskId?: string
	stage?: string
	durationMs?: number
	details?: Record<string, unknown>
}

export interface DiagnosticSummaryContext {
	extensionVersion: string
	platform: string
	region?: string
	endpoint?: string
	profile?: string
	targetId?: string
	latestDoctorState?: string
	taskId?: string
	teamTaskId?: string
	worktreePath?: string
	checkpointId?: string
}

export function redactDiagnosticValue(value: unknown, key?: string): unknown {
	if (key && SENSITIVE_KEY.test(key)) {
		return REDACTED
	}
	if (typeof value === "string") {
		return value
			.replace(AWS_ACCESS_KEY, REDACTED)
			.replace(BEARER_TOKEN, REDACTED)
			.replace(EMAIL, REDACTED)
			.replace(/([?&](?:token|signature|credential|key|secret)=)[^&\s]+/gi, `$1${REDACTED}`)
			.replace(/(initTask called:)\s*.*$/i, `$1 ${REDACTED}`)
			.replace(/(\bprompt\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,]+)/gi, `$1${REDACTED}`)
	}
	if (Array.isArray(value)) {
		return value.slice(0, 50).map((item) => redactDiagnosticValue(item))
	}
	if (value && typeof value === "object") {
		const result: Record<string, unknown> = {}
		for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
			result[entryKey] = redactDiagnosticValue(entryValue, entryKey)
		}
		return result
	}
	return value
}

function maskEndpoint(endpoint: string | undefined): string | undefined {
	if (!endpoint) return undefined
	try {
		const url = new URL(endpoint)
		return `${url.protocol}//${url.host}${url.pathname}`
	} catch {
		return String(redactDiagnosticValue(endpoint))
	}
}

function classifyExtensionLog(message: string): Pick<LocalDiagnosticEvent, "name" | "category" | "stage" | "sessionId"> {
	const sessionId = /\bsession(?:Id)?[=:]\s*([a-z0-9._:-]+)/i.exec(message)?.[1]
	const stage = /\[BedrockStartup\]\s+([a-zA-Z]+)/.exec(message)?.[1]
	if (message.includes("[BedrockStartup]")) {
		return { name: "doctor-transition", category: "doctor", stage, sessionId }
	}
	if (/checkpoint/i.test(message)) {
		return { name: "checkpoint-operation", category: "checkpoint", sessionId }
	}
	if (/\b(team|teammate)\b/i.test(message)) {
		return { name: "team-operation", category: "team", sessionId }
	}
	if (/worktree/i.test(message)) {
		return { name: "worktree-operation", category: "worktree", sessionId }
	}
	if (message.includes("[GitCommitMessage]")) {
		return { name: "commit-message-generation", category: "git", sessionId }
	}
	if (/\b(tool|approval)\b/i.test(message)) {
		return { name: "tool-transition", category: "tool", sessionId }
	}
	if (/\b(history|resume|reinit)\b/i.test(message)) {
		return { name: "history-operation", category: "history", sessionId }
	}
	if (/\b(run|turn|session)\b/i.test(message)) {
		return { name: "run-transition", category: "run", sessionId }
	}
	return { name: "extension-log", category: "log", sessionId }
}

export class LocalDiagnosticLogger {
	private static active?: LocalDiagnosticLogger
	readonly logsDirectory: string
	readonly currentPath: string
	readonly previousPath: string
	private writeQueue = Promise.resolve()
	private unsubscribeLogger?: () => void

	constructor(
		storageRoot: string,
		private readonly maxBytes = DEFAULT_MAX_BYTES,
	) {
		this.logsDirectory = join(storageRoot, "logs")
		this.currentPath = join(this.logsDirectory, "current.jsonl")
		this.previousPath = join(this.logsDirectory, "previous.jsonl")
	}

	async initialize(): Promise<void> {
		LocalDiagnosticLogger.active = this
		await mkdir(this.logsDirectory, { recursive: true })
		await writeFile(this.currentPath, "", { flag: "a" })
		this.unsubscribeLogger = Logger.subscribe((message) => {
			const level = /\s(ERROR|WARN)\s/.exec(message)?.[1]
			const classification = classifyExtensionLog(message)
			this.record({
				...classification,
				level: level === "ERROR" ? "error" : level === "WARN" ? "warn" : "info",
				details: { message },
			})
		})
	}

	record(event: LocalDiagnosticEvent): void {
		this.writeQueue = this.writeQueue
			.then(async () => {
				const envelope = redactDiagnosticValue({
					schemaVersion: 1,
					eventId: randomUUID(),
					timestamp: new Date().toISOString(),
					...event,
				})
				const line = `${JSON.stringify(envelope)}\n`
				await this.rotateIfNeeded(Buffer.byteLength(line))
				await writeFile(this.currentPath, line, { flag: "a" })
			})
			.catch(() => {
				// Diagnostic logging must never stop the extension.
			})
	}

	async flush(): Promise<void> {
		await this.writeQueue
	}

	async sanitizedSummary(context: DiagnosticSummaryContext): Promise<string> {
		await this.flush()
		const raw = await readFile(this.currentPath, "utf8").catch(() => "")
		const recentErrors = raw
			.split("\n")
			.filter(Boolean)
			.slice(-200)
			.flatMap((line) => {
				try {
					const parsed = JSON.parse(line) as Record<string, unknown>
					return parsed.level === "error" || parsed.level === "warn"
						? [
								{
									timestamp: parsed.timestamp,
									name: parsed.name,
									category: parsed.category,
									stage: parsed.stage,
									sessionId: parsed.sessionId,
								},
							]
						: []
				} catch {
					return []
				}
			})
			.slice(-20)
		return JSON.stringify(
			redactDiagnosticValue({
				schemaVersion: 1,
				extension: context.extensionVersion,
				platform: context.platform,
				region: context.region,
				endpoint: maskEndpoint(context.endpoint),
				profile: context.profile || "<default-chain>",
				selectedTargetId: context.targetId,
				latestDoctorState: context.latestDoctorState,
				taskId: context.taskId,
				teamTaskId: context.teamTaskId,
				worktreePath: context.worktreePath,
				checkpointId: context.checkpointId,
				recentErrors,
				logPath: this.currentPath,
			}),
			null,
			2,
		)
	}

	async clear(): Promise<void> {
		await this.flush()
		await Promise.all([rm(this.currentPath, { force: true }), rm(this.previousPath, { force: true })])
		await writeFile(this.currentPath, "")
	}

	async dispose(): Promise<void> {
		this.unsubscribeLogger?.()
		this.unsubscribeLogger = undefined
		await this.flush()
		if (LocalDiagnosticLogger.active === this) {
			LocalDiagnosticLogger.active = undefined
		}
	}

	static recordGlobal(event: LocalDiagnosticEvent): void {
		LocalDiagnosticLogger.active?.record(event)
	}

	private async rotateIfNeeded(incomingBytes: number): Promise<void> {
		const currentSize = await stat(this.currentPath)
			.then((value) => value.size)
			.catch(() => 0)
		if (currentSize === 0 || currentSize + incomingBytes <= this.maxBytes) {
			return
		}
		await rm(this.previousPath, { force: true })
		await rename(this.currentPath, this.previousPath)
		await writeFile(this.currentPath, "")
	}
}
