import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { Socket } from "node:net"
import { parse } from "node:url"
import { v4 as uuidv4 } from "uuid"
import type { BalanceResponse, OrganizationBalanceResponse, UserResponse } from "../../../../shared/ClineAccount"
import { E2E_MOCK_API_RESPONSES, E2E_REGISTERED_MOCK_ENDPOINTS } from "./api"
import { ClineDataMock } from "./data"

const E2E_API_SERVER_PORT = 7777

export const MOCK_CLINE_API_SERVER_URL = `http://localhost:${E2E_API_SERVER_PORT}`

export class ClineApiServerMock {
	static globalSharedServer: ClineApiServerMock | null = null
	static globalSockets: Set<Socket> = new Set()

	private currentUser: UserResponse | null = null
	private userBalance = 100.5 // Default sufficient balance
	private orgBalance = 500.0
	private userHasOrganization = false
	public generationCounter = 0

	public readonly API_USER = new ClineDataMock("personal")

	constructor(public readonly server: Server) {}

	// Test helper methods
	public setUserBalance(balance: number) {
		this.userBalance = balance
	}

	public setUserHasOrganization(hasOrg: boolean) {
		this.userHasOrganization = hasOrg
		const user = this.currentUser
		if (!user) {
			return
		}
		user.organizations[0].active = hasOrg
		this.setCurrentUser(user)
	}

	public setOrgBalance(balance: number) {
		this.orgBalance = balance
	}

	public setCurrentUser(user: UserResponse | null) {
		this.API_USER.setCurrentUser(user)
		this.currentUser = user
	}

	// Helper to match routes against registered endpoints and extract parameters
	private static matchRoute(
		path: string,
		method: string,
	): {
		matched: boolean
		baseRoute?: string
		endpoint?: string
		params?: Record<string, string>
	} {
		for (const [baseRoute, methods] of Object.entries(E2E_REGISTERED_MOCK_ENDPOINTS)) {
			const methodEndpoints = methods[method as keyof typeof methods]
			if (!methodEndpoints) {
				continue
			}

			for (const endpoint of methodEndpoints) {
				const fullPattern = `${baseRoute}${endpoint}`
				const params: Record<string, string> = {}

				// Convert pattern like "/users/{userId}/balance" to a regex
				const regexPattern = fullPattern.replace(/\{([^}]+)\}/g, () => {
					return "([^/]+)"
				})

				const regex = new RegExp(`^${regexPattern}$`)
				const match = path.match(regex)

				if (match) {
					// Extract parameter names from the pattern
					const paramNames: string[] = []
					const paramRegex = /\{([^}]+)\}/g
					let paramMatch: RegExpExecArray | null = paramRegex.exec(fullPattern)
					while (paramMatch !== null) {
						paramNames.push(paramMatch[1])
						paramMatch = paramRegex.exec(fullPattern)
					}

					// Map captured groups to parameter names
					for (let i = 0; i < paramNames.length; i++) {
						params[paramNames[i]] = match[i + 1]
					}

					return {
						matched: true,
						baseRoute,
						endpoint,
						params,
					}
				}
			}
		}

		return { matched: false }
	}

	// Starts the global shared server
	public static async startGlobalServer(): Promise<ClineApiServerMock> {
		if (ClineApiServerMock.globalSharedServer) {
			return ClineApiServerMock.globalSharedServer
		}

		const server = createServer((req: IncomingMessage, res: ServerResponse) => {
			// Parse URL and method
			const parsedUrl = parse(req.url || "", true)
			const path = parsedUrl.pathname || ""
			const query = parsedUrl.query
			const method = req.method || "GET"

			// Helper to read request body
			const readBody = (): Promise<string> => {
				return new Promise((resolve) => {
					let body = ""
					req.on("data", (chunk) => {
						body += chunk.toString()
					})
					req.on("end", () => resolve(body))
				})
			}

			// Helper to send JSON response
			const sendJson = (data: unknown, status = 200) => {
				res.writeHead(status, { "Content-Type": "application/json" })
				res.end(JSON.stringify(data))
			}

			// Helper to send API response
			const sendApiResponse = (data: unknown, status = 200) => {
				console.log(`API Response: ${JSON.stringify(data)}`)
				sendJson({ success: true, data }, status)
			}

			const sendApiError = (error: string, status = 400) => {
				console.error("API Error: %s", error, status)
				sendJson({ success: false, error }, status)
			}

			// Authentication middleware
			const authHeader = req.headers.authorization
			const isAuthRequired = !path.startsWith("/.test/") && path !== "/health"

			if (isAuthRequired && (!authHeader || !authHeader.startsWith("Bearer "))) {
				return sendApiError("Unauthorized", 401)
			}

			const authToken = authHeader?.substring(7) // Remove "Bearer " prefix

			// Authenticate the token and set current user
			if (isAuthRequired && authToken) {
				console.log(`Authenticating token: ${authToken}`)
				const user = ClineApiServerMock.globalSharedServer!.API_USER.getUserByToken(authToken)
				if (!user) {
					return sendApiError("Invalid token", 401)
				}
				ClineApiServerMock.globalSharedServer!.setCurrentUser(user)
			}

			console.log("=== MOCK SERVER REQUEST ===")
			console.log("Method:", method)
			console.log("Path:", path)
			console.log("Query:", JSON.stringify(query))
			console.log("Headers:", JSON.stringify(req.headers))
			console.log("===============")

			// Route handling
			const handleRequest = async () => {
				// Try to match the route using registered endpoints
				const routeMatch = ClineApiServerMock.matchRoute(path, method)

				if (!routeMatch.matched) {
					return sendJson({ error: "Not found" }, 404)
				}

				const { baseRoute, endpoint, params = {} } = routeMatch
				const controller = ClineApiServerMock.globalSharedServer!

				// Health check endpoints
				if (baseRoute === "/health") {
					if (endpoint === "/" && method === "GET") {
						return sendJson({
							status: "ok",
							timestamp: new Date().toISOString(),
						})
					}
				}

				// API v1 endpoints
				if (baseRoute === "/api/v1") {
					// User endpoints
					if (endpoint === "/users/me" && method === "GET") {
						const currentUser = controller.currentUser
						if (!currentUser) {
							return sendApiError("Unauthorized", 401)
						}
						return sendApiResponse(currentUser)
					}

					if (endpoint === "/users/{userId}/balance" && method === "GET") {
						const { userId } = params
						const balance: BalanceResponse = {
							balance: controller.userBalance,
							userId,
						}
						return sendApiResponse(balance)
					}

					if (endpoint === "/users/{userId}/usages" && method === "GET") {
						const { userId } = params
						const currentUser = controller.currentUser
						if (currentUser?.id !== userId) {
							return sendApiError("Unauthorized", 401)
						}
						return sendApiResponse({
							items: controller.API_USER.getMockUsageTransactions(userId),
						})
					}

					if (endpoint === "/users/{userId}/payments" && method === "GET") {
						const { userId } = params
						const currentUser = controller.currentUser
						if (currentUser?.id !== userId) {
							return sendApiError("Unauthorized", 401)
						}
						return sendApiResponse({
							paymentTransactions: controller.API_USER.getMockPaymentTransactions(userId),
						})
					}

					// Organization endpoints
					if (endpoint === "/organizations/{orgId}/balance" && method === "GET") {
						const { orgId } = params
						const balance: OrganizationBalanceResponse = {
							balance: controller.orgBalance,
							organizationId: orgId,
						}
						return sendApiResponse(balance)
					}

					if (endpoint === "/organizations/{orgId}/members/{memberId}/usages" && method === "GET") {
						const currentUser = controller.currentUser
						if (!currentUser) {
							return sendApiError("Unauthorized", 401)
						}
						const body = await readBody()
						const { orgId } = params
						console.log("Fetching organization usage transactions for", {
							orgId,
							body,
						})
						return sendApiResponse({
							items: controller.API_USER.getMockUsageTransactions(currentUser.id, orgId),
						})
					}

					if (endpoint === "/users/active-account" && method === "PUT") {
						const body = await readBody()
						console.log("Switching active account")
						const { organizationId } = JSON.parse(body)
						controller.setUserHasOrganization(!!organizationId)
						const currentUser = controller.API_USER.getCurrentUser()
						if (!currentUser) {
							return sendApiError("No current user found", 400)
						}
						if (organizationId === null) {
							for (const org of currentUser.organizations) {
								org.active = false
							}
						} else {
							const orgIndex = currentUser.organizations.findIndex((org) => org.organizationId === organizationId)
							if (orgIndex === -1) {
								return sendApiError("Organization not found", 404)
							}
							currentUser.organizations[orgIndex].active = controller.userHasOrganization
						}
						controller.setCurrentUser(currentUser)
						return sendApiResponse("Account switched successfully")
					}

					// Chat completions endpoint
					if (endpoint === "/chat/completions" && method === "POST") {
						if (!controller.userHasOrganization && controller.userBalance <= 0) {
							return sendApiError(
								JSON.stringify({
									code: "insufficient_credits",
									current_balance: controller.userBalance,
									message: "Not enough credits available",
								}),
								402,
							)
						}

						const body = await readBody()
						const parsed = JSON.parse(body)
						const { _messages, model = "claude-3-5-sonnet-20241022", stream = true } = parsed
						let responseText = E2E_MOCK_API_RESPONSES.DEFAULT
						if (body.includes("[replace_in_file for 'test.ts'] Result:")) {
							responseText = E2E_MOCK_API_RESPONSES.REPLACE_REQUEST
						}
						if (body.includes("edit_request")) {
							responseText = E2E_MOCK_API_RESPONSES.EDIT_REQUEST
						}

						const generationId = `gen_${++controller.generationCounter}_${Date.now()}`

						if (stream) {
							res.writeHead(200, {
								"Content-Type": "text/plain",
								"Cache-Control": "no-cache",
								Connection: "keep-alive",
							})

							const randomUUID = uuidv4()

							responseText += `\n\nGenerated UUID: ${randomUUID}`

							const chunks = responseText.split(" ")
							let chunkIndex = 0

							const sendChunk = () => {
								if (chunkIndex < chunks.length) {
									const chunk = {
										id: generationId,
										object: "chat.completion.chunk",
										created: Math.floor(Date.now() / 1000),
										model,
										choices: [
											{
												index: 0,
												delta: {
													content: chunks[chunkIndex] + (chunkIndex < chunks.length - 1 ? " " : ""),
												},
												finish_reason: null,
											},
										],
									}
									res.write(`data: ${JSON.stringify(chunk)}\n\n`)
									chunkIndex++
									setTimeout(sendChunk, 10)
								} else {
									const finalChunk = {
										id: generationId,
										object: "chat.completion.chunk",
										created: Math.floor(Date.now() / 1000),
										model,
										choices: [
											{
												index: 0,
												delta: {},
												finish_reason: "stop",
											},
										],
										usage: {
											prompt_tokens: 140,
											completion_tokens: responseText.length,
											total_tokens: 140 + responseText.length,
											cost: (140 + responseText.length) * 0.00015,
										},
									}
									res.write(`data: ${JSON.stringify(finalChunk)}\n\n`)
									res.write("data: [DONE]\n\n")
									res.end()
								}
							}

							sendChunk()
							return
						} else {
							const response = {
								id: generationId,
								object: "chat.completion",
								created: Math.floor(Date.now() / 1000),
								model,
								choices: [
									{
										index: 0,
										message: {
											role: "assistant",
											content: "Hello! I'm a mock Cline API response.",
										},
										finish_reason: "stop",
									},
								],
								usage: {
									prompt_tokens: 140,
									completion_tokens: responseText.length,
									total_tokens: 140 + responseText.length,
									cost: (140 + responseText.length) * 0.00015,
								},
							}
							return sendJson(response)
						}
					}

					// Generation details endpoint
					if (endpoint === "/generation" && method === "GET") {
						const generationId = query.id as string
						const generation = controller.API_USER.getGeneration(generationId)

						if (!generation) {
							return sendJson({ error: "Generation not found" }, 404)
						}

						return sendJson(generation)
					}
				}

				// Test helper endpoints
				if (baseRoute === "/.test") {
					if (endpoint === "/auth" && method === "POST") {
						const user = controller.API_USER.getUserByToken()
						if (!user) {
							return sendApiError("Invalid token", 401)
						}
						controller.setCurrentUser(user)
						return
					}

					if (endpoint === "/setUserBalance" && method === "POST") {
						const body = await readBody()
						const { balance } = JSON.parse(body)
						controller.setUserBalance(balance)
						res.writeHead(200)
						res.end()
						return
					}

					if (endpoint === "/setUserHasOrganization" && method === "POST") {
						const body = await readBody()
						const { hasOrg } = JSON.parse(body)
						controller.setUserHasOrganization(hasOrg)
						res.writeHead(200)
						res.end()
						return
					}

					if (endpoint === "/setOrgBalance" && method === "POST") {
						const body = await readBody()
						const { balance } = JSON.parse(body)
						controller.setOrgBalance(balance)
						res.writeHead(200)
						res.end()
						return
					}
				}

				// If we get here, the route was matched but not handled
				return sendJson({ error: "Endpoint not implemented" }, 500)
			}

			handleRequest().catch((err) => {
				console.error("Request handling error:", err)
				sendApiError("Internal server error", 500)
			})
		})

		// Initialize the controller after the server is created
		const controller = new ClineApiServerMock(server)
		ClineApiServerMock.globalSharedServer = controller

		// Track connections for proper cleanup
		server.on("connection", (socket) => {
			ClineApiServerMock.globalSockets.add(socket)
			socket.on("close", () => {
				ClineApiServerMock.globalSockets.delete(socket)
			})
		})

		await new Promise<void>((resolve, reject) => {
			server.listen(E2E_API_SERVER_PORT, (error?: Error) => {
				if (error) {
					console.error(`Failed to start server on port ${E2E_API_SERVER_PORT}:`, error)
					reject(error)
				} else {
					console.log(`ClineApiServerMock listening on port ${E2E_API_SERVER_PORT}`)
					resolve()
				}
			})
		})

		return controller
	}

	// Stops the global shared server
	public static async stopGlobalServer(): Promise<void> {
		if (!ClineApiServerMock.globalSharedServer) {
			return
		}

		const server = ClineApiServerMock.globalSharedServer.server

		// Clean shutdown - destroy all socket connections first
		ClineApiServerMock.globalSockets.forEach((socket) => socket.destroy())
		ClineApiServerMock.globalSockets.clear()

		await new Promise<void>((resolve) => {
			server.close(() => resolve())
		})

		ClineApiServerMock.globalSharedServer = null
	}
}
