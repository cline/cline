import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import type { ClineCoreStartInput, ITelemetryService, TelemetryProperties } from "@cline/core"
import type { AgentRuntimeEvent } from "@cline/shared"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readGitSnapshot, sanitizeGitRemote, VscodeGitTelemetry, VscodeGitTelemetryManager } from "./git-telemetry"

const vscodeGit = vi.hoisted(() => ({
	workspaceFolders: undefined as { uri: { fsPath: string } }[] | undefined,
	statusFailure: undefined as { code?: string; killed?: boolean } | undefined,
	statusGate: undefined as Promise<void> | undefined,
}))
vi.mock("vscode", () => ({
	workspace: {
		get workspaceFolders() {
			return vscodeGit.workspaceFolders
		},
	},
}))

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>()
	const { promisify } = await import("node:util")
	const execute = promisify(actual.execFile)
	return {
		...actual,
		execFile: Object.assign(actual.execFile.bind(null), {
			[promisify.custom]: async (file: string, args: string[], options: import("node:child_process").ExecFileOptions) => {
				if (args.includes("--porcelain=v2")) {
					await vscodeGit.statusGate
					if (vscodeGit.statusFailure) throw vscodeGit.statusFailure
				}
				// Real Git startup can exceed the production budget on busy Windows runners.
				// Test parsing with a larger budget; limit failures are injected explicitly above.
				return execute(file, args, { ...options, timeout: options.timeout === undefined ? undefined : 5000 })
			},
		}),
	}
})

const execFileAsync = promisify(execFile)
const tmp = resolve(import.meta.dirname, "../../../../tmp")
let cwd: string
let enabled: boolean
let events: { event: string; properties?: TelemetryProperties }[]
let observers: VscodeGitTelemetry[]
let telemetry: ITelemetryService
const git = async (...args: string[]) =>
	(
		await execFileAsync("git", ["-c", "commit.gpgsign=false", "-c", `core.hooksPath=${join(cwd, "no-hooks")}`, ...args], {
			cwd,
		})
	).stdout.trim()
const commit = async () => {
	await git("commit", "--allow-empty", "-m", "test")
	return git("rev-parse", "HEAD")
}
function observer(config: Partial<ClineCoreStartInput["config"]> = {}) {
	const result = new VscodeGitTelemetry(
		{
			sessionId: "task-1",
			cwd,
			providerId: "cline",
			modelId: "test",
			systemPrompt: "test",
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			...config,
		},
		telemetry,
	)
	observers.push(result)
	result.open(config.sessionId ?? "task-1")
	return result
}
function runtimeEvent(type: string) {
	return { type, snapshot: { agentId: "agent-1", runId: "run-1", iteration: 2 } } as AgentRuntimeEvent
}
async function beginModel(tracker: VscodeGitTelemetry, iteration = 2, waitForCapture = true) {
	const hooks = tracker.configure().hooks
	const snapshot = { ...runtimeEvent("turn-started").snapshot, iteration }
	await hooks?.beforeModel?.({ snapshot, request: { messages: [], tools: [] } })
	return async (requestId?: string) => {
		const control = await hooks?.afterModel?.({
			snapshot,
			requestId,
			finishReason: "stop",
			assistantMessage: { id: "assistant", role: "assistant", content: [], createdAt: Date.now() },
		})
		// A capture can run status, two fallback identity reads, and remote sequentially.
		if (waitForCapture) await vi.waitFor(() => expect(tracker["capturing"]).toBe(false), { timeout: 20_000 })
		return control
	}
}

beforeEach(async () => {
	await mkdir(tmp, { recursive: true })
	cwd = await mkdtemp(join(tmp, "git-telemetry-"))
	// Non-repo fixtures must not discover the surrounding Cline checkout.
	vi.stubEnv("GIT_CEILING_DIRECTORIES", tmp)
	await git("init", "-b", "main")
	await git("config", "user.email", "test@example.test")
	await git("config", "user.name", "Test")
	enabled = true
	events = []
	observers = []
	telemetry = {
		isEnabled: () => enabled,
		capture: (event) => {
			events.push(event)
		},
		setDistinctId() {},
		setMetadata() {},
		updateMetadata() {},
		setCommonProperties() {},
		updateCommonProperties() {},
		captureRequired() {},
		recordCounter() {},
		recordHistogram() {},
		recordGauge() {},
		flush: async () => {},
		dispose: async () => {},
	}
	vscodeGit.statusFailure = undefined
	vscodeGit.statusGate = undefined
	vscodeGit.workspaceFolders = [{ uri: { fsPath: cwd } }]
})
afterEach(async () => {
	for (const item of observers) item.dispose()
	await vi.waitFor(() => expect(observers.every((item) => !item["capturing"])).toBe(true), { timeout: 20_000 })
	vi.unstubAllEnvs()
	await rm(cwd, { recursive: true, force: true })
})

describe("Git snapshots", () => {
	it("distinguishes unborn, clean, untracked, ignored, staged, and unstaged states", async () => {
		const clean = { dirty: false, staged: false, unstaged: false, untracked: false }
		expect(await readGitSnapshot(cwd)).toMatchObject({ state: "unborn", branch: "main", ...clean, remote_state: "none" })
		const head = await commit()
		expect(await readGitSnapshot(cwd)).toMatchObject({ state: "ok", head_sha: head, ...clean })
		await writeFile(join(cwd, "untracked.txt"), "new file")
		expect(await readGitSnapshot(cwd)).toMatchObject({ dirty: true, staged: false, unstaged: false, untracked: true })
		await writeFile(join(cwd, ".git", "info", "exclude"), "untracked.txt\n")
		expect(await readGitSnapshot(cwd)).toMatchObject(clean)
		await writeFile(join(cwd, "tracked.txt"), "initial")
		await git("add", "tracked.txt")
		expect(await readGitSnapshot(cwd)).toMatchObject({ dirty: true, staged: true, unstaged: false, untracked: false })
		await commit()
		await writeFile(join(cwd, "tracked.txt"), "modified")
		expect(await readGitSnapshot(cwd)).toMatchObject({ dirty: true, staged: false, unstaged: true, untracked: false })
		await git("add", "tracked.txt")
		await writeFile(join(cwd, "tracked.txt"), "modified again")
		await writeFile(join(cwd, "another.txt"), "new file")
		expect(await readGitSnapshot(cwd)).toMatchObject({ dirty: true, staged: true, unstaged: true, untracked: true })
	})

	it("includes staged renames and unstaged deletions", async () => {
		await writeFile(join(cwd, "tracked.txt"), "initial")
		await git("add", "tracked.txt")
		await commit()
		await git("config", "status.renames", "true")
		await git("mv", "tracked.txt", "renamed.txt")
		expect(await readGitSnapshot(cwd)).toMatchObject({ dirty: true, staged: true, unstaged: false, untracked: false })
		await rm(join(cwd, "renamed.txt"))
		expect(await readGitSnapshot(cwd)).toMatchObject({ dirty: true, staged: true, unstaged: true, untracked: false })
	})

	it("marks unmerged entries as changes on both index and worktree sides", async () => {
		await writeFile(join(cwd, "conflict.txt"), "base\n")
		await git("add", "conflict.txt")
		await commit()
		await git("checkout", "-b", "other")
		await writeFile(join(cwd, "conflict.txt"), "other\n")
		await git("add", "conflict.txt")
		await commit()
		await git("checkout", "main")
		await writeFile(join(cwd, "conflict.txt"), "main\n")
		await git("add", "conflict.txt")
		await commit()
		await expect(git("merge", "other")).rejects.toThrow()
		expect(await readGitSnapshot(cwd)).toMatchObject({ dirty: true, staged: true, unstaged: true, untracked: false })
	})

	it("reads the actual HEAD for detached checkouts and separate worktrees", async () => {
		const first = await commit()
		const second = await commit()
		const worktree = join(cwd, "other-worktree")
		await git("worktree", "add", "--detach", worktree, first)
		expect(await readGitSnapshot(worktree)).toMatchObject({ state: "ok", head_sha: first })
		expect((await readGitSnapshot(worktree)).branch).toBeUndefined()
		expect((await readGitSnapshot(cwd)).head_sha).toBe(second)
		await git("checkout", "--detach", first)
		expect((await readGitSnapshot(cwd)).head_sha).toBe(first)
	})

	it("distinguishes non-Git directories from unavailable directories", async () => {
		await rm(join(cwd, ".git"), { recursive: true })
		expect(await readGitSnapshot(cwd)).toEqual({ state: "non_git" })
		expect(await readGitSnapshot(join(cwd, "missing"))).toEqual({ state: "unavailable" })
	})

	it.each([
		{ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" },
		{ killed: true },
	])("preserves identity when status exceeds its limits (%j)", async (failure) => {
		const head = await commit()
		await git("remote", "add", "origin", "https://user:secret@example.test/repo?token=secret")
		vscodeGit.statusFailure = failure
		expect(await readGitSnapshot(cwd)).toEqual({
			state: "partial",
			head_sha: head,
			branch: "main",
			remote_state: "ok",
			remote_url: "https://example.test/repo",
		})
		await git("checkout", "--detach", head)
		expect(await readGitSnapshot(cwd)).toEqual({
			state: "partial",
			head_sha: head,
			remote_state: "ok",
			remote_url: "https://example.test/repo",
		})
	})

	it("preserves an unborn branch when status times out, but does not invent identity if Git disappears", async () => {
		vscodeGit.statusFailure = { killed: true }
		expect(await readGitSnapshot(cwd)).toEqual({ state: "partial", branch: "main", remote_state: "none" })
		await rm(join(cwd, ".git"), { recursive: true })
		expect(await readGitSnapshot(cwd)).toEqual({ state: "unavailable" })
	})

	it("reports unavailable when Git is missing", async () => {
		vi.stubEnv("PATH", join(cwd, "missing-bin"))
		expect(await readGitSnapshot(cwd)).toEqual({ state: "unavailable" })
	})

	it("prefers origin and strips credentials, query parameters, fragments, and local remotes", async () => {
		await git("remote", "add", "upstream", "https://example.test/upstream.git")
		await git("remote", "add", "origin", "https://user:secret@example.test/team/repo.git?token=secret#secret")
		expect((await readGitSnapshot(cwd)).remote_url).toBe("https://example.test/team/repo.git")
		await git("remote", "set-url", "origin", "/private/local/repo")
		expect(await readGitSnapshot(cwd)).toMatchObject({ remote_state: "unsupported" })
		expect((await readGitSnapshot(cwd)).remote_url).toBeUndefined()
		expect(sanitizeGitRemote("git@example.test:team/repo.git")).toBe("ssh://example.test/team/repo.git")
		expect(sanitizeGitRemote("ssh://user:secret@example.test:2222/team/repo.git?secret=x")).toBe(
			"ssh://example.test:2222/team/repo.git",
		)
		for (const value of [
			"file:///private/repo",
			"../repo",
			"C:\\Users\\repo",
			"ext::secret",
			"https://example.test/\nsecret",
		]) {
			expect(sanitizeGitRemote(value)).toBeUndefined()
		}
	})
})

describe("Git telemetry manager", () => {
	it("disposes late observers without opening them and rejects initialization after disposal", () => {
		const manager = new VscodeGitTelemetryManager(telemetry)
		const input: ClineCoreStartInput = {
			config: {
				cwd,
				providerId: "cline",
				modelId: "test",
				systemPrompt: "test",
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		}
		const observer = manager.init(input)
		if (!observer) throw new Error("observer missing")
		const open = vi.spyOn(observer, "open")
		const dispose = vi.spyOn(observer, "dispose")
		manager.dispose()
		manager.start("late-session", observer)
		expect(open).not.toHaveBeenCalled()
		expect(dispose).toHaveBeenCalledTimes(1)
		const config = input.config
		expect(manager.init(input)).toBeUndefined()
		expect(input.config).toBe(config)
		manager.dispose()
		expect(dispose).toHaveBeenCalledTimes(1)
	})
})

describe("conversation Git telemetry", () => {
	it("emits only state changes across requests, including changes back to earlier states", async () => {
		const tracker = observer()
		const snapshot = {
			git: await readGitSnapshot(cwd),
			workspaceRootCount: 1,
			sequence: 1,
			observedAt: new Date().toISOString(),
			context: {},
		}
		tracker["emit"](snapshot, "request-1")
		tracker["emit"]({ ...snapshot, sequence: 2, observedAt: "later", context: { iteration: 2 } }, "request-2")
		expect(events).toHaveLength(1)
		const changes = [
			{ ...snapshot, workspaceRootCount: 2 },
			...[
				{ state: "unavailable" as const },
				{ state: "non_git" as const },
				{ state: "ok" as const },
				{ state: "partial" as const },
				{ head_sha: "new-head" },
				{ branch: "other" },
				{ dirty: true },
				{ staged: true },
				{ unstaged: true },
				{ untracked: true },
				{ remote_state: "unsupported" as const },
				{ remote_url: "https://example.test/repo" },
			].map((git) => ({ ...snapshot, git: { ...snapshot.git, ...git } })),
		]
		for (const change of changes) {
			const count = events.length
			tracker["emit"](change, "request-3")
			tracker["emit"](change, "request-4")
			expect(events).toHaveLength(count + 1)
			tracker["emit"](snapshot, "request-5")
			expect(events).toHaveLength(count + 2)
		}
	})

	it("does not remember an opted-out or failed emission as the last emitted state", async () => {
		const tracker = observer()
		const snapshot = await tracker["snapshot"]({})
		if (!snapshot) throw new Error("snapshot missing")
		enabled = false
		tracker["emit"](snapshot)
		enabled = true
		const capture = vi.spyOn(telemetry, "capture").mockImplementationOnce(() => {
			throw new Error("adapter failed")
		})
		tracker["emit"](snapshot)
		expect(events).toHaveLength(0)
		tracker["emit"](snapshot)
		tracker["emit"](snapshot)
		expect(events).toHaveLength(1)
		expect(capture).toHaveBeenCalledTimes(2)
		capture.mockRestore()
	})

	it.each([undefined, 0, 1, 2])("reports the VS Code workspace-folder count (%s), including outside Git", async (count) => {
		vscodeGit.workspaceFolders =
			count === undefined
				? undefined
				: Array.from({ length: count }, (_, i) => ({ uri: { fsPath: join(cwd, `root-${i}`) } }))
		await rm(join(cwd, ".git"), { recursive: true })
		await (await beginModel(observer()))("request-1")
		await vi.waitFor(() => expect(events).toHaveLength(1))
		expect(events[0].properties).toMatchObject({ workspace_root_count: count ?? 0, git: { state: "non_git" } })
		expect(JSON.stringify(events)).not.toContain(cwd)
	})

	it("records root count at observation time and picks up folder changes on later boundaries", async () => {
		const tracker = observer()
		await (await beginModel(tracker))("request-1")
		expect(events[0].properties?.workspace_root_count).toBe(1)
		vscodeGit.workspaceFolders?.push({ uri: { fsPath: join(cwd, "second-root") } })
		await (await beginModel(tracker, 3))("request-2")
		await vi.waitFor(() => expect(events).toHaveLength(2))
		expect(events[1].properties?.workspace_root_count).toBe(2)
	})

	it("preserves config values and uses its identity for telemetry and request matching", async () => {
		const delegate = vi.fn(async () => new Response("ok", { headers: { "X-Request-ID": "request-1" } }))
		const providerConfig = {
			providerId: "cline",
			modelId: "nested-model",
			apiKey: "preserved-key",
			fetch: delegate as unknown as typeof fetch,
		}
		const tracker = observer({ sessionId: "custom-task", providerId: "cline-pass", modelId: "top-model", providerConfig })
		const config = tracker.configure()
		expect(config).toMatchObject({
			sessionId: "custom-task",
			providerId: "cline-pass",
			modelId: "top-model",
			cwd,
			systemPrompt: "test",
		})
		expect(config.providerConfig).toMatchObject({ providerId: "cline", modelId: "nested-model", apiKey: "preserved-key" })
		expect(providerConfig.fetch).toBe(delegate)
		expect(config.providerConfig?.fetch).toBe(delegate)
		const finish = await beginModel(tracker)
		await finish("request-1")
		await vi.waitFor(() => expect(events).toHaveLength(1))
		expect(events[0].properties).toMatchObject({
			sessionId: "custom-task",
			ulid: "custom-task",
			providerId: "cline-pass",
			request_id: "request-1",
			workspace_root_count: 1,
			git: { dirty: false, staged: false, unstaged: false, untracked: false },
		})
		expect(observer({ providerId: "cline-pass" }).configure().providerConfig).toBeUndefined()
	})

	it("reads Git after the response, deduplicates state, and preserves existing hooks", async () => {
		const beforeModel = vi.fn(() => ({ stop: true }))
		const afterModel = vi.fn(() => ({ stop: true }))
		const onEvent = vi.fn()
		const tracker = observer({ hooks: { beforeModel, afterModel, onEvent } })
		expect(tracker.configure().hooks?.beforeModel).toBe(beforeModel)
		expect(tracker.configure().hooks?.onEvent).toBe(onEvent)
		const finish = await beginModel(tracker, 1)
		expect(events).toHaveLength(0)
		const head = await commit()
		expect(await finish("request-1")).toEqual({ stop: true })
		expect(afterModel).toHaveBeenCalledTimes(1)
		expect(events).toHaveLength(1)
		expect(events[0].properties).toMatchObject({
			request_id: "request-1",
			iteration: 1,
			boundary: "model_call",
			git: { head_sha: head },
		})
		await (await beginModel(tracker, 2))("request-2")
		expect(events).toHaveLength(1)
		await writeFile(join(cwd, "new.txt"), "change")
		await (await beginModel(tracker, 3))("request-3")
		expect(events).toHaveLength(2)
		expect(events[1].properties).toMatchObject({ request_id: "request-3", git: { untracked: true } })
	})

	it("waits for a capture that takes longer than one subprocess timeout", async () => {
		const gate = Promise.withResolvers<void>()
		vscodeGit.statusGate = gate.promise
		const release = setTimeout(() => gate.resolve(), 1200)
		try {
			await (await beginModel(observer()))("slow-request")
			expect(events).toHaveLength(1)
			expect(events[0].properties?.request_id).toBe("slow-request")
		} finally {
			clearTimeout(release)
			gate.resolve()
		}
	})

	it("returns before Git completes, skips overlapping captures, and resumes after failure", async () => {
		const gate = Promise.withResolvers<void>()
		vscodeGit.statusGate = gate.promise
		const afterModel = vi.fn(() => ({ stop: true }))
		const tracker = observer({ hooks: { afterModel } })
		try {
			expect(await (await beginModel(tracker, 1, false))("first")).toEqual({ stop: true })
			expect(await (await beginModel(tracker, 2, false))("overlapping")).toEqual({ stop: true })
			expect(afterModel).toHaveBeenCalledTimes(2)
			expect(events).toHaveLength(0)
		} finally {
			gate.resolve()
		}
		await vi.waitFor(() => expect(tracker["capturing"]).toBe(false), { timeout: 20_000 })
		expect(events).toHaveLength(1)
		expect(events[0].properties?.request_id).toBe("first")
		vi.spyOn(telemetry, "capture").mockImplementationOnce(() => {
			throw new Error("adapter failed")
		})
		await writeFile(join(cwd, "changed.txt"), "change")
		await (await beginModel(tracker, 3))("failed")
		await (await beginModel(tracker, 4))("next")
		expect(events).toHaveLength(2)
		expect(events[1].properties?.request_id).toBe("next")
	})

	it.each([undefined, "unsafe header value"])("keeps absent and invalid IDs explicitly unjoined (%s)", async (id) => {
		const tracker = observer()
		const finish = await beginModel(tracker)
		await finish(id)
		await vi.waitFor(() => expect(events).toHaveLength(1))
		expect(events.every((event) => event.properties?.request_id_status === "missing")).toBe(true)
		expect(events.every((event) => event.properties?.request_id === undefined)).toBe(true)
		expect(JSON.stringify(events)).not.toContain("unsafe header value")
	})

	it("respects opt-out at model completion", async () => {
		const tracker = observer()
		const finish = await beginModel(tracker)
		enabled = false
		await finish("not-collected")
		expect(events).toEqual([])
		enabled = true
		await (await beginModel(tracker, 3))("collected")
		expect(events).toHaveLength(1)
	})

	it.each(["opt-out", "close"])("suppresses queued model emission on %s", async (action) => {
		const tracker = observer()
		const finish = await beginModel(tracker)
		const pending = finish("request-1")
		if (action === "close") tracker.dispose()
		else enabled = false
		await pending
		expect(events).toEqual([])
	})

	it.each([true, false])("ignores inherited subagent hooks even when root consent was %s", async (rootConsent) => {
		const tracker = observer()
		const hooks = tracker.configure().hooks
		enabled = rootConsent
		await (await beginModel(tracker))("root-request")
		enabled = true
		events = []
		const child = { ...runtimeEvent("run-started").snapshot, agentId: "child", runId: "child-run" }
		await hooks?.beforeModel?.({ snapshot: child, request: { messages: [], tools: [] } })
		await hooks?.afterModel?.({
			snapshot: child,
			requestId: "child-request",
			finishReason: "stop",
			assistantMessage: { id: "child", role: "assistant", content: [], createdAt: Date.now() },
		})
		await hooks?.onEvent?.({ type: "run-finished", snapshot: child } as AgentRuntimeEvent)
		const stopped = observer({ hooks: { beforeModel: () => ({ stop: true }) } }).configure().hooks
		expect(await stopped?.beforeModel?.({ snapshot: child, request: { messages: [], tools: [] } })).toEqual({ stop: true })
		expect(events).toEqual([])
	})

	it("emits only afterModel, without opening/yield/idle events consuming request-linked changes", async () => {
		const originalHook = vi.fn()
		const tracker = observer({ hooks: { onEvent: originalHook } })
		const config = tracker.configure()
		const enabledCheck = vi.spyOn(telemetry, "isEnabled")
		tracker.open("task-1")
		await config.hooks?.onEvent?.(runtimeEvent("run-started"))
		expect(enabledCheck).not.toHaveBeenCalled()
		const finish = await beginModel(tracker)
		expect(enabledCheck).not.toHaveBeenCalled()
		expect(events).toHaveLength(0)
		await finish("request-1")
		await vi.waitFor(() => expect(events).toHaveLength(1))
		const head = await commit()
		enabledCheck.mockClear()
		await config.hooks?.onEvent?.(runtimeEvent("run-finished"))
		await config.hooks?.onEvent?.(runtimeEvent("run-failed"))
		expect(enabledCheck).not.toHaveBeenCalled()
		expect(events).toHaveLength(1)
		await (await beginModel(tracker, 3))("request-2")
		await vi.waitFor(() => expect(events).toHaveLength(2))
		expect(events[1].properties).toMatchObject({ boundary: "model_call", request_id: "request-2", git: { head_sha: head } })
		expect(originalHook).toHaveBeenCalledTimes(3)
	})

	it("fails closed if consent checks throw without breaking either model hook", async () => {
		const beforeModel = vi.fn()
		const afterModel = vi.fn()
		const tracker = observer({ hooks: { beforeModel, afterModel } })
		const check = vi.spyOn(telemetry, "isEnabled").mockImplementation(() => {
			throw new Error("adapter failed")
		})
		await (await beginModel(tracker, 1))("skipped")
		check.mockRestore()
		const ready = vi.spyOn(telemetry, "isEnabled")
		const finish = await beginModel(tracker, 2)
		ready.mockImplementation(() => {
			throw new Error("adapter failed")
		})
		await finish("also-skipped")
		expect(beforeModel).toHaveBeenCalledTimes(2)
		expect(afterModel).toHaveBeenCalledTimes(2)
		expect(events).toEqual([])
		ready.mockRestore()
	})

	it("does not read or emit after close", async () => {
		const tracker = observer()
		const check = vi.spyOn(telemetry, "isEnabled")
		const closed = await beginModel(tracker)
		tracker.dispose()
		await closed("closed")
		expect(check).not.toHaveBeenCalled()
		expect(events).toHaveLength(0)
	})

	it("detects a previously non-Git directory becoming a repository on the next model call", async () => {
		const tracker = observer()
		await rm(join(cwd, ".git"), { recursive: true })
		await (await beginModel(tracker))("request-1")
		await vi.waitFor(() => expect(events).toHaveLength(1))
		expect(events[0].properties?.git).toEqual({ state: "non_git" })
		await git("init", "-b", "main")
		await git("config", "user.name", "Test")
		await git("config", "user.email", "test@example.test")
		const head = await commit()
		await (await beginModel(tracker, 3))("request-2")
		await vi.waitFor(() => expect(events).toHaveLength(2))
		expect(events[1].properties).toMatchObject({ boundary: "model_call", request_id: "request-2", git: { head_sha: head } })
	})

	it("uses private keyed workspace IDs, stable across reopenings but distinct across worktrees and tasks", async () => {
		await commit()
		const worktree = join(cwd, "other-worktree")
		await git("worktree", "add", "--detach", worktree, "HEAD")
		const first = observer()
		expect(first.hasOpened).toBe(true)
		for (const tracker of [first, observer({ cwd: worktree }), observer(), observer({ sessionId: "other-task" })]) {
			const count = events.length
			await (await beginModel(tracker))("request-1")
			await vi.waitFor(() => expect(events).toHaveLength(count + 1))
			tracker.dispose()
		}
		expect(events[0].properties?.workspace_id).not.toBe(events[1].properties?.workspace_id)
		expect(events[0].properties?.workspace_id).toBe(events[2].properties?.workspace_id)
		expect(events[0].properties?.observation_window_id).not.toBe(events[2].properties?.observation_window_id)
		expect(events[0].properties?.workspace_id).not.toBe(events[3].properties?.workspace_id)
		const guessableDigest = createHash("sha256")
			.update(`task-1\0${resolve(cwd)}`)
			.digest("hex")
		expect(events[0].properties?.workspace_id).not.toBe(guessableDigest)
		expect(JSON.stringify(events)).not.toContain(cwd)
	})
})
