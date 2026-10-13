import { execFile } from "node:child_process"
import { createHmac, randomBytes, randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { isDeepStrictEqual, promisify } from "node:util"
import { type ClineCoreStartInput, captureGitSnapshot, type GitSnapshotProperties, type ITelemetryService } from "@cline/core"
import type { AgentAfterModelContext } from "@cline/shared"
import { workspace } from "vscode"

const execFileAsync = promisify(execFile)

// Never exported or persisted. A telemetry recipient cannot test candidate paths.
// ponytail: IDs rotate on host restart; persist the key only if cross-restart identity is needed.
const workspaceIdKey = randomBytes(32)
type GitSnapshot = GitSnapshotProperties["git"]
type GitRuntimeContext = Pick<GitSnapshotProperties, "runId" | "iteration" | "agentId">

// Unlike prompt metadata, telemetry must also exclude query credentials and local remotes.
export function sanitizeGitRemote(remote: string): string | undefined {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: reject unsafe URL input before parsing
	if (!remote || /[\s\\\x00-\x1f]/.test(remote) || /^[a-z]:/i.test(remote)) return undefined
	try {
		const scp = !remote.includes("://") && remote.match(/^(?:[^@/:]+@)?([^/:]+):([^:].*)$/)
		const url = new URL(scp ? `ssh://${scp[1]}/${scp[2]}` : remote)
		if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol) || !url.hostname) return undefined
		url.username = ""
		url.password = ""
		url.search = ""
		url.hash = ""
		return url.toString()
	} catch {
		return undefined
	}
}

export async function readGitSnapshot(cwd: string): Promise<GitSnapshot> {
	const git = async (args: string[]) =>
		(
			await execFileAsync("git", ["-c", "core.fsmonitor=false", ...args], {
				cwd,
				// Bound background work; read identity separately if status exceeds these limits.
				timeout: 1000,
				maxBuffer: 1024 * 1024,
				windowsHide: true,
				env: { ...process.env, LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
			})
		).stdout
	let status: string | undefined
	let snapshot: GitSnapshot
	try {
		status = await git(["status", "--porcelain=v2", "--branch", "--untracked-files=normal"])
	} catch (error) {
		// Never export stderr: it can contain local paths, remotes, or credentials.
		const failure = error as { stderr?: string; code?: string; killed?: boolean }
		if (failure.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" && !failure.killed) {
			return { state: failure.stderr?.startsWith("fatal: not a git repository") ? "non_git" : "unavailable" }
		}
	}
	if (status === undefined) {
		// Never infer clean/dirty from truncated status. Preserve cheap identity reads.
		const head = await git(["rev-parse", "--verify", "HEAD"]).catch(() => undefined)
		const branch = await git(["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => undefined)
		if (!head && !branch) return { state: "unavailable" }
		snapshot = { state: "partial", ...(head ? { head_sha: head.trim() } : {}), ...(branch ? { branch: branch.trim() } : {}) }
	} else {
		const lines = status.split("\n")
		const head = lines.find((line) => line.startsWith("# branch.oid "))?.slice(13)
		const branch = lines.find((line) => line.startsWith("# branch.head "))?.slice(14)
		if (!head) return { state: "unavailable" }
		snapshot = {
			state: head === "(initial)" ? "unborn" : "ok",
			...(head !== "(initial)" ? { head_sha: head } : {}),
			...(branch && branch !== "(detached)" ? { branch } : {}),
			dirty: lines.some((line) => /^[12u?] /.test(line)),
			// Porcelain v2's XY columns: index, then worktree; unmerged entries set both.
			staged: lines.some((line) => /^[12u] [^.]/.test(line)),
			unstaged: lines.some((line) => /^[12u] .[^.]/.test(line)),
			untracked: lines.some((line) => line.startsWith("? ")),
		}
	}
	try {
		const remotes = (await git(["remote", "-v"]))
			.split("\n")
			.map((line) => line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/))
			.filter((match) => match !== null)
		const remote = remotes.find((match) => match[1] === "origin") ?? remotes[0]
		const url = remote && sanitizeGitRemote(remote[2])
		snapshot.remote_state = !remote ? "none" : url ? "ok" : "unsupported"
		if (url) snapshot.remote_url = url
	} catch {
		snapshot.remote_state = "unavailable"
	}
	return snapshot
}

/** Owns Git observers for the sessions sharing a VS Code host. */
export class VscodeGitTelemetryManager {
	private disposed = false
	private readonly observers = new Map<string, VscodeGitTelemetry>()

	constructor(private readonly telemetry: ITelemetryService | undefined) {}

	/** Attach hooks to a freshly prepared input, not the caller's original input. */
	init(input: ClineCoreStartInput): VscodeGitTelemetry | undefined {
		if (this.disposed) return
		const { config } = input
		if (!config.cwd || (config.providerId !== "cline" && config.providerId !== "cline-pass") || !this.telemetry) return
		// Use host consent, not an organization telemetry override.
		const observer = new VscodeGitTelemetry({ ...config, cwd: config.cwd }, this.telemetry)
		input.config = observer.configure()
		// Core merges localRuntime hooks back into config during start.
		input.localRuntime = { ...input.localRuntime, hooks: input.config.hooks }
		return observer
	}

	start(sessionId: string, observer: VscodeGitTelemetry | undefined): void {
		if (!observer) return
		if (this.disposed) {
			observer.dispose()
			return
		}
		this.stop(sessionId)
		observer.open(sessionId)
		if (observer.hasOpened) this.observers.set(sessionId, observer)
	}

	stop(sessionId: string): void {
		this.observers.get(sessionId)?.dispose()
		this.observers.delete(sessionId)
	}

	dispose(): void {
		this.disposed = true
		for (const observer of this.observers.values()) observer.dispose()
		this.observers.clear()
	}
}

/** One observation window for one task's fixed starting directory, never the shell's cwd. */
export class VscodeGitTelemetry {
	private disposed = false
	private agentId?: string
	private capturing = false
	private sequence = 0
	private lastEmittedState?: { git: GitSnapshot; workspaceRootCount: number }
	private readonly windowId = randomUUID()
	private identity?: { sessionId: string; workspaceId: string }

	constructor(
		private readonly config: ClineCoreStartInput["config"] & { cwd: string },
		private readonly telemetry: ITelemetryService,
	) {}

	get sessionId(): string | undefined {
		return this.identity?.sessionId
	}

	configure(): ClineCoreStartInput["config"] {
		const config = this.config
		const { afterModel } = config.hooks ?? {}
		return {
			...config,
			hooks: {
				...config.hooks,
				afterModel: (context) => {
					void this.afterModel(context)
					return afterModel?.(context)
				},
			},
		}
	}

	get hasOpened(): boolean {
		return this.identity !== undefined
	}

	open(sessionId: string): void {
		// VS Code starts interactively, then sends prompts after Core returns its ID.
		if (this.disposed || this.identity) return
		this.identity = {
			sessionId,
			workspaceId: createHmac("sha256", workspaceIdKey)
				.update(`${sessionId}\0${resolve(this.config.cwd)}`)
				.digest("hex"),
		}
	}

	private enabled(): boolean {
		try {
			return !this.disposed && this.identity !== undefined && this.telemetry.isEnabled()
		} catch {
			return false // A broken telemetry adapter must not interrupt inference.
		}
	}

	private async snapshot(runtimeContext: GitRuntimeContext) {
		if (!this.enabled()) return undefined
		const sequence = ++this.sequence
		const observedAt = new Date().toISOString()
		const workspaceRootCount = workspace.workspaceFolders?.length ?? 0
		const context = { ...runtimeContext }
		const git = await readGitSnapshot(this.config.cwd)
		if (!this.enabled()) return undefined
		return { git, sequence, observedAt, workspaceRootCount, context }
	}

	private emit(snapshot: NonNullable<Awaited<ReturnType<VscodeGitTelemetry["snapshot"]>>>, requestId?: string) {
		const identity = this.identity
		if (!this.enabled() || !identity) return
		// Emit the first state, then changes only. Request IDs are not state;
		// consumers must carry observations forward within this observation window.
		const state = { git: snapshot.git, workspaceRootCount: snapshot.workspaceRootCount }
		if (isDeepStrictEqual(state, this.lastEmittedState)) return
		try {
			captureGitSnapshot(this.telemetry, {
				schema_version: 1,
				sessionId: identity.sessionId,
				ulid: identity.sessionId,
				providerId: this.config.providerId,
				workspace_id: identity.workspaceId,
				workspace_root_count: snapshot.workspaceRootCount,
				observation_window_id: this.windowId,
				observation_sequence: snapshot.sequence,
				observed_at: snapshot.observedAt,
				boundary: "model_call",
				...snapshot.context,
				git: snapshot.git,
				...(requestId ? { request_id: requestId } : {}),
				request_id_status: requestId ? "present" : "missing",
			})
			this.lastEmittedState = state
		} catch {
			// Telemetry must not interrupt inference or Git operations.
		}
	}

	private async afterModel({ snapshot: { runId, iteration, agentId }, requestId: rawId }: AgentAfterModelContext) {
		// The root model responds before it can spawn children that inherit these hooks.
		this.agentId ??= agentId
		if (agentId !== this.agentId || !this.enabled() || this.capturing) return
		// ponytail: skip overlapping captures; queue only if every response needs a sample.
		this.capturing = true
		try {
			// Tools may execute while this background read is in progress.
			const snapshot = await this.snapshot({ runId, iteration, agentId })
			const id = rawId?.trim()
			const requestId = id && /^[\w-]{1,128}$/.test(id) ? id : undefined
			if (snapshot) this.emit(snapshot, requestId)
		} catch {
			// Telemetry must not interrupt the agent or existing hooks.
		} finally {
			this.capturing = false
		}
	}

	dispose(): void {
		this.disposed = true
	}
}
