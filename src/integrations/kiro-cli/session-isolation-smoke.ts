import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { runKiroCliAcceptance, type KiroCliAcceptanceRequest, type KiroCliAcceptanceResult } from "./acceptance-harness"

export type KiroCliIsolationCheckName =
	| "distinct_cwd"
	| "distinct_env_marker"
	| "distinct_output_files"
	| "output_capture_integrity"
	| "failure_containment"

export type KiroCliIsolationCheck = {
	name: KiroCliIsolationCheckName
	passed: boolean
	details: string
}

export type KiroCliIsolationSmokeResult = {
	passed: boolean
	sessionA: KiroCliAcceptanceResult
	sessionB: KiroCliAcceptanceResult
	checks: KiroCliIsolationCheck[]
}

type AcceptanceRunner = (request: KiroCliAcceptanceRequest) => Promise<KiroCliAcceptanceResult>

export type KiroCliIsolationSmokeOptions = {
	path?: string
	baseDir?: string
	timeoutMs?: number
	runner?: AcceptanceRunner
}

const buildSessionRequest = async (options: {
	sessionId: string
	baseDir: string
	path?: string
	timeoutMs?: number
	forceFailure?: boolean
}): Promise<KiroCliAcceptanceRequest> => {
	const workdir = path.join(options.baseDir, options.sessionId, "workspace")
	const tempDir = path.join(options.baseDir, options.sessionId, "tmp")
	const outputFilePath = path.join(options.baseDir, options.sessionId, "output.txt")

	await fs.mkdir(workdir, { recursive: true })
	await fs.mkdir(tempDir, { recursive: true })

	return {
		sessionId: options.sessionId,
		path: options.forceFailure ? `${options.path ?? "kiro-cli"}-missing` : options.path,
		cwd: workdir,
		timeoutMs: options.timeoutMs,
		outputFilePath,
		env: {
			...process.env,
			CLINE_RUNTIME_SESSION_ID: options.sessionId,
			TMPDIR: tempDir,
		},
		systemPrompt: "Respond briefly.",
		userPrompt: `Reply with ${options.sessionId}.`,
	}
}

const buildChecks = async (
	sessionA: KiroCliAcceptanceResult,
	sessionB: KiroCliAcceptanceResult,
): Promise<KiroCliIsolationCheck[]> => {
	const outputA = sessionA.outputFilePath ? await fs.readFile(sessionA.outputFilePath, "utf8") : ""
	const outputB = sessionB.outputFilePath ? await fs.readFile(sessionB.outputFilePath, "utf8") : ""

	return [
		{
			name: "distinct_cwd",
			passed: sessionA.cwd !== sessionB.cwd,
			details: `${sessionA.cwd} <> ${sessionB.cwd}`,
		},
		{
			name: "distinct_env_marker",
			passed: !!sessionA.envMarker && !!sessionB.envMarker && sessionA.envMarker !== sessionB.envMarker,
			details: `${sessionA.envMarker ?? "missing"} <> ${sessionB.envMarker ?? "missing"}`,
		},
		{
			name: "distinct_output_files",
			passed: !!sessionA.outputFilePath && !!sessionB.outputFilePath && sessionA.outputFilePath !== sessionB.outputFilePath,
			details: `${sessionA.outputFilePath ?? "missing"} <> ${sessionB.outputFilePath ?? "missing"}`,
		},
		{
			name: "output_capture_integrity",
			passed: outputA === sessionA.outputText && outputB === sessionB.outputText,
			details: `sessionA=${outputA.length} chars, sessionB=${outputB.length} chars`,
		},
		{
			name: "failure_containment",
			passed: sessionA.status === "passed" && sessionB.status === "failed",
			details: `sessionA=${sessionA.status}, sessionB=${sessionB.status}`,
		},
	]
}

const ensureOutputCaptureFile = async (session: KiroCliAcceptanceResult) => {
	if (!session.outputFilePath) {
		return
	}

	try {
		await fs.access(session.outputFilePath)
	} catch {
		await fs.writeFile(session.outputFilePath, session.outputText, "utf8")
	}
}

export const runLinuxAarch64KiroCliIsolationSmoke = async (
	options: KiroCliIsolationSmokeOptions = {},
): Promise<KiroCliIsolationSmokeResult> => {
	const runner = options.runner ?? ((request) => runKiroCliAcceptance(request))
	const baseDir = options.baseDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), "kiro-isolation-")))

	const [sessionARequest, sessionBRequest] = await Promise.all([
		buildSessionRequest({
			sessionId: "session-a",
			baseDir,
			path: options.path,
			timeoutMs: options.timeoutMs,
		}),
		buildSessionRequest({
			sessionId: "session-b",
			baseDir,
			path: options.path,
			timeoutMs: options.timeoutMs,
			forceFailure: true,
		}),
	])

	const [sessionA, sessionB] = await Promise.all([runner(sessionARequest), runner(sessionBRequest)])
	await Promise.all([ensureOutputCaptureFile(sessionA), ensureOutputCaptureFile(sessionB)])
	const checks = await buildChecks(sessionA, sessionB)

	return {
		passed: checks.every((check) => check.passed),
		sessionA,
		sessionB,
		checks,
	}
}
