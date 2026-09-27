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
	metadata: { modelId?: string; taskId: string; statusReason?: string }
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
}

export interface LocalCloudEnvironment {
	readonly apiBaseUrl: string
	readonly accessToken: string
	readonly sessions: ReadonlyMap<string, OwnedSandbox>
	activateSession(sessionId: string): Promise<OwnedSandbox>
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

function scriptedModelFetch(beforeResponse?: (signal?: AbortSignal | null) => Promise<void>): typeof fetch {
	const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url)
		if (url.hostname !== "api.cline.bot" || url.pathname !== "/api/v1/chat/completions") {
			throw new Error(`Local cloud fixture blocked unexpected model request to ${url.toString()}`)
		}
		if (init?.signal?.aborted) throw init.signal.reason
		await beforeResponse?.(init?.signal)
		if (init?.signal?.aborted) throw init.signal.reason
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
	} = {},
): Promise<LocalCloudEnvironment> {
	const accessToken = options.accessToken ?? `local-cloud-${randomUUID()}`
	const provisioningDelayMs = options.provisioningDelayMs ?? 0
	const root = await mkdtemp(path.join(options.tempDir ?? tmpdir(), "cline-local-cloud-"))
	const sessions = new Map<string, OwnedSandbox>()
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
					fetch: scriptedModelFetch(options.beforeModelResponse),
				})
				const hub = await startHubWebSocketServer({
					host: LOOPBACK_HOST,
					port: 0,
					workspaceRoot: owned.root,
					owner: { ownerId: sessionId, discoveryPath: path.join(owned.root, "hub.json") },
					eventLog: false,
					runQueue: false,
					sessionHost,
					runtimeHandlers: createLocalHubScheduleRuntimeHandlers({
						fetch: scriptedModelFetch(options.beforeModelResponse),
					}),
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
				const provisioning = provisioningDelayMs > 0
				const record: LocalCloudSessionRecord = {
					id,
					status: provisioning ? "provisioning" : "ready",
					sandboxUrl: provisioning ? undefined : apiBaseUrl,
					repoContext: {
						repoUrl: String(input.repoUrl ?? ""),
						branch: typeof input.branch === "string" ? input.branch : undefined,
					},
					metadata: { modelId: typeof input.modelId === "string" ? input.modelId : undefined, taskId },
					createdAt: now,
					updatedAt: now,
				}
				const owned: OwnedSandbox = { record, organizationId, root: sandboxRoot }
				sessions.set(id, owned)
				if (provisioning) {
					owned.readyTimer = setTimeout(() => {
						owned.readyTimer = undefined
						if (sessions.get(id) !== owned) return
						record.status = "ready"
						record.sandboxUrl = apiBaseUrl
						record.updatedAt = new Date().toISOString()
					}, provisioningDelayMs)
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

			const match = url.pathname.match(/^\/api\/v1\/session\/([^/]+)(?:\/(status|history))?$/)
			if (!match) return json(res, 404, { error: "Not found" })
			const owned = sessions.get(decodeURIComponent(match[1]))
			if (!owned) return json(res, 404, { error: "Session not found" })
			if (match[2] === "status" && req.method === "GET")
				return json(res, 200, { success: true, data: { status: owned.record.status } })
			if (match[2] === "history" && req.method === "GET") return json(res, 200, { success: true, data: { messages: [] } })
			if (req.method === "GET") return json(res, 200, { success: true, data: owned.record })
			if (req.method === "PATCH") {
				const input = await readJson(req)
				owned.record.title = typeof input.title === "string" ? input.title : owned.record.title
				return json(res, 200, { success: true, data: owned.record })
			}
			if (req.method === "DELETE") {
				sessions.delete(owned.record.id)
				clearTimeout(owned.readyTimer)
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
		if (!owned || presentedToken !== accessToken) {
			socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n")
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
				upstream.once("open", () => {
					wss.handleUpgrade(request, socket, head, (downstream: WebSocket) => {
						bridgedSockets.add(downstream)
						downstream.on("message", (data: RawData, binary: boolean) => upstream.send(data, { binary }))
						upstream.on("message", (data: RawData, binary: boolean) => downstream.send(data, { binary }))
						downstream.once("close", () => upstream.close())
						upstream.once("close", () => downstream.close())
						for (const ws of [downstream, upstream]) ws.once("close", () => bridgedSockets.delete(ws))
					})
				})
				upstream.once("error", () => socket.destroy())
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
					[...sessions.values()].map(async ({ hub, sessionStore, readyTimer }) => {
						clearTimeout(readyTimer)
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
		sessions,
		activateSession,
		disconnectClients,
		dispose,
	}
}
