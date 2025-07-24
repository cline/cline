import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http"
import { parse } from "node:url"
import { v4 as uuidv4 } from "uuid"
import type { Socket } from "node:net"
import type { BalanceResponse, OrganizationBalanceResponse, UserResponse } from "../../../../shared/ClineAccount"
import { ClineApiMock } from "./api"

const E2E_API_SERVER_PORT = 7777

export const MOCK_CLINE_API_SERVER_URL = `http://localhost:${E2E_API_SERVER_PORT}`

const CLINE_USER_MOCK = new ClineApiMock("personal")

export class ClineApiServerMock {
	private currentUser: UserResponse | null = null
	private userBalance = 100.5 // Default sufficient balance
	private orgBalance = 500.0
	private userHasOrganization = false
	private generationCounter = 0

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
		this.currentUser = user
		CLINE_USER_MOCK.setCurrentUser(user)
	}

	// Runs a mock Cline API server for testing
	public static async run<T>(around: (server: ClineApiServerMock) => Promise<T>): Promise<T> {
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
					req.on("data", (chunk) => (body += chunk.toString()))
					req.on("end", () => resolve(body))
				})
			}

			// Helper to send JSON response
			const sendJson = (data: any, status = 200) => {
				res.writeHead(status, { "Content-Type": "application/json" })
				res.end(JSON.stringify(data))
			}

			// Helper to send API response
			const sendApiResponse = (data: any, status = 200) => {
				console.log(`API Response: ${JSON.stringify(data)}`)
				sendJson({ success: true, data }, status)
			}

			const sendApiError = (error: string, status = 400) => {
				console.error(`API Error: ${error}`, status)
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
				const user = CLINE_USER_MOCK.getUserByToken(authToken)
				if (!user) {
					return sendApiError("Invalid token", 401)
				}
				controller.setCurrentUser(user)
			}

			console.log(`Received ${method} request for ${path} with query`, query)

			// Route handling
			const handleRequest = async () => {
				// Health check
				if (path === "/health" && method === "GET") {
					return sendJson({ status: "ok", timestamp: new Date().toISOString() })
				}

				// User endpoints
				if (path === "/api/v1/users/me" && method === "GET") {
					const currentUser = controller.currentUser
					if (!currentUser) {
						return sendApiError("Unauthorized", 401)
					}
					return sendApiResponse(currentUser)
				}

				if (path.match(/^\/api\/v1\/users\/(.+)\/balance$/) && method === "GET") {
					const userId = path.split("/")[4]
					const balance: BalanceResponse = {
						balance: controller.userBalance,
						userId,
					}
					return sendApiResponse(balance)
				}

				if (path.match(/^\/api\/v1\/users\/(.+)\/usages$/) && method === "GET") {
					const currentUser = controller.currentUser
					if (!currentUser) {
						return sendApiError("Unauthorized", 401)
					}
					return sendApiResponse({ items: CLINE_USER_MOCK.getMockUsageTransactions(currentUser.id) })
				}

				if (path.match(/^\/api\/v1\/users\/(.+)\/payments$/) && method === "GET") {
					const currentUser = controller.currentUser
					if (!currentUser) {
						return sendApiError("Unauthorized", 401)
					}
					return sendApiResponse({ paymentTransactions: CLINE_USER_MOCK.getMockPaymentTransactions(currentUser.id) })
				}

				// Organization endpoints
				if (path.match(/^\/api\/v1\/organizations\/(.+)\/balance$/) && method === "GET") {
					const orgId = path.split("/")[4]
					const balance: OrganizationBalanceResponse = {
						balance: controller.orgBalance,
						organizationId: orgId,
					}
					return sendApiResponse(balance)
				}

				if (path.match(/^\/api\/v1\/organizations\/(.+)\/members\/(.+)\/usages$/) && method === "GET") {
					const currentUser = controller.currentUser
					if (!currentUser) {
						return sendApiError("Unauthorized", 401)
					}
					const body = await readBody()
					const { organizationId } = JSON.parse(body)
					return sendApiResponse({ items: CLINE_USER_MOCK.getMockUsageTransactions(currentUser.id, organizationId) })
				}

				if (path === "/api/v1/users/active-account" && method === "PUT") {
					const body = await readBody()
					const { organizationId } = JSON.parse(body)
					controller.userHasOrganization = !!organizationId
					const currentUser = CLINE_USER_MOCK.getCurrentUser()
					if (!currentUser) {
						return sendApiError("No current user found", 400)
					}
					currentUser.organizations[0].active = controller.userHasOrganization
					return sendApiResponse("Account switched successfully")
				}

				// Chat completions endpoint
				if (path === "/api/v1/chat/completions" && method === "POST") {
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
					const { messages, model = "claude-3-5-sonnet-20241022", stream = true } = parsed

					const generationId = `gen_${++controller.generationCounter}_${Date.now()}`

					if (stream) {
						res.writeHead(200, {
							"Content-Type": "text/plain",
							"Cache-Control": "no-cache",
							Connection: "keep-alive",
						})

						const randomUUID = uuidv4()
						let responseText = "Hello! I'm a mock Cline API response."
						if (body.includes("[replace_in_file for 'test.ts'] Result:")) {
							responseText =
								'I successfully replaced "john" with "cline" in the test.ts file. The change has been completed and the file now contains:\n\n```typescript\nexport const name = "cline"\n```\n\nThe TypeScript errors shown in the output are unrelated to this change - they appear to be existing issues in the broader codebase related to missing type definitions and dependencies. The specific task of updating the name in test.ts has been completed successfully.\n\n<attempt_completion>\n<result>\nI have successfully replaced the name "john" with "cline" in the test.ts file. The file now exports:\n\n```typescript\nexport const name = "cline"\n```\n\nThe change has been applied and saved to the file.\n</result>\n</attempt_completion>'
						}
						if (body.includes("edit_request")) {
							responseText =
								'<thinking>\nThe user wants me to replace the name "john" with "cline" in the test.ts file. I can see the file content provided:\n\n```typescript\nexport const name = "john"\n```\n\nI need to change "john" to "cline". This is a simple targeted edit, so I should use the replace_in_file tool rather than write_to_file since I\'m only changing one small part of the file.\n\nI need to:\n1. Use replace_in_file to change "john" to "cline" in the test.ts file\n2. The SEARCH block should match the exact content: `export const name = "john"`\n3. The REPLACE block should be: `export const name = "cline"`\n</thinking>\n\nI\'ll replace "john" with "cline" in the test.ts file.\n\n<replace_in_file>\n<path>test.ts</path>\n<diff>\n------- SEARCH\nexport const name = "john"\n=======\nexport const name = "cline"\n+++++++ REPLACE\n</diff>\n</replace_in_file>'
						}

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
								setTimeout(sendChunk, 50)
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
										prompt_tokens: 150,
										completion_tokens: 75,
										total_tokens: 225,
										cost: 0.025,
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
								prompt_tokens: 150,
								completion_tokens: 75,
								total_tokens: 225,
								cost: 0.025,
							},
						}
						return sendJson(response)
					}
				}

				// Generation details endpoint
				if (path === "/generation" && method === "GET") {
					const generationId = query.id as string
					const generation = CLINE_USER_MOCK.getGeneration(generationId)

					if (!generation) {
						return sendJson({ error: "Generation not found" }, 404)
					}

					return sendJson(generation)
				}

				// Test helper endpoints
				if (path === "/.test/auth" && method === "POST") {
					const user = CLINE_USER_MOCK.getUserByToken()
					if (!user) {
						return sendApiError("Invalid token", 401)
					}
					controller.setCurrentUser(user)
					return
				}

				if (path === "/.test/setUserBalance" && method === "POST") {
					const body = await readBody()
					const { balance } = JSON.parse(body)
					controller.setUserBalance(balance)
					res.writeHead(200)
					res.end()
					return
				}

				if (path === "/.test/setUserHasOrganization" && method === "POST") {
					const body = await readBody()
					const { hasOrg } = JSON.parse(body)
					controller.setUserHasOrganization(hasOrg)
					res.writeHead(200)
					res.end()
					return
				}

				if (path === "/.test/setOrgBalance" && method === "POST") {
					const body = await readBody()
					const { balance } = JSON.parse(body)
					controller.setOrgBalance(balance)
					res.writeHead(200)
					res.end()
					return
				}

				// 404 for unmatched routes
				sendJson({ error: "Not found" }, 404)
			}

			handleRequest().catch((err) => {
				console.error("Request handling error:", err)
				sendApiError("Internal server error", 500)
			})
		})

		const controller = new ClineApiServerMock(server)

		server.listen(E2E_API_SERVER_PORT)

		// Track connections for proper cleanup
		const sockets = new Set<Socket>()
		server.on("connection", (socket) => sockets.add(socket))

		const result = await around(controller)

		// Clean shutdown
		const serverClosed = new Promise((resolve) => server.close(resolve))
		for (const socket of sockets) {
			socket.destroy()
		}
		await serverClosed

		return result
	}
}
