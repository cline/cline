import { execFile } from "node:child_process"
import { createHmac, randomBytes, randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { setImmediate } from "node:timers/promises"
import { promisify } from "node:util"
import { type ClineCoreStartInput, captureGitSnapshot, type GitSnapshotProperties, type ITelemetryService } from "@cline/core"
import type { AgentAfterModelContext, AgentRuntimeEvent, AgentRuntimeStateSnapshot } from "@cline/shared"
import type { Disposable, Event, Uri } from "vscode"

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
				// ponytail: cap each read at 1s/1MiB; split HEAD from status if large repos need better coverage.
				timeout: 1000,
				maxBuffer: 1024 * 1024,
				windowsHide: true,
				env: { ...process.env, LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
			})
		).stdout
	let status: string
	try {
		status = await git(["status", "--porcelain=v2", "--branch", "--untracked-files=normal"])
	} catch (error) {
		// Never export stderr: it can contain local paths, remotes, or credentials.
		const stderr = (error as { stderr?: string }).stderr ?? ""
		return { state: stderr.startsWith("fatal: not a git repository") ? "non_git" : "unavailable" }
	}
	const lines = status.split("\n")
	const head = lines.find((line) => line.startsWith("# branch.oid "))?.slice(13)
	const branch = lines.find((line) => line.startsWith("# branch.head "))?.slice(14)
	if (!head) return { state: "unavailable" }
	const snapshot: GitSnapshot = {
		state: head === "(initial)" ? "unborn" : "ok",
		...(head !== "(initial)" ? { head_sha: head } : {}),
		...(branch && branch !== "(detached)" ? { branch } : {}),
		dirty: lines.some((line) => /^[12u?] /.test(line)),
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

interface GitRepository {
	state: { HEAD?: { commit?: string }; onDidChange: Event<void> }
}
interface GitApi {
	getRepository(uri: Uri): GitRepository | null
	onDidOpenRepository: Event<GitRepository>
}

/** One observation window for one task's fixed starting directory, never the shell's cwd. */
export class VscodeGitTelemetry {
	private disposed = false
	private opened = false
	private running = false
	private agentId?: string
	private sequence = 0
	private lastHead?: string
	private lastHeadSequence = 0
	private lastRequestId?: string
	private readonly pendingModels = new Map<string, ReturnType<VscodeGitTelemetry["snapshot"]>>()
	private context: GitRuntimeContext = {}
	private readonly subscriptions: Disposable[] = []
	private repositorySubscription?: Disposable
	private readonly windowId = randomUUID()
	private readonly workspaceId: string

	constructor(
		private readonly config: ClineCoreStartInput["config"] & { sessionId: string; cwd: string },
		private readonly telemetry: ITelemetryService,
	) {
		// Task-scoped identity separates worktrees without exporting an absolute path.
		this.workspaceId = createHmac("sha256", workspaceIdKey)
			.update(`${config.sessionId}\0${resolve(config.cwd)}`)
			.digest("hex")
	}

	configure(): ClineCoreStartInput["config"] {
		const config = this.config
		const { beforeModel, afterModel, onEvent } = config.hooks ?? {}
		return {
			...config,
			hooks: {
				...config.hooks,
				beforeModel: async (context) => {
					const control = await beforeModel?.(context)
					if (!control?.stop) this.beforeModel(context.snapshot)
					return control
				},
				afterModel: (context) => {
					this.afterModel(context)
					return afterModel?.(context)
				},
				onEvent: async (event) => {
					this.onEvent(event)
					await onEvent?.(event)
				},
			},
		}
	}

	get hasOpened(): boolean {
		return this.opened
	}

	async open(): Promise<void> {
		this.opened = true
		await this.capture("chat_open")
		if (!this.disposed) void this.watchGit()
	}

	private enabled(): boolean {
		return !this.disposed && this.telemetry.isEnabled()
	}

	private async snapshot(runtimeContext: GitRuntimeContext = this.context) {
		if (!this.enabled()) return undefined
		const sequence = ++this.sequence
		const observedAt = new Date().toISOString()
		const context = { ...runtimeContext }
		const git = await readGitSnapshot(this.config.cwd)
		if (!this.enabled()) return undefined
		const headChanged = sequence > this.lastHeadSequence && git.state !== "unavailable" && git.head_sha !== this.lastHead
		if (sequence > this.lastHeadSequence && git.state !== "unavailable") {
			this.lastHeadSequence = sequence
			this.lastHead = git.head_sha
		}
		return { git, sequence, observedAt, context, headChanged }
	}

	private emit(
		snapshot: NonNullable<Awaited<ReturnType<VscodeGitTelemetry["snapshot"]>>>,
		boundary: GitSnapshotProperties["boundary"],
		extra: Pick<GitSnapshotProperties, "request_id" | "request_id_status" | "preceding_request_id"> = {},
	) {
		if (!this.enabled()) return
		try {
			captureGitSnapshot(this.telemetry, {
				schema_version: 1,
				sessionId: this.config.sessionId,
				ulid: this.config.sessionId,
				providerId: this.config.providerId,
				workspace_id: this.workspaceId,
				observation_window_id: this.windowId,
				observation_sequence: snapshot.sequence,
				observed_at: snapshot.observedAt,
				boundary,
				...snapshot.context,
				git: snapshot.git,
				...extra,
			})
		} catch {
			// Telemetry must not interrupt inference or Git operations.
		}
	}

	private async capture(boundary: "chat_open" | "agent_yield" | "idle_head_changed"): Promise<void> {
		const precedingRequestId = this.lastRequestId
		const snapshot = await this.snapshot()
		if (!snapshot) return
		if (boundary === "idle_head_changed" && !snapshot.headChanged) return
		this.emit(snapshot, boundary, precedingRequestId ? { preceding_request_id: precedingRequestId } : {})
	}

	private onEvent(event: AgentRuntimeEvent): void {
		if (this.agentId && event.snapshot.agentId !== this.agentId) return
		if (event.type === "run-started" || event.type === "turn-started") {
			this.agentId ??= event.snapshot.agentId
			this.running = true
			this.context = { runId: event.snapshot.runId, iteration: event.snapshot.iteration }
		} else if (event.type === "run-finished" || event.type === "run-failed") {
			this.running = false
			// Early failures/cancellation may never call afterModel.
			for (const key of this.pendingModels.keys()) {
				if (key.startsWith(`${event.snapshot.runId}:`)) this.pendingModels.delete(key)
			}
			void this.capture("agent_yield").catch(() => {})
		}
	}

	private beforeModel({ runId, iteration, agentId }: AgentRuntimeStateSnapshot): void {
		if (!this.enabled() || (this.agentId && agentId !== this.agentId)) return
		// Neither the hook nor inference waits for Git, including subprocess startup.
		const observation = setImmediate()
			.then(() => this.snapshot({ runId, iteration, agentId }))
			.catch(() => undefined)
		this.pendingModels.set(`${runId}:${iteration}`, observation)
	}

	private afterModel({ snapshot: { runId, iteration }, requestId: rawId }: AgentAfterModelContext): void {
		const key = `${runId}:${iteration}`
		const observation = this.pendingModels.get(key)
		this.pendingModels.delete(key)
		if (!observation || !this.enabled()) return
		const id = rawId?.trim()
		const requestId = id && /^[\w-]{1,128}$/.test(id) ? id : undefined
		this.lastRequestId = requestId
		void observation
			.then((snapshot) => {
				if (snapshot)
					this.emit(snapshot, "model_call", {
						...(requestId ? { request_id: requestId } : {}),
						request_id_status: requestId ? "present" : "missing",
					})
			})
			.catch(() => {})
	}

	private async watchGit(): Promise<void> {
		try {
			const vscode = await import("vscode")
			const extension = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>("vscode.git")
			if (!extension) return
			const api = (extension.isActive ? extension.exports : await extension.activate()).getAPI(1)
			if (this.disposed) return
			const attach = () => {
				this.repositorySubscription?.dispose()
				const repository = api.getRepository(vscode.Uri.file(this.config.cwd))
				if (!repository) return
				let notifiedHead = repository.state.HEAD?.commit
				this.repositorySubscription = repository.state.onDidChange(() => {
					const head = repository.state.HEAD?.commit
					if (head === notifiedHead) return
					notifiedHead = head
					if (!this.running) void this.capture("idle_head_changed")
				})
				// Cover changes between the opening snapshot and listener attachment.
				if (!this.running && notifiedHead !== this.lastHead) void this.capture("idle_head_changed")
			}
			attach()
			this.subscriptions.push(api.onDidOpenRepository(attach))
		} catch {
			// Git extension unavailable/disabled: request and yield snapshots still work.
		}
	}

	dispose(): void {
		this.disposed = true
		this.pendingModels.clear()
		this.repositorySubscription?.dispose()
		for (const subscription of this.subscriptions) subscription.dispose()
	}
}
