import * as fs from "node:fs/promises"
import { createServer } from "node:http"
import * as os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import WebSocket from "ws"
import { ClineEndpoint, ClineEnv, Environment } from "@/config"
import { startLocalCloudDevelopment } from "@/dev/local-cloud-development"
import { CloudSessionsService, isCloudSessionExpired } from "@/services/cloud/CloudSessionsService"
import type { UserResponse } from "@/shared/ClineAccount"
import { startLocalCloudEnvironment } from "./local-cloud-environment"

vi.mock("node:fs/promises", async (original) => {
	const actual = await original<typeof import("node:fs/promises")>()
	return { ...actual, writeFile: vi.fn(actual.writeFile) }
})

describe("local cloud development ownership", () => {
	afterEach(() => {
		vi.restoreAllMocks()
		vi.unstubAllEnvs()
	})

	it("removes both roots when a real listener already owns the requested port", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-startup-test-"))
		const listener = createServer()
		try {
			await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve))
			const address = listener.address()
			if (!address || typeof address === "string") throw new Error("No port")
			await expect(startLocalCloudDevelopment({ port: address.port, tempDir })).rejects.toMatchObject({
				code: "EADDRINUSE",
			})
			expect(await fs.readdir(tempDir)).toEqual([])
			expect(listener.listening).toBe(true)
		} finally {
			await new Promise<void>((resolve) => listener.close(() => resolve()))
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	})

	it("closes a bound fixture and removes its profile when writing settings fails", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-startup-test-"))
		const write = vi.spyOn(fs, "writeFile").mockRejectedValueOnce(new Error("disk full"))
		try {
			await expect(startLocalCloudDevelopment({ port: 0, tempDir })).rejects.toThrow("disk full")
			expect(await fs.readdir(tempDir)).toEqual([])
		} finally {
			write.mockRestore()
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	})

	it("generates app and GitHub links through the real extension environment and service", async () => {
		const development = await startLocalCloudDevelopment({ port: 0 })
		try {
			vi.stubEnv("HOME", development.clineDir)
			vi.stubEnv("USERPROFILE", development.clineDir)
			for (const [key, value] of Object.entries(development.launchEnv)) vi.stubEnv(key, value)
			await ClineEndpoint.initialize(development.clineDir)
			const service = new CloudSessionsService({
				getAuthToken: async () => development.environment.accessToken,
				getActiveOrganizationId: () => undefined,
			})
			expect(ClineEnv.config().apiBaseUrl).toBe(development.environment.apiBaseUrl)
			expect(ClineEnv.config().mcpBaseUrl).toBe(`${development.environment.apiBaseUrl}/v1/mcp`)
			for (const url of [service.dashboardUrl("ses-local"), service.githubConnectUrl()]) {
				expect(new URL(url).origin).toBe(development.environment.apiBaseUrl)
				expect((await fetch(url)).status).toBe(200)
			}
			vi.stubEnv("CLINE_LOCAL_CLOUD_URL", "https://example.com")
			expect(() => ClineEnv.config()).toThrow("loopback")
			ClineEnv.setEnvironment(Environment.production)
			expect(ClineEnv.config().appBaseUrl).toBe("https://app.cline.bot")
		} finally {
			await Promise.all([development.dispose(), development.dispose()])
			await expect(fs.access(development.clineDir)).rejects.toThrow()
		}
	})

	it("seeds the current provider and onboarding storage contracts", async () => {
		const development = await startLocalCloudDevelopment({ port: 0 })
		try {
			const globalState = JSON.parse(
				await fs.readFile(path.join(development.clineDir, "data", "globalState.json"), "utf8"),
			) as Record<string, unknown>
			const providers = JSON.parse(
				await fs.readFile(path.join(development.clineDir, "data", "settings", "providers.json"), "utf8"),
			) as {
				lastUsedProvider?: string
				providers: Record<
					string,
					{
						settings?: { provider?: string; auth?: { accessToken?: string; accountId?: string } }
						tokenSource?: string
					}
				>
			}

			expect(globalState.welcomeViewCompleted).toBe(true)
			expect(providers.lastUsedProvider).toBe("cline")
			expect(providers.providers.cline).toMatchObject({
				settings: {
					provider: "cline",
					auth: {
						accessToken: `workos:${development.environment.accessToken}`,
						accountId: "local-cloud-user",
					},
				},
				tokenSource: "oauth",
			})
		} finally {
			await development.dispose()
		}
	})

	it("switches the fixture account over HTTP and keeps repositories and session lists scoped", async () => {
		const development = await startLocalCloudDevelopment({ port: 0 })
		const { environment } = development
		const headers = { Authorization: `Bearer workos:${environment.accessToken}`, "Content-Type": "application/json" }
		let activeOrganizationId: string | null = null
		const service = new CloudSessionsService({
			apiBaseUrl: environment.apiBaseUrl,
			appBaseUrl: environment.apiBaseUrl,
			getAuthToken: async () => `workos:${environment.accessToken}`,
			getActiveOrganizationId: () => activeOrganizationId,
		})
		const refreshUser = async () => {
			const response = await fetch(`${environment.apiBaseUrl}/api/v1/users/me`, { headers })
			expect(response.status).toBe(200)
			const { data } = (await response.json()) as { data: UserResponse }
			activeOrganizationId = data.organizations.find((organization) => organization.active)?.organizationId ?? null
			return data
		}
		const switchAccount = async (organizationId: string | null) => {
			const response = await fetch(`${environment.apiBaseUrl}/api/v1/users/active-account`, {
				method: "PUT",
				headers,
				body: JSON.stringify({ organizationId }),
			})
			expect(response.status).toBe(200)
			expect(await response.json()).toEqual({ success: true, data: expect.any(String) })
			await refreshUser()
			expect(activeOrganizationId).toBe(organizationId)
		}
		try {
			const user = await refreshUser()
			expect(user.organizations).toEqual([
				{
					active: false,
					memberId: "local-cloud-member",
					name: "Local Cloud QA",
					organizationId: "local-cloud-organization",
					roles: ["owner"],
				},
			])
			const personal = await service.getGitHubConnection()
			expect(personal.repositories).toMatchObject([{ id: 1, fullName: "cline/fixture" }])
			expect(await service.listBranches(1)).toEqual(["main", "fixture"])
			const personalSession = await service.createSession({
				modelId: "fixture-model",
				repoUrl: personal.repositories[0].url,
			})
			await service.renameSession(personalSession.id, "Personal history")

			await switchAccount(user.organizations[0].organizationId)
			const organization = await service.getGitHubConnection()
			expect(organization).toMatchObject({
				connected: true,
				connectUrl: `${environment.apiBaseUrl}/dashboard/organization/integrations`,
				repositories: [{ id: 2, fullName: "cline/organization-fixture" }],
			})
			expect(await service.listBranches(2)).toEqual(["main", "organization-fixture"])
			// A repository outside the account scope has no branches to offer, rather than an error.
			expect(await service.listBranches(1)).toEqual([])
			expect(await service.listSessions()).toEqual([])
			expect(await service.getSession(personalSession.id)).toBeUndefined()
			const organizationSession = await service.createSession({
				modelId: "fixture-model",
				repoUrl: organization.repositories[0].url,
			})
			await service.renameSession(organizationSession.id, "Organization history")
			expect(await service.listSessions()).toEqual([
				expect.objectContaining({ id: organizationSession.id, title: "Organization history" }),
			])
			// An omitted organizationId remains Personal even while the profile selects an org.
			const personalList = await fetch(`${environment.apiBaseUrl}/api/v1/session`, { headers })
			expect(await personalList.json()).toMatchObject({ data: [{ id: personalSession.id }] })

			await switchAccount(null)
			expect(await service.getGitHubConnection()).toEqual(personal)
			expect(await service.listBranches(2)).toEqual([])
			expect(await service.listSessions()).toEqual([
				expect.objectContaining({ id: personalSession.id, title: "Personal history" }),
			])
			expect(await service.getSession(organizationSession.id)).toBeUndefined()
			await switchAccount(user.organizations[0].organizationId)
			expect(await service.listSessions()).toEqual([
				expect.objectContaining({ id: organizationSession.id, title: "Organization history" }),
			])
		} finally {
			await development.dispose()
		}
	})

	it("serves fixture credit and disabled remote config contracts without external requests", async () => {
		const environment = await startLocalCloudEnvironment()
		const headers = { Authorization: `Bearer ${environment.accessToken}` }
		try {
			const profile = await fetch(`${environment.apiBaseUrl}/api/v1/users/me`, { headers })
			const { data: user } = (await profile.json()) as { data: UserResponse }
			const [organization] = user.organizations
			const userPath = `/api/v1/users/${user.id}`
			const organizationPath = `/api/v1/organizations/${organization.organizationId}`
			const responses = [
				[`${userPath}/balance`, { balance: 100, userId: user.id }],
				[`${userPath}/usages`, { items: [] }],
				[`${userPath}/payments`, { paymentTransactions: [] }],
				[`${organizationPath}/balance`, { balance: 250, organizationId: organization.organizationId }],
				[`${organizationPath}/members/${organization.memberId}/usages`, { items: [] }],
				["/api/v1/users/me/remote-config", null],
				[`${organizationPath}/remote-config`, { enabled: false, value: "{}" }],
			] as const
			for (const [endpoint, data] of responses) {
				const response = await fetch(`${environment.apiBaseUrl}${endpoint}`, { headers })
				expect(response.status, endpoint).toBe(200)
				expect(await response.json(), endpoint).toEqual({ success: true, data })
			}
		} finally {
			await environment.dispose()
		}
	})

	it("rejects unauthorized switches and unknown organization scopes without changing fixture state", async () => {
		const environment = await startLocalCloudEnvironment()
		const headers = { Authorization: `Bearer ${environment.accessToken}`, "Content-Type": "application/json" }
		try {
			const unauthorized = await fetch(`${environment.apiBaseUrl}/api/v1/users/active-account`, {
				method: "PUT",
				body: JSON.stringify({ organizationId: "local-cloud-organization" }),
			})
			expect(unauthorized.status).toBe(401)
			for (const [endpoint, method] of [
				["/api/v1/users/active-account", "PUT"],
				["/api/v1/session", "POST"],
				["/api/v1/session?organizationId=unknown", "GET"],
				["/api/v1/organizations/unknown/integrations/github/repositories", "GET"],
			] as const) {
				const response = await fetch(`${environment.apiBaseUrl}${endpoint}`, {
					method,
					headers,
					...(method !== "GET" ? { body: JSON.stringify({ organizationId: "unknown" }) } : {}),
				})
				expect(response.status, endpoint).toBe(403)
			}
			const profile = await fetch(`${environment.apiBaseUrl}/api/v1/users/me`, { headers })
			expect(await profile.json()).toMatchObject({ data: { organizations: [{ active: false }] } })
			expect(environment.sessions.size).toBe(0)
		} finally {
			await environment.dispose()
		}
	})

	it("serves seeded expired sessions as archived-or-missing history and refuses their sandbox connection", async () => {
		vi.stubEnv("CLINE_LOCAL_CLOUD_SEED_EXPIRED", "1")
		const development = await startLocalCloudDevelopment({ port: 0 })
		const { environment } = development
		const service = new CloudSessionsService({
			apiBaseUrl: environment.apiBaseUrl,
			getAuthToken: async () => environment.accessToken,
			getActiveOrganizationId: () => undefined,
		})
		try {
			const sessions = await service.listSessions()
			expect(sessions.map((record) => record.title).sort()).toEqual(["Archived fixture task", "Unarchived fixture task"])
			for (const record of sessions) {
				expect(record.status).toBe("active")
				expect(isCloudSessionExpired(record)).toBe(true)
				expect(record.repoContext).toEqual({ repoUrl: "https://github.com/cline/fixture", branch: "main" })
				expect(Date.parse(record.createdAt)).toBeLessThan(Date.parse(record.expiredAt ?? ""))
				expect(await service.getStatus(record.id)).toEqual({ status: "expired" })
				const upgrade = await new Promise<{ status: number; body: string }>((resolve, reject) => {
					const socket = new WebSocket(service.sessionSocketUrl(record.id), {
						headers: { Authorization: `Bearer ${environment.accessToken}` },
					})
					socket.once("unexpected-response", (_request, response) => {
						const chunks: Buffer[] = []
						response.on("data", (chunk: Buffer) => chunks.push(chunk))
						response.once("end", () =>
							resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
						)
					})
					socket.once("open", () => reject(new Error("Expired session accepted a WebSocket upgrade")))
					socket.once("error", reject)
				})
				expect(upgrade.status).toBe(410)
				expect(JSON.parse(upgrade.body)).toEqual({ error: "session expired", success: false })
			}
			const archived = sessions.find((record) => record.title === "Archived fixture task")
			const unarchived = sessions.find((record) => record.title === "Unarchived fixture task")
			if (!archived || !unarchived) throw new Error("Expected both seeded sessions")
			expect(await service.getHistory(archived.id)).toEqual([
				expect.objectContaining({ role: "user", sessionId: archived.metadata.taskId }),
				expect.objectContaining({
					role: "assistant",
					content: [{ type: "text", text: "cloud fixture reply" }],
					sessionId: archived.metadata.taskId,
				}),
			])
			expect(await service.getHistory(unarchived.id)).toBeNull()
			const missing = await fetch(`${environment.apiBaseUrl}/api/v1/session/${unarchived.id}/history`, {
				headers: { Authorization: `Bearer ${environment.accessToken}` },
			})
			expect(missing.status).toBe(404)
			expect(await missing.json()).toEqual({ error: "no history captured for this session" })
			const live = await service.createSession({ modelId: "fixture-model", repoUrl: "https://github.com/cline/fixture" })
			expect(await service.getHistory(live.id)).toEqual([])
		} finally {
			await development.dispose()
		}
	})

	it("scripts the hosted insufficient-credits reply for every model request", async () => {
		vi.stubEnv("CLINE_LOCAL_CLOUD_INSUFFICIENT_CREDITS", "1")
		const development = await startLocalCloudDevelopment({ port: 0 })
		try {
			const response = await development.environment.modelFetch("https://api.cline.bot/api/v1/chat/completions", {
				method: "POST",
				body: "{}",
			})
			expect(response.status).toBe(402)
			expect(response.headers.get("content-type")).toBe("application/json")
			expect(await response.json()).toEqual({
				error: {
					code: "insufficient_credits",
					message: "Not enough credits available",
					current_balance: 0.01,
					total_spent: 4.99,
					total_promotions: 0,
					buy_credits_url: "http://127.0.0.1/credits",
				},
			})
		} finally {
			await development.dispose()
		}
	})

	it("removes a fixture root on invalid bind arguments as well as listener errors", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-startup-test-"))
		try {
			await expect(startLocalCloudEnvironment({ tempDir, port: -1 })).rejects.toThrow()
			expect(await fs.readdir(tempDir)).toEqual([])
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	})

	it("reports sandbox cleanup failure after closing the listener and removing the profile", async () => {
		const development = await startLocalCloudDevelopment({ port: 0 })
		const service = new CloudSessionsService({
			apiBaseUrl: development.environment.apiBaseUrl,
			getAuthToken: async () => development.environment.accessToken,
			getActiveOrganizationId: () => undefined,
		})
		const record = await service.createSession({ modelId: "fixture-model", repoUrl: "https://github.com/cline/fixture" })
		const sandbox = await development.environment.activateSession(record.id)
		if (!sandbox.hub) throw new Error("Expected a real Hub")
		const close = sandbox.hub.close.bind(sandbox.hub)
		vi.spyOn(sandbox.hub, "close").mockImplementation(async () => {
			await close()
			throw new Error("cleanup failure")
		})
		await expect(development.dispose()).rejects.toThrow("Local cloud sandbox cleanup failed")
		await expect(fs.access(development.clineDir)).rejects.toThrow()
		await expect(fetch(`${development.environment.apiBaseUrl}/health`)).rejects.toThrow()
		await expect(development.dispose()).rejects.toThrow("Local cloud sandbox cleanup failed")
	})
})
