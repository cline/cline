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

const LOOPBACK_HOST = "127.0.0.1"
const HUB_AUTH_PROTOCOL_PREFIX = "cline-hub-auth."

export interface LocalCloudSessionRecord {
	id: string
	status: string
	title?: string
	sandboxUrl?: string
	repoContext: { repoUrl?: string; branch?: string }
	metadata: { modelId?: string; statusReason?: string }
	expiredAt?: string | null
	createdAt: string
	updatedAt: string
}

interface OwnedSandbox {
	record: LocalCloudSessionRecord
	root: string
	hub?: HubWebSocketServer
	sessionStore?: SqliteSessionStore
}

export interface LocalCloudEnvironment {
	readonly apiBaseUrl: string
	readonly accessToken: string
	readonly sessions: ReadonlyMap<string, OwnedSandbox>
	activateSession(sessionId: string): Promise<OwnedSandbox>
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

function scriptedModelFetch(): typeof fetch {
	const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url)
		if (url.hostname !== "api.cline.bot" || url.pathname !== "/api/v1/chat/completions") {
			throw new Error(`Local cloud fixture blocked unexpected model request to ${url.toString()}`)
		}
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
	options: { port?: number; accessToken?: string } = {},
): Promise<LocalCloudEnvironment> {
	const accessToken = options.accessToken ?? `local-cloud-${randomUUID()}`
	const root = await mkdtemp(path.join(tmpdir(), "cline-local-cloud-"))
	const sessions = new Map<string, OwnedSandbox>()
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
					fetch: scriptedModelFetch(),
				})
				const hub = await startHubWebSocketServer({
					host: LOOPBACK_HOST,
					port: 0,
					workspaceRoot: owned.root,
					owner: { ownerId: sessionId, discoveryPath: path.join(owned.root, "hub.json") },
					eventLog: false,
					runQueue: false,
					sessionHost,
					runtimeHandlers: createLocalHubScheduleRuntimeHandlers({ fetch: scriptedModelFetch() }),
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
			const presentedToken = req.headers.authorization?.replace(/^Bearer\s+/i, "").replace(/^workos:/i, "")
			if (presentedToken !== accessToken) return json(res, 401, { error: "Unauthorized" })
			if (url.pathname === "/api/v1/users/me" && req.method === "GET") {
				const now = new Date().toISOString()
				return json(res, 200, {
					success: true,
					data: {
						id: "local-cloud-user",
						email: "local-cloud@example.test",
						displayName: "Local Cloud Developer",
						organizations: [],
						createdAt: now,
						updatedAt: now,
					},
				})
			}

			if (url.pathname === "/api/v1/integrations/github/repositories" && req.method === "GET") {
				return json(res, 200, {
					success: true,
					data: [
						{
							id: 1,
							name: "fixture",
							full_name: "cline/fixture",
							html_url: "https://github.com/cline/fixture",
							default_branch: "main",
						},
					],
				})
			}
			if (url.pathname === "/api/v1/integrations/github/repositories/1/branches" && req.method === "GET") {
				return json(res, 200, { success: true, data: [{ name: "main" }, { name: "fixture" }] })
			}
			if (url.pathname === "/api/v1/session" && req.method === "GET") {
				return json(res, 200, { success: true, data: [...sessions.values()].map(({ record }) => record) })
			}
			if (url.pathname === "/api/v1/session" && req.method === "POST") {
				const input = await readJson(req)
				const id = `ses-${randomUUID()}`
				const sandboxRoot = await mkdtemp(path.join(root, "sandbox-"))
				const now = new Date().toISOString()
				const record: LocalCloudSessionRecord = {
					id,
					status: "active",
					sandboxUrl: apiBaseUrl,
					repoContext: {
						repoUrl: String(input.repoUrl ?? ""),
						branch: typeof input.branch === "string" ? input.branch : undefined,
					},
					metadata: { modelId: typeof input.modelId === "string" ? input.modelId : undefined },
					createdAt: now,
					updatedAt: now,
				}
				sessions.set(id, { record, root: sandboxRoot })
				return json(res, 200, { success: true, data: { sessionId: id, status: "active", sandboxUrl: apiBaseUrl } })
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
				await activations.get(owned.record.id)?.catch(() => undefined)
				await owned.hub?.close()
				owned.sessionStore?.close()
				await rm(owned.root, { recursive: true, force: true })
				return json(res, 204)
			}
			return json(res, 405, { error: "Method not allowed" })
		} catch (error) {
			json(res, 500, { error: error instanceof Error ? error.message : String(error) })
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

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject)
		server.listen(options.port ?? 0, LOOPBACK_HOST, resolve)
	})
	const address = server.address()
	if (!address || typeof address === "string") throw new Error("Local cloud fixture did not bind a TCP port")
	apiBaseUrl = `http://${LOOPBACK_HOST}:${address.port}`

	return {
		apiBaseUrl,
		accessToken,
		sessions,
		activateSession,
		async dispose() {
			disposing = true
			for (const ws of bridgedSockets) ws.terminate()
			for (const socket of sockets) socket.destroy()
			await Promise.allSettled(activations.values())
			await Promise.allSettled([...sessions.values()].map(({ hub }) => hub?.close()))
			for (const { sessionStore } of sessions.values()) sessionStore?.close()
			await new Promise<void>((resolve) => server.close(() => resolve()))
			wss.close()
			await rm(root, { recursive: true, force: true })
		},
	}
}
