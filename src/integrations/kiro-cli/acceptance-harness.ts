import fs from "node:fs/promises"
import { runKiroCli } from "./run"

export type KiroCliAcceptanceStatus = "passed" | "failed"
export type KiroCliAcceptanceFailureType =
	| "spawn_failed"
	| "process_error"
	| "non_zero_exit"
	| "timeout"
	| "cancelled"
	| "unknown"

export type KiroCliAcceptanceRequest = {
	sessionId: string
	path?: string
	cwd: string
	env?: NodeJS.ProcessEnv
	timeoutMs?: number
	systemPrompt?: string
	userPrompt?: string
	outputFilePath?: string
}

export type KiroCliAcceptanceResult = {
	sessionId: string
	status: KiroCliAcceptanceStatus
	cwd: string
	envMarker?: string
	command: string
	durationMs: number
	outputText: string
	outputFilePath?: string
	failureType?: KiroCliAcceptanceFailureType
	errorMessage?: string
}

type AcceptanceExecutor = (request: KiroCliAcceptanceRequest) => AsyncIterable<string>

const DEFAULT_SYSTEM_PROMPT = "Answer briefly and plainly."
const DEFAULT_USER_PROMPT = "Reply with the single word READY."

const normalizeFailureType = (error: unknown): KiroCliAcceptanceFailureType => {
	if (!(error instanceof Error)) {
		return "unknown"
	}

	if ("failureType" in error && typeof error.failureType === "string") {
		if (error.failureType === "spawn_failed" || error.failureType === "process_error" || error.failureType === "non_zero_exit") {
			return error.failureType
		}
	}

	const lowerMessage = error.message.toLowerCase()
	if (lowerMessage.includes("timed out") || lowerMessage.includes("timeout")) {
		return "timeout"
	}

	if (lowerMessage.includes("cancel")) {
		return "cancelled"
	}

	return "unknown"
}

const defaultExecutor: AcceptanceExecutor = (request) =>
	runKiroCli({
		systemPrompt: request.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
		messages: [{ role: "user", content: request.userPrompt ?? DEFAULT_USER_PROMPT } as any],
		path: request.path,
		cwd: request.cwd,
		env: request.env,
		timeoutMs: request.timeoutMs,
	})

export const runKiroCliAcceptance = async (
	request: KiroCliAcceptanceRequest,
	executor: AcceptanceExecutor = defaultExecutor,
): Promise<KiroCliAcceptanceResult> => {
	const startedAt = Date.now()
	const chunks: string[] = []

	try {
		for await (const chunk of executor(request)) {
			chunks.push(chunk)
		}

		const outputText = chunks.join("")
		if (request.outputFilePath) {
			await fs.writeFile(request.outputFilePath, outputText, "utf8")
		}

		return {
			sessionId: request.sessionId,
			status: "passed",
			cwd: request.cwd,
			envMarker: request.env?.CLINE_RUNTIME_SESSION_ID,
			command: request.path?.trim() || "kiro-cli",
			durationMs: Date.now() - startedAt,
			outputText,
			outputFilePath: request.outputFilePath,
		}
	} catch (error) {
		const outputText = chunks.join("")
		if (request.outputFilePath) {
			await fs.writeFile(request.outputFilePath, outputText, "utf8")
		}

		return {
			sessionId: request.sessionId,
			status: "failed",
			cwd: request.cwd,
			envMarker: request.env?.CLINE_RUNTIME_SESSION_ID,
			command: request.path?.trim() || "kiro-cli",
			durationMs: Date.now() - startedAt,
			outputText,
			outputFilePath: request.outputFilePath,
			failureType: normalizeFailureType(error),
			errorMessage: error instanceof Error ? error.message : String(error),
		}
	}
}
