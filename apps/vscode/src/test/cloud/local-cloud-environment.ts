import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type IncomingMessage, type Server } from "node:http"
import type { Socket } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import {
	CoreSessionService,
	createLocalHubScheduleRuntimeHandlers,
	type HubWebSocketServer,
	LocalRuntimeHost,
	SqliteSessionStore,
	startHubWebSocketServer,
} from "@cline/core"
import type { MessageWithMetadata as SdkMessage } from "@cline/llms"
import WebSocket, { type RawData, WebSocketServer } from "ws"
import type { UserResponse } from "@/shared/ClineAccount"

const LOOPBACK_HOST = "127.0.0.1"
const HUB_AUTH_PROTOCOL_PREFIX = "cline-hub-auth."
const FIXTURE_USER_ID = "local-cloud-user"
const FIXTURE_ORGANIZATION = {
	organizationId: "local-cloud-organization",
	memberId: "local-cloud-member",
	name: "Local Cloud QA",
	roles: ["owner"],
} satisfies Omit<UserResponse["organizations"][number], "active">
const PERSONAL_REPOSITORY = {
	id: 1,
	name: "fixture",
	full_name: "cline/fixture",
	html_url: "https://github.com/cline/fixture",
	default_branch: "main",
}
const ORGANIZATION_REPOSITORY = {
	id: 2,
	name: "organization-fixture",
	full_name: "cline/organization-fixture",
	html_url: "https://github.com/cline/organization-fixture",
	default_branch: "main",
}

export interface LocalCloudSessionRecord {
	id: string
	status: string
	title?: string
	sandboxUrl?: string
	repoContext: { repoUrl?: string; branch?: string }
	metadata: {
		modelId?: string
		taskId: string
		statusReason?: string
		sandboxType?: "standard" | "resumable"
		provisioningPhase?: "provisioning" | "cloning_repo" | "agent_starting" | "ready"
	}
	sandboxType?: "standard" | "resumable"
	expiredAt?: string | null
	createdAt: string
	updatedAt: string
}

interface OwnedSandbox {
	record: LocalCloudSessionRecord
	organizationId: string | null
	root: string
	hub?: HubWebSocketServer
	sessionStore?: SqliteSessionStore
	/** Pending flip from `provisioning` to `ready`. */
	readyTimer?: ReturnType<typeof setTimeout>
	/** Transcript snapshot served by GET /history once the sandbox is gone. */
	archive?: SdkMessage[]
	/** Client sockets currently bridged to this sandbox's Hub. */
	clients: Set<WebSocket>
	/** Pending idle suspension after the last client disconnected. */
	suspendTimer?: ReturnType<typeof setTimeout>
}

export interface LocalCloudEnvironment {
	readonly apiBaseUrl: string
	readonly accessToken: string
	/** The fetch every sandbox uses for model requests; scripted, never leaves the process. */
	readonly modelFetch: typeof fetch
	readonly sessions: ReadonlyMap<string, OwnedSandbox>
	activateSession(sessionId: string): Promise<OwnedSandbox>
	/**
	 * Suspend a resumable sandbox like the hosted control plane does after it
	 * idles: its Hub stops (dropping every client and live runtime) but its disk,
	 * including the saved conversation, survives until POST /resume.
	 */
	suspendSession(sessionId: string): Promise<void>
	/** Provision the next created sandbox but answer its POST with a 502, as if the response were lost. */
	loseNextCreateResponse(): void
	/** Drop only the client transport; the sandbox continues running. */
	disconnectClients(): void
	dispose(): Promise<void>
}

function json(res: import("node:http").ServerResponse, status: number, value?: unknown): void {
	res.statusCode = status
	if (value === undefined) {
		res.end()
		return
	}
	res.setHeader("content-type", "application/json")
	res.end(JSON.stringify(value))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = []
	for await (const chunk of req) chunks.push(Buffer.from(chunk))
	if (chunks.length === 0) return {}
	return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>
}

/** The 402 body the hosted chat router sends when the account runs out of credits. */
const INSUFFICIENT_CREDITS_RESPONSE = {
	error: {
		code: "insufficient_credits",
		message: "Not enough credits available",
		current_balance: 0.01,
		total_spent: 4.99,
		total_promotions: 0,
		buy_credits_url: "http://127.0.0.1/credits",
	},
}

function isExpired(record: LocalCloudSessionRecord): boolean {
	return typeof record.expiredAt === "string" && Date.parse(record.expiredAt) <= Date.now()
}

/** The archived transcript captured from a sandbox before it expired. */
function archivedTranscript(taskId: string, capturedAt: number): SdkMessage[] {
	return [
		{
			role: "user",
			content: '<user_input mode="act">Summarize the fixture repository.</user_input>',
			sessionId: taskId,
			ts: capturedAt,
		},
		{
			role: "assistant",
			content: [{ type: "text", text: "cloud fixture reply" }],
			sessionId: taskId,
			modelInfo: { id: "fixture-model", provider: "cline" },
			metrics: { inputTokens: 1, outputTokens: 3 },
			ts: capturedAt + 1_000,
		},
	]
}

function scriptedModelFetch(options: {
	beforeResponse?: (signal?: AbortSignal | null) => Promise<void>
	insufficientCredits?: boolean
}): typeof fetch {
	const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url)
		if (url.hostname !== "api.cline.bot" || url.pathname !== "/api/v1/chat/completions") {
			throw new Error(`Local cloud fixture blocked unexpected model request to ${url.toString()}`)
		}
		if (init?.signal?.aborted) throw init.signal.reason
		await options.beforeResponse?.(init?.signal)
		if (init?.signal?.aborted) throw init.signal.reason
		if (options.insufficientCredits) {
			return new Response(JSON.stringify(INSUFFICIENT_CREDITS_RESPONSE), {
				status: 402,
				headers: { "content-type": "application/json" },
			})
		}
		const body = [
			`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: "cloud fixture reply" }, finish_reason: null }] })}\n\n`,
			`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 3, total_tokens: 4 } })}\n\n`,
			"data: [DONE]\n\n",
		].join("")
		return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })
	}
	return fetchImpl as typeof fetch
}

export async function startLocalCloudEnvironment(
	options: {
		port?: number
		accessToken?: string
		tempDir?: string
		beforeModelResponse?: (signal?: AbortSignal | null) => Promise<void>
		/** How long a new sandbox reports `provisioning` before `ready`. Default: ready at once. */
		provisioningDelayMs?: number
		/** Seed two Personal sessions whose sandboxes expired an hour ago: one with an archived transcript, one without. */
		seedExpiredSessions?: boolean
		/** Every scripted model reply is the hosted API's 402 insufficient-credits response. */
		insufficientCredits?: boolean
		/** Every session socket upgrade is refused, so a start fails after the sandbox is ready. */
		refuseSessionSockets?: boolean
		/** Suspend a sandbox this long after its last client disconnects. Default: never. */
		suspendIdleAfterMs?: number
	} = {},
): Promise<LocalCloudEnvironment> {
	const accessToken = options.accessToken ?? `local-cloud-${randomUUID()}`
	const provisioningDelayMs = options.provisioningDelayMs ?? 0
	const modelFetch = scriptedModelFetch({
		beforeResponse: options.beforeModelResponse,
		insufficientCredits: options.insufficientCredits,
	})
	const root = await mkdtemp(path.join(options.tempDir ?? tmpdir(), "cline-local-cloud-"))
	const sessions = new Map<string, OwnedSandbox>()
	if (options.seedExpiredSessions) {
		// The hosted control plane leaves an expired session's stored status as it
		// was ("active") and lets expiredAt decide; readers compare it with now.
		const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000
		const expiredAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
		for (const [title, archived] of [
			["Archived fixture task", true],
			["Unarchived fixture task", false],
		] as const) {
			const id = `ses-${randomUUID()}`
			const taskId = `tsk-${randomUUID()}`
			sessions.set(id, {
				record: {
					id,
					status: "active",
					title,
					repoContext: { repoUrl: PERSONAL_REPOSITORY.html_url, branch: PERSONAL_REPOSITORY.default_branch },
					metadata: { modelId: "fixture-model", taskId },
					expiredAt,
					createdAt: new Date(twoDaysAgo).toISOString(),
					updatedAt: new Date(twoDaysAgo).toISOString(),
				},
				organizationId: null,
				root: await mkdtemp(path.join(root, "sandbox-")),
				archive: archived ? archivedTranscript(taskId, twoDaysAgo) : undefined,
				clients: new Set(),
			})
		}
	}
	let activeOrganizationId: string | null = null
	const sockets = new Set<Socket>()
	const bridgedSockets = new Set<WebSocket>()
	const activations = new Map<string, Promise<OwnedSandbox>>()
	const wss = new WebSocketServer({ noServer: true })
	let disposing = false
	const activateSession = async (sessionId: string): Promise<OwnedSandbox> => {
		if (disposing) throw new Error("Local cloud environment is disposing")
		const owned = sessions.get(sessionId)
		if (!owned) throw new Error(`Unknown local cloud session ${sessionId}`)
		if (owned.hub) return owned
		const pending = activations.get(sessionId)
		if (pending) return pending
		const activation = (async () => {
			const sessionStore = new SqliteSessionStore({ sessionsDir: path.join(owned.root, "data") })
			try {
				const sessionHost = new LocalRuntimeHost({
					sessionService: new CoreSessionService(sessionStore, {
						sessionArtifactsDir: path.join(owned.root, "sessions"),
					}),
					fetch: modelFetch,
				})
				const hub = await startHubWebSocketServer({
					host: LOOPBACK_HOST,
					port: 0,
					workspaceRoot: owned.root,
					owner: { ownerId: sessionId, discoveryPath: path.join(owned.root, "hub.json") },
					eventLog: false,
					runQueue: false,
					sessionHost,
					runtimeHandlers: createLocalHubScheduleRuntimeHandlers({ fetch: modelFetch }),
				})
				owned.hub = hub
				owned.sessionStore = sessionStore
				return owned
			} catch (error) {
				sessionStore.close()
				throw error
			}
		})()
		activations.set(sessionId, activation)
		try {
			return await activation
		} finally {
			if (activations.get(sessionId) === activation) activations.delete(sessionId)
		}
	}

	let apiBaseUrl = ""
	let loseNextCreateResponse = false
	// The hosted sandbox is listening by the time /status says ready. Start the
	// Hub as the session becomes ready rather than on the first socket upgrade:
	// a cold start can outlast the client's connect timeout. Like the hosted
	// control plane, /status also reports the provisioning phase: the repository
	// is cloned first, then the agent starts.
	const provision = (owned: OwnedSandbox) => {
		const becomeReady = () => {
			if (sessions.get(owned.record.id) !== owned) return
			owned.record.status = "ready"
			owned.record.metadata.provisioningPhase = "ready"
			owned.record.sandboxUrl = apiBaseUrl
			owned.record.updatedAt = new Date().toISOString()
			void activateSession(owned.record.id).catch(() => undefined)
		}
		if (provisioningDelayMs > 0) {
			owned.record.metadata.provisioningPhase = "cloning_repo"
			const agentStarting = setTimeout(() => {
				if (owned.record.status === "provisioning") owned.record.metadata.provisioningPhase = "agent_starting"
			}, provisioningDelayMs / 2)
			owned.readyTimer = setTimeout(() => {
				owned.readyTimer = undefined
				clearTimeout(agentStarting)
				becomeReady()
			}, provisioningDelayMs)
		} else {
			becomeReady()
		}
	}
	const suspendSession = async (sessionId: string): Promise<void> => {
		const owned = sessions.get(sessionId)
		if (!owned) throw new Error(`Unknown local cloud session ${sessionId}`)
		clearTimeout(owned.suspendTimer)
		owned.suspendTimer = undefined
		await activations.get(sessionId)?.catch(() => undefined)
		owned.record.status = "suspended"
		owned.record.updatedAt = new Date().toISOString()
		const { hub, sessionStore } = owned
		owned.hub = undefined
		owned.sessionStore = undefined
		try {
			await hub?.close()
		} finally {
			sessionStore?.close()
		}
	}

	const server: Server = createServer(async (req, res) => {
		try {
			const url = new URL(req.url ?? "/", apiBaseUrl)
			if (url.pathname === "/health") return json(res, 200, { status: "ok" })
			if (["/agents", "/dashboard/integrations", "/dashboard/organization/integrations"].includes(url.pathname)) {
				return json(res, 200, { fixture: "Local cloud development page", path: url.pathname })
			}
			const presentedToken = req.headers.authorization?.replace(/^Bearer\s+/i, "").replace(/^workos:/i, "")
			if (presentedToken !== accessToken) return json(res, 401, { error: "Unauthorized" })
			if (url.pathname === "/api/v1/users/me" && req.method === "GET") {
				const now = new Date().toISOString()
				return json(res, 200, {
					success: true,
					data: {
						id: FIXTURE_USER_ID,
						email: "local-cloud@example.test",
						displayName: "Local Cloud Developer",
						photoUrl: "",
						organizations: [{ ...FIXTURE_ORGANIZATION, active: activeOrganizationId !== null }],
						createdAt: now,
						updatedAt: now,
					} satisfies UserResponse,
				})
			}
			if (url.pathname === "/api/v1/users/active-account" && req.method === "PUT") {
				const input = await readJson(req)
				const organizationId = input.organizationId ?? null
				if (organizationId !== null && organizationId !== FIXTURE_ORGANIZATION.organizationId) {
					return json(res, 403, { error: "Unknown fixture organization" })
				}
				// The switch commits before the response; subsequent profile reads see it.
				activeOrganizationId = organizationId
				return json(res, 200, { success: true, data: "Active account updated" })
			}
			if (url.pathname === "/api/v1/users/me/remote-config" && req.method === "GET") {
				return json(res, 200, { success: true, data: null })
			}
			if (req.method === "GET") {
				const userPath = `/api/v1/users/${FIXTURE_USER_ID}`
				const organizationPath = `/api/v1/organizations/${FIXTURE_ORGANIZATION.organizationId}`
				if (url.pathname === `${userPath}/balance`) {
					return json(res, 200, { success: true, data: { balance: 100, userId: FIXTURE_USER_ID } })
				}
				if (url.pathname === `${organizationPath}/balance`) {
					return json(res, 200, {
						success: true,
						data: { balance: 250, organizationId: FIXTURE_ORGANIZATION.organizationId },
					})
				}
				if (
					url.pathname === `${userPath}/usages` ||
					url.pathname === `${organizationPath}/members/${FIXTURE_ORGANIZATION.memberId}/usages`
				) {
					return json(res, 200, { success: true, data: { items: [] } })
				}
				if (url.pathname === `${userPath}/payments`) {
					return json(res, 200, { success: true, data: { paymentTransactions: [] } })
				}
				if (url.pathname === `${organizationPath}/remote-config`) {
					return json(res, 200, { success: true, data: { enabled: false, value: "{}" } })
				}
			}

			const repositoryPath = url.pathname.match(
				/^\/api\/v1(?:\/organizations\/([^/]+))?\/integrations\/github\/repositories(?:\/(\d+)\/branches)?$/,
			)
			if (repositoryPath && req.method === "GET") {
				const organizationId = repositoryPath[1] ? decodeURIComponent(repositoryPath[1]) : null
				if (organizationId !== null && organizationId !== FIXTURE_ORGANIZATION.organizationId) {
					return json(res, 403, { error: "Unknown fixture organization" })
				}
				const repository = organizationId ? ORGANIZATION_REPOSITORY : PERSONAL_REPOSITORY
				if (repositoryPath[2]) {
					if (Number(repositoryPath[2]) !== repository.id) return json(res, 404, { error: "Repository not found" })
					return json(res, 200, {
						success: true,
						data: [{ name: repository.default_branch }, { name: repository.name }],
					})
				}
				// CLINE_LOCAL_CLOUD_NO_REPOSITORIES=1 reproduces a connected GitHub App with
				// no accessible repositories, so Cloud can be selected without a repository.
				if (process.env.CLINE_LOCAL_CLOUD_NO_REPOSITORIES === "1") {
					return json(res, 200, { success: true, data: [] })
				}
				return json(res, 200, { success: true, data: [repository] })
			}
			if (url.pathname === "/api/v1/session" && req.method === "GET") {
				const organizationId = url.searchParams.get("organizationId")
				if (organizationId !== null && organizationId !== FIXTURE_ORGANIZATION.organizationId) {
					return json(res, 403, { error: "Unknown fixture organization" })
				}
				return json(res, 200, {
					success: true,
					data: [...sessions.values()]
						.filter((owned) => owned.organizationId === organizationId)
						.map(({ record }) => record),
				})
			}
			if (url.pathname === "/api/v1/session" && req.method === "POST") {
				const input = await readJson(req)
				// Scope belongs to the create request, even if the account switches during provisioning.
				const organizationId = input.organizationId ?? null
				if (organizationId !== null && organizationId !== FIXTURE_ORGANIZATION.organizationId) {
					return json(res, 403, { error: "Unknown fixture organization" })
				}
				const id = `ses-${randomUUID()}`
				const taskId = `tsk-${randomUUID()}`
				const sandboxRoot = await mkdtemp(path.join(root, "sandbox-"))
				const now = new Date().toISOString()
				// The hosted control plane answers POST with `provisioning` and flips
				// /status to `ready` once the sandbox is up; the fixture does the same
				// after provisioningDelayMs so cancellation during that window is testable.
				const sandboxType = input.sandboxType === "resumable" ? "resumable" : "standard"
				const record: LocalCloudSessionRecord = {
					id,
					status: "provisioning",
					// Clients tag creates with a request title so a lost response can be recovered.
					...(typeof input.title === "string" ? { title: input.title } : {}),
					sandboxType,
					repoContext: {
						repoUrl: String(input.repoUrl ?? ""),
						branch: typeof input.branch === "string" ? input.branch : undefined,
					},
					metadata: {
						modelId: typeof input.modelId === "string" ? input.modelId : undefined,
						taskId,
						sandboxType,
					},
					createdAt: now,
					updatedAt: now,
				}
				const owned: OwnedSandbox = { record, organizationId, root: sandboxRoot, clients: new Set() }
				sessions.set(id, owned)
				provision(owned)
				if (loseNextCreateResponse) {
					// The sandbox exists, but the client never learns its id.
					loseNextCreateResponse = false
					return json(res, 502, { error: "Bad gateway" })
				}
				return json(res, 200, {
					success: true,
					data: {
						sessionId: id,
						status: record.status,
						...(record.sandboxUrl ? { sandboxUrl: record.sandboxUrl } : {}),
					},
				})
			}

			const match = url.pathname.match(/^\/api\/v1\/session\/([^/]+)(?:\/(status|history|resume))?$/)
			if (!match) return json(res, 404, { error: "Not found" })
			const owned = sessions.get(decodeURIComponent(match[1]))
			if (!owned) return json(res, 404, { error: "Session not found" })
			if (match[2] === "resume" && req.method === "POST") {
				if (owned.record.status !== "suspended") return json(res, 409, { error: "session is not suspended" })
				owned.record.status = "provisioning"
				owned.record.updatedAt = new Date().toISOString()
				provision(owned)
				return json(res, 200, { success: true, data: owned.record })
			}
			if (match[2] === "status" && req.method === "GET") {
				return json(res, 200, {
					success: true,
					data: {
						status: isExpired(owned.record) ? "expired" : owned.record.status,
						...(owned.record.metadata.provisioningPhase ? { phase: owned.record.metadata.provisioningPhase } : {}),
					},
				})
			}
			if (match[2] === "history" && req.method === "GET") {
				// Like the hosted API, the snapshot is the top-level body (no `data`
				// envelope). Live sandboxes have no snapshot yet; the hosted API only
				// stores one when the client disconnects. Expired sessions serve the
				// snapshot they captured, or answer 404 when the sandbox never produced one.
				const snapshot = { version: 1, updated_at: owned.record.expiredAt, sessionId: owned.record.metadata.taskId }
				if (!isExpired(owned.record)) return json(res, 200, { ...snapshot, messages: [] })
				if (!owned.archive) return json(res, 404, { error: "no history captured for this session" })
				return json(res, 200, { ...snapshot, messages: owned.archive })
			}
			if (req.method === "GET") return json(res, 200, { success: true, data: owned.record })
			if (req.method === "PATCH") {
				const input = await readJson(req)
				owned.record.title = typeof input.title === "string" ? input.title : owned.record.title
				return json(res, 200, { success: true, data: owned.record })
			}
			if (req.method === "DELETE") {
				sessions.delete(owned.record.id)
				clearTimeout(owned.readyTimer)
				clearTimeout(owned.suspendTimer)
				await activations.get(owned.record.id)?.catch(() => undefined)
				await owned.hub?.close()
				owned.sessionStore?.close()
				await rm(owned.root, { recursive: true, force: true })
				return json(res, 204)
			}
			return json(res, 405, { error: "Method not allowed" })
		} catch (error) {
			console.error("Local cloud fixture request failed:", error)
			json(res, 500, { error: "Local cloud fixture request failed" })
		}
	})
	server.on("connection", (socket) => {
		sockets.add(socket)
		socket.once("close", () => sockets.delete(socket))
	})
	server.on("upgrade", (request, socket, head) => {
		const url = new URL(request.url ?? "/", apiBaseUrl)
		const match = url.pathname.match(/^\/api\/v1\/session\/([^/]+)$/)
		const owned = match ? sessions.get(decodeURIComponent(match[1])) : undefined
		const presentedToken = request.headers.authorization?.replace(/^Bearer\s+/i, "").replace(/^workos:/i, "")
		if (presentedToken !== accessToken) {
			socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n")
			socket.destroy()
			return
		}
		if (!owned) {
			// The hosted proxy answers a deleted or unknown session this way.
			const body = JSON.stringify({ error: "session not found", success: false })
			socket.end(
				`HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
			)
			return
		}
		if (isExpired(owned.record)) {
			const body = JSON.stringify({ error: "session expired", success: false })
			socket.end(
				`HTTP/1.1 410 Gone\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
			)
			return
		}
		if (owned.record.status === "suspended") {
			const body = JSON.stringify({ error: "session is suspended; resume it before connecting" })
			socket.end(
				`HTTP/1.1 409 Conflict\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
			)
			return
		}
		if (options.refuseSessionSockets) {
			socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n")
			socket.destroy()
			return
		}
		void activateSession(owned.record.id)
			.then((active) => {
				if (disposing) {
					socket.destroy()
					return
				}
				if (!active.hub) throw new Error("Local cloud session did not start a Hub")
				const upstream = new WebSocket(active.hub.url, [`${HUB_AUTH_PROTOCOL_PREFIX}${active.hub.authToken}`])
				bridgedSockets.add(upstream)
				// Either side can drop without a close frame (an extension host that
				// reloads, a Hub that is disposed mid-handshake). Every error, at any
				// point in the socket's life, ends that socket; an unhandled "error"
				// would exit the fixture process.
				const bridge = (ws: WebSocket) => {
					ws.once("close", () => bridgedSockets.delete(ws))
					ws.on("error", () => ws.terminate())
				}
				bridge(upstream)
				upstream.once("error", () => socket.destroy())
				upstream.once("open", () => {
					wss.handleUpgrade(request, socket, head, (downstream: WebSocket) => {
						bridgedSockets.add(downstream)
						bridge(downstream)
						clearTimeout(active.suspendTimer)
						active.suspendTimer = undefined
						active.clients.add(downstream)
						downstream.once("close", () => {
							active.clients.delete(downstream)
							if (active.clients.size === 0 && options.suspendIdleAfterMs !== undefined && !disposing) {
								active.suspendTimer = setTimeout(
									() => void suspendSession(active.record.id).catch(() => undefined),
									options.suspendIdleAfterMs,
								)
							}
						})
						downstream.on("message", (data: RawData, binary: boolean) => upstream.send(data, { binary }))
						upstream.on("message", (data: RawData, binary: boolean) => downstream.send(data, { binary }))
						downstream.once("close", () => upstream.close())
						upstream.once("close", () => downstream.close())
					})
				})
			})
			.catch(() => socket.destroy())
	})

	const disconnectClients = () => {
		for (const ws of bridgedSockets) ws.terminate()
		for (const socket of sockets) socket.destroy()
	}
	let disposal: Promise<void> | undefined
	const dispose = (): Promise<void> => {
		disposal ??= (async () => {
			disposing = true
			disconnectClients()
			try {
				await Promise.allSettled(activations.values())
				const results = await Promise.allSettled(
					[...sessions.values()].map(async ({ hub, sessionStore, readyTimer, suspendTimer }) => {
						clearTimeout(readyTimer)
						clearTimeout(suspendTimer)
						try {
							await hub?.close()
						} finally {
							sessionStore?.close()
						}
					}),
				)
				const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []))
				if (errors.length > 0) throw new AggregateError(errors, "Local cloud sandbox cleanup failed")
			} finally {
				await new Promise<void>((resolve) => server.close(() => resolve()))
				wss.close()
				await rm(root, { recursive: true, force: true })
			}
		})()
		return disposal
	}
	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject)
			server.listen(options.port ?? 0, LOOPBACK_HOST, () => {
				server.removeListener("error", reject)
				resolve()
			})
		})
		const address = server.address()
		if (!address || typeof address === "string") throw new Error("Local cloud fixture did not bind a TCP port")
		apiBaseUrl = `http://${LOOPBACK_HOST}:${address.port}`
	} catch (error) {
		await dispose()
		throw error
	}

	return {
		apiBaseUrl,
		accessToken,
		modelFetch,
		sessions,
		activateSession,
		suspendSession,
		loseNextCreateResponse: () => {
			loseNextCreateResponse = true
		},
		disconnectClients,
		dispose,
	}
}
