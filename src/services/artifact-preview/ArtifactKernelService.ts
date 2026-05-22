import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import * as readline from "node:readline"
import * as vscode from "vscode"
import { type CellProvenanceRecord, hashCode, mapResultStatus, writeCellProvenance } from "./artifactProvenance"
import {
	discoverPythonEnvironments,
	getWorkspaceFolderPath,
	getWorkspaceKey,
	resolveDefaultProfile,
} from "./discoverPythonEnvironments"
import type { KernelProfile } from "./KernelProfile"
import { buildSessionKeyForArtifact } from "./kernelSessionKey"

export type ArtifactKernelState = "stopped" | "starting" | "ready" | "busy" | "error"

export interface ArtifactKernelInfo {
	artifactId: string
	profileId: string
	label: string
	interpreterPath: string
	state: ArtifactKernelState
	cwd: string
	lastError: string
	pythonVersion: string
	packagesProbe: string
	kernelDirty: boolean
	executionCount: number
}

export interface RunArtifactCodeResult {
	stdout: string
	stderr: string
	status: "ok" | "error" | "denied" | "timeout" | "interrupted"
	error: string
	resultRepr: string
	imagesPngBase64: string[]
	truncated: boolean
	provenanceId?: string
}

interface KernelSession {
	sessionKey: string
	artifactId: string
	profile: KernelProfile
	process: ChildProcessWithoutNullStreams
	rl: readline.Interface
	state: ArtifactKernelState
	lastError: string
	pythonVersion: string
	executionsSinceRestart: number
	pending: Map<
		string,
		{
			resolve: (r: RunArtifactCodeResult) => void
			reject: (e: Error) => void
			timer: NodeJS.Timeout
		}
	>
	nextId: number
}

function getTimeoutMs(): number {
	const seconds = vscode.workspace.getConfiguration("aihydro.htmlPreview").get<number>("pythonTimeoutSeconds", 120)
	const clamped = Math.min(600, Math.max(30, seconds))
	return clamped * 1000
}

const MAX_OUTPUT_CHARS = 50_000
const INTERRUPT_RECOVERY_MS = 5_000

const PROBE_CODE = `import json, sys
pkgs = ["numpy", "pandas", "rasterio", "matplotlib"]
missing = []
for p in pkgs:
    try:
        __import__(p)
    except ImportError:
        missing.append(p)
print(json.dumps({"ok": missing == [], "missing": missing, "python": sys.version}))`

function getRunnerScriptPath(extensionPath: string): string {
	return path.join(extensionPath, "dist", "services", "artifact-preview", "artifact_kernel_runner.py")
}

function truncateOutput(text: string): { text: string; truncated: boolean } {
	if (text.length <= MAX_OUTPUT_CHARS) {
		return { text, truncated: false }
	}
	return { text: `${text.slice(0, MAX_OUTPUT_CHARS)}\n… [truncated]`, truncated: true }
}

export class ArtifactKernelService {
	private readonly sessions = new Map<string, KernelSession>()
	private readonly activeProfileByWorkspace = new Map<string, string>()
	private readonly outputChannel = vscode.window.createOutputChannel("AI-Hydro HTML Preview")

	constructor(private readonly context: vscode.ExtensionContext) {}

	private profileStateKey(workspaceKey: string): string {
		return `aihydro.htmlPreview.activeProfile.${workspaceKey}`
	}

	private loadPersistedProfile(workspaceKey: string): string {
		return this.context.globalState.get<string>(this.profileStateKey(workspaceKey)) ?? ""
	}

	private persistActiveProfile(workspaceKey: string, profileId: string): void {
		void this.context.globalState.update(this.profileStateKey(workspaceKey), profileId)
	}

	dispose(): void {
		for (const key of [...this.sessions.keys()]) {
			this.stopKernel(key)
		}
	}

	async listEnvironments(): Promise<{ environments: KernelProfile[]; activeProfileId: string }> {
		const environments = await discoverPythonEnvironments()
		const workspaceKey = getWorkspaceKey()
		let activeProfileId = this.activeProfileByWorkspace.get(workspaceKey) ?? this.loadPersistedProfile(workspaceKey)
		if (!activeProfileId || !environments.some((e) => e.id === activeProfileId)) {
			const defaultProfile = await resolveDefaultProfile()
			activeProfileId = defaultProfile?.id ?? environments[0]?.id ?? ""
			if (activeProfileId) {
				this.activeProfileByWorkspace.set(workspaceKey, activeProfileId)
				this.persistActiveProfile(workspaceKey, activeProfileId)
			}
		}
		return { environments, activeProfileId }
	}

	setActiveProfile(profileId: string): void {
		const workspaceKey = getWorkspaceKey()
		this.activeProfileByWorkspace.set(workspaceKey, profileId)
		this.persistActiveProfile(workspaceKey, profileId)
	}

	getActiveProfileId(): string {
		return this.activeProfileByWorkspace.get(getWorkspaceKey()) ?? ""
	}

	async resolveProfile(profileId?: string): Promise<KernelProfile> {
		const { environments, activeProfileId } = await this.listEnvironments()
		const id = profileId?.trim() || activeProfileId
		const found = environments.find((e) => e.id === id)
		if (found) {
			return found
		}
		const fallback = await resolveDefaultProfile()
		if (!fallback) {
			throw new Error(
				"No Python interpreter found. Set aihydro.htmlPreview.pythonInterpreter, select a VS Code interpreter, or create .aihydro/venv in the workspace.",
			)
		}
		this.setActiveProfile(fallback.id)
		return fallback
	}

	private resolveSessionKey(artifactId: string, profileId?: string): string {
		const aid = artifactId.trim()
		if (!aid) {
			throw new Error("artifact_id is required for kernel operations")
		}
		const profile = profileId?.trim() || this.getActiveProfileId()
		if (!profile) {
			throw new Error("No active Python profile. Select a kernel in the HTML Preview toolbar.")
		}
		return buildSessionKeyForArtifact(aid, profile)
	}

	getInfo(artifactId: string, profileId?: string): ArtifactKernelInfo | null {
		const aid = artifactId.trim()
		if (!aid) {
			return null
		}
		const pid = profileId?.trim() || this.getActiveProfileId()
		const sessionKey = pid ? buildSessionKeyForArtifact(aid, pid) : ""
		const session = sessionKey ? this.sessions.get(sessionKey) : undefined
		if (session) {
			return this.sessionToInfo(session)
		}
		return null
	}

	getInfoOrDefault(artifactId: string, profileId?: string): Promise<ArtifactKernelInfo> {
		const existing = this.getInfo(artifactId, profileId)
		if (existing) {
			return Promise.resolve(existing)
		}
		return this.resolveProfile(profileId).then((profile) => ({
			artifactId: artifactId.trim(),
			profileId: profile.id,
			label: profile.label,
			interpreterPath: profile.interpreterPath,
			state: "stopped" as const,
			cwd: profile.cwd,
			lastError: "",
			pythonVersion: "",
			packagesProbe: "",
			kernelDirty: false,
			executionCount: 0,
		}))
	}

	restartKernel(artifactId: string, profileId?: string): void {
		const sessionKey = this.resolveSessionKey(artifactId, profileId)
		this.stopKernel(sessionKey)
	}

	stopSessionsForArtifact(artifactId: string): void {
		const aid = artifactId.trim()
		for (const [key, session] of this.sessions) {
			if (session.artifactId === aid) {
				this.stopKernel(key)
			}
		}
	}

	stopKernel(sessionKey: string): void {
		const session = this.sessions.get(sessionKey)
		if (!session) {
			return
		}
		for (const pending of session.pending.values()) {
			clearTimeout(pending.timer)
			pending.reject(new Error("Kernel stopped"))
		}
		session.pending.clear()
		session.rl.close()
		try {
			session.process.kill()
		} catch {
			// ignore
		}
		this.sessions.delete(sessionKey)
	}

	async interruptKernel(artifactId: string, profileId?: string): Promise<{ recovered: boolean; error?: string }> {
		const sessionKey = this.resolveSessionKey(artifactId, profileId)
		const session = this.sessions.get(sessionKey)
		if (!session || session.state !== "busy") {
			return { recovered: true }
		}

		for (const [id, pending] of session.pending) {
			clearTimeout(pending.timer)
			pending.resolve({
				stdout: "",
				stderr: "",
				status: "interrupted",
				error: "Interrupted by user",
				resultRepr: "",
				imagesPngBase64: [],
				truncated: false,
			})
			session.pending.delete(id)
		}

		try {
			session.process.kill("SIGINT")
		} catch {
			// ignore
		}

		try {
			await this.sendOp(session, { op: "ping", id: "interrupt_ping" })
			session.state = "ready"
			return { recovered: true }
		} catch {
			await new Promise((r) => setTimeout(r, INTERRUPT_RECOVERY_MS))
			try {
				await this.sendOp(session, { op: "ping", id: "interrupt_ping_retry" })
				session.state = "ready"
				return { recovered: true }
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error)
				session.state = "error"
				session.lastError = msg
				return { recovered: false, error: msg }
			}
		}
	}

	async execute(
		code: string,
		artifactId: string,
		profileId?: string,
		timeoutMs?: number,
		cellId?: string,
	): Promise<RunArtifactCodeResult> {
		const profile = await this.resolveProfile(profileId)
		const session = await this.ensureSession(artifactId, profile)
		const id = `exec_${session.nextId++}`
		const effectiveTimeout = timeoutMs ?? getTimeoutMs()
		const startedAt = new Date().toISOString()
		const startMs = Date.now()

		this.outputChannel.appendLine(
			`[${profile.label}][${artifactId}] Executing Python (${code.split("\n").length} lines) cwd=${session.profile.cwd}`,
		)

		const result = await new Promise<RunArtifactCodeResult>((resolve, reject) => {
			const timer = setTimeout(() => {
				session.pending.delete(id)
				session.state = "error"
				session.lastError = "Execution timed out"
				try {
					session.process.kill("SIGINT")
				} catch {
					// ignore
				}
				resolve({
					stdout: "",
					stderr: "",
					status: "timeout",
					error: `Execution timed out after ${effectiveTimeout / 1000}s`,
					resultRepr: "",
					imagesPngBase64: [],
					truncated: false,
				})
			}, effectiveTimeout)

			session.pending.set(id, { resolve, reject, timer })
			session.state = "busy"
			const payload = `${JSON.stringify({ op: "exec", id, code })}\n`
			session.process.stdin.write(payload, (err) => {
				if (err) {
					clearTimeout(timer)
					session.pending.delete(id)
					reject(err)
				}
			})
		})

		if (result.status === "ok") {
			session.executionsSinceRestart++
		}

		const durationMs = Date.now() - startMs
		const provenanceId = await writeCellProvenance(getWorkspaceFolderPath(), {
			artifactId,
			cellId: cellId?.trim() || "legacy",
			codeHash: hashCode(code),
			pythonExecutable: profile.interpreterPath,
			pythonVersion: session.pythonVersion,
			cwd: profile.cwd,
			profileId: profile.id,
			startedAt,
			durationMs,
			status: mapResultStatus(result),
		} satisfies CellProvenanceRecord)

		return { ...result, provenanceId }
	}

	async probeEnvironment(artifactId: string, profileId?: string): Promise<RunArtifactCodeResult> {
		return this.execute(PROBE_CODE, artifactId, profileId, 30_000, "probe")
	}

	private sessionToInfo(session: KernelSession): ArtifactKernelInfo {
		return {
			artifactId: session.artifactId,
			profileId: session.profile.id,
			label: session.profile.label,
			interpreterPath: session.profile.interpreterPath,
			state: session.state,
			cwd: session.profile.cwd,
			lastError: session.lastError,
			pythonVersion: session.pythonVersion,
			packagesProbe: "",
			kernelDirty: session.executionsSinceRestart > 0,
			executionCount: session.executionsSinceRestart,
		}
	}

	private async ensureSession(artifactId: string, profile: KernelProfile): Promise<KernelSession> {
		const sessionKey = buildSessionKeyForArtifact(artifactId, profile.id)
		const existing = this.sessions.get(sessionKey)
		if (existing && existing.state !== "error") {
			return existing
		}
		if (existing) {
			this.stopKernel(sessionKey)
		}

		const runnerPath = getRunnerScriptPath(this.context.extensionPath)
		if (!fs.existsSync(runnerPath)) {
			throw new Error(`Extension bundle missing artifact_kernel_runner.py at ${runnerPath}. Reinstall the AI-Hydro VSIX.`)
		}

		const session: KernelSession = {
			sessionKey,
			artifactId,
			profile,
			process: undefined as unknown as ChildProcessWithoutNullStreams,
			rl: undefined as unknown as readline.Interface,
			state: "starting",
			lastError: "",
			pythonVersion: "",
			executionsSinceRestart: 0,
			pending: new Map(),
			nextId: 1,
		}

		const env = { ...process.env, PYTHONUNBUFFERED: "1", ...profile.env }
		const child = spawn(profile.interpreterPath, [runnerPath], {
			cwd: profile.cwd,
			env,
			stdio: ["pipe", "pipe", "pipe"],
		})

		session.process = child
		session.rl = readline.createInterface({ input: child.stdout })

		child.stderr.on("data", (chunk: Buffer) => {
			const text = chunk.toString()
			session.lastError = text.trim()
			this.outputChannel.appendLine(`[kernel ${profile.label} stderr] ${text.trim()}`)
		})

		child.on("exit", (code) => {
			session.state = "error"
			session.lastError = `Kernel exited with code ${code ?? "unknown"}`
			for (const pending of session.pending.values()) {
				clearTimeout(pending.timer)
				pending.resolve({
					stdout: "",
					stderr: session.lastError,
					status: "error",
					error: session.lastError,
					resultRepr: "",
					imagesPngBase64: [],
					truncated: false,
				})
			}
			session.pending.clear()
			this.sessions.delete(sessionKey)
		})

		session.rl.on("line", (line) => {
			this.handleKernelLine(session, line)
		})

		this.sessions.set(sessionKey, session)

		try {
			const pingResult = await this.sendOp(session, { op: "ping", id: "ping" })
			session.state = "ready"
			const versionResult = await this.sendOp(session, {
				op: "exec",
				id: "version",
				code: "import sys\nprint(sys.version)",
			})
			session.pythonVersion = versionResult.stdout.trim().split("\n")[0] ?? ""
			this.outputChannel.appendLine(
				`[${profile.label}][${artifactId}] Kernel ready: ${profile.interpreterPath} (cwd=${profile.cwd})`,
			)
			if (pingResult.status !== "ok") {
				throw new Error(session.lastError || pingResult.error || "Kernel ping failed")
			}
			return session
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error)
			const detail = session.lastError ? `${msg}\n${session.lastError}` : msg
			this.stopKernel(sessionKey)
			throw new Error(detail)
		}
	}

	private handleKernelLine(session: KernelSession, line: string): void {
		let parsed: {
			id?: string
			stdout?: string
			stderr?: string
			error?: string
			status?: string
			result_repr?: string
			images_png_base64?: string[]
		}
		try {
			parsed = JSON.parse(line) as typeof parsed
		} catch {
			session.lastError = `Invalid kernel response: ${line.slice(0, 200)}`
			return
		}

		const id = parsed.id ?? ""
		const pending = session.pending.get(id)
		if (!pending) {
			return
		}

		clearTimeout(pending.timer)
		session.pending.delete(id)
		session.state = "ready"

		const rawStatus = parsed.status ?? "error"
		const status = rawStatus === "ok" ? "ok" : rawStatus === "interrupted" ? "interrupted" : "error"
		const outStdout = truncateOutput(parsed.stdout ?? "")
		const outStderr = truncateOutput(parsed.stderr ?? "")
		pending.resolve({
			stdout: outStdout.text,
			stderr: outStderr.text,
			status,
			error: parsed.error ?? "",
			resultRepr: parsed.result_repr ?? "",
			imagesPngBase64: Array.isArray(parsed.images_png_base64) ? parsed.images_png_base64 : [],
			truncated: outStdout.truncated || outStderr.truncated,
		})
	}

	private sendOp(session: KernelSession, op: Record<string, string>): Promise<RunArtifactCodeResult> {
		const id = op.id ?? `op_${session.nextId++}`
		return new Promise<RunArtifactCodeResult>((resolve, reject) => {
			const timer = setTimeout(() => {
				session.pending.delete(id)
				const detail = session.lastError
					? `Kernel operation timed out: ${session.lastError}`
					: "Kernel operation timed out"
				reject(new Error(detail))
			}, 15_000)

			session.pending.set(id, { resolve, reject, timer })

			const payload = `${JSON.stringify({ ...op, id })}\n`
			session.process.stdin.write(payload, (err) => {
				if (err) {
					clearTimeout(timer)
					session.pending.delete(id)
					reject(err)
				}
			})
		})
	}
}
