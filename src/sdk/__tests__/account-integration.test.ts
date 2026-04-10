/**
 * Account Integration Tests
 *
 * Tests account-related functionality with mocked Cline backend:
 * - Credit balance fetch (user and organization)
 * - Logout (clears credentials)
 * - Organization switching
 * - Credit balance refresh after org switch
 *
 * These tests use a mock HTTP server to simulate the Cline API,
 * ensuring we don't regress on account-related issues from CAVEATS.md:
 * - "Current balance is ----" (getUserCredits returned undefined)
 * - "Logout button does nothing" (accountLogoutClicked was a stub)
 * - "Low credit balance persists after account switching" (setUserOrganization was a stub)
 */

import * as fs from "node:fs"
import * as http from "node:http"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

// Mock heavy dependencies that grpc-handler pulls in transitively
vi.mock("../../core/controller/models/refreshClineModels", () => ({
	readClineModelsFromCache: vi.fn().mockResolvedValue(null),
}))
vi.mock("../../shared/proto-conversions/models/typeConversion", () => ({
	toProtobufModels: vi.fn().mockReturnValue({}),
}))
vi.mock("../../utils/shell", () => ({
	getAvailableTerminalProfiles: vi.fn().mockReturnValue([]),
}))

import { LegacyStateReader } from "../legacy-state-reader"
import { SdkController } from "../SdkController"

// ---------------------------------------------------------------------------
// Mock HTTP server simulating the Cline credits API
// ---------------------------------------------------------------------------

interface MockServerState {
	userBalance: number
	orgBalances: Record<string, number>
	requestLog: Array<{ method: string; url: string; headers: Record<string, string> }>
}

function createMockClineServer(state: MockServerState): http.Server {
	return http.createServer((req, res) => {
		state.requestLog.push({
			method: req.method ?? "GET",
			url: req.url ?? "",
			headers: req.headers as Record<string, string>,
		})

		res.setHeader("Content-Type", "application/json")

		// GET /api/v1/users/:userId/balance → user balance
		// Matches the real ClineAccountService.fetchBalanceRPC() endpoint
		const userBalanceMatch = req.url?.match(/^\/api\/v1\/users\/([^/]+)\/balance$/)
		if (userBalanceMatch) {
			res.writeHead(200)
			res.end(
				JSON.stringify({
					data: { userId: userBalanceMatch[1], balance: state.userBalance },
					success: true,
				}),
			)
			return
		}

		// GET /api/v1/organizations/:orgId/balance → org balance
		// Matches the real ClineAccountService.fetchOrganizationBalanceRPC() endpoint
		const orgBalanceMatch = req.url?.match(/^\/api\/v1\/organizations\/([^/]+)\/balance$/)
		if (orgBalanceMatch) {
			const orgId = orgBalanceMatch[1]
			const balance = state.orgBalances[orgId]
			if (balance !== undefined) {
				res.writeHead(200)
				res.end(
					JSON.stringify({
						data: { organizationId: orgId, balance },
						success: true,
					}),
				)
			} else {
				res.writeHead(404)
				res.end(JSON.stringify({ error: "Organization not found" }))
			}
			return
		}

		// Unknown endpoint
		res.writeHead(404)
		res.end(JSON.stringify({ error: "Not found" }))
	})
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createTestDataDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-account-test-"))
	// Create required subdirectories
	fs.mkdirSync(path.join(dir, "state"), { recursive: true })
	fs.mkdirSync(path.join(dir, "settings"), { recursive: true })
	return dir
}

function writeAuthCredentials(
	dataDir: string,
	opts: {
		idToken?: string
		userId?: string
		email?: string
		displayName?: string
		appBaseUrl?: string
		organizations?: Array<{ organizationId: string; name: string; active: boolean; memberId: string; roles?: string[] }>
	},
) {
	const secretsPath = path.join(dataDir, "secrets.json")
	const creds = {
		idToken: opts.idToken ?? "test-token-123",
		provider: "test",
		userInfo: {
			id: opts.userId ?? "usr-test-1",
			email: opts.email ?? "test@example.com",
			displayName: opts.displayName ?? "Test User",
			appBaseUrl: opts.appBaseUrl,
			organizations: opts.organizations ?? [],
		},
	}
	fs.writeFileSync(secretsPath, JSON.stringify({ "cline:clineAccountId": JSON.stringify(creds) }), {
		mode: 0o600,
	})
}

function writeGlobalState(dataDir: string, state: Record<string, unknown>) {
	fs.writeFileSync(path.join(dataDir, "globalState.json"), JSON.stringify(state))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Account Integration", () => {
	let mockServer: http.Server
	let mockState: MockServerState
	let mockBaseUrl: string
	let dataDir: string

	beforeAll(async () => {
		mockState = {
			userBalance: 125000, // 12.5 credits in microcredits
			orgBalances: {
				"org-alpha": 500000, // 50 credits
				"org-beta": 10000, // 1 credit (low balance)
			},
			requestLog: [],
		}
		mockServer = createMockClineServer(mockState)
		await new Promise<void>((resolve) => {
			mockServer.listen(0, "127.0.0.1", () => resolve())
		})
		const addr = mockServer.address() as { port: number }
		mockBaseUrl = `http://127.0.0.1:${addr.port}`
	})

	afterAll(async () => {
		await new Promise<void>((resolve) => mockServer.close(() => resolve()))
	})

	beforeEach(() => {
		dataDir = createTestDataDir()
		mockState.requestLog = []
	})

	afterEach(() => {
		fs.rmSync(dataDir, { recursive: true, force: true })
	})

	// -----------------------------------------------------------------------
	// Use case: Fetch user credit balance
	// -----------------------------------------------------------------------

	describe("getUserCredits", () => {
		it("should return real balance from Cline API", async () => {
			writeAuthCredentials(dataDir, { appBaseUrl: mockBaseUrl })
			writeGlobalState(dataDir, { welcomeViewCompleted: true })

			const legacyState = new LegacyStateReader({ dataDir })
			const controller = new SdkController({ legacyState, cwd: dataDir })
			const handler = controller.getGrpcHandler()

			const result = await handler.handleRequest({ method: "getUserCredits" })

			expect(result.error).toBeUndefined()
			const data = result.data as { balance?: { currentBalance: number } }
			expect(data.balance).toBeDefined()
			// Mock returns 125000; SdkController divides by 100 → 1250
			expect(data.balance?.currentBalance).toBe(1250)

			// Verify auth header was sent with workos: prefix to the v1 balance endpoint
			const creditsReq = mockState.requestLog.find((r) => r.url?.startsWith("/api/v1/users/"))
			expect(creditsReq).toBeDefined()
			expect(creditsReq?.headers.authorization).toBe("Bearer workos:test-token-123")
		})

		it("should return undefined balance when not authenticated", async () => {
			writeGlobalState(dataDir, { welcomeViewCompleted: true })
			// No auth credentials written

			const legacyState = new LegacyStateReader({ dataDir })
			const controller = new SdkController({ legacyState, cwd: dataDir })
			const handler = controller.getGrpcHandler()

			const result = await handler.handleRequest({ method: "getUserCredits" })

			expect(result.error).toBeUndefined()
			const data = result.data as { balance?: unknown }
			expect(data.balance).toBeUndefined()
		})
	})

	// -----------------------------------------------------------------------
	// Use case: Fetch organization credit balance
	// -----------------------------------------------------------------------

	describe("getOrganizationCredits", () => {
		it("should return org balance from Cline API", async () => {
			writeAuthCredentials(dataDir, {
				appBaseUrl: mockBaseUrl,
				organizations: [{ organizationId: "org-alpha", name: "Alpha Corp", active: true, memberId: "mem-1" }],
			})
			writeGlobalState(dataDir, { welcomeViewCompleted: true })

			const legacyState = new LegacyStateReader({ dataDir })
			const controller = new SdkController({ legacyState, cwd: dataDir })
			const handler = controller.getGrpcHandler()

			const result = await handler.handleRequest({
				method: "getOrganizationCredits",
				params: { organizationId: "org-alpha" },
			})

			expect(result.error).toBeUndefined()
			const data = result.data as { balance?: { currentBalance: number } }
			expect(data.balance).toBeDefined()
			// Mock returns 500000; SdkController divides by 100 → 5000
			expect(data.balance?.currentBalance).toBe(5000)
		})
	})

	// -----------------------------------------------------------------------
	// Use case: Logout clears credentials
	// -----------------------------------------------------------------------

	describe("accountLogoutClicked", () => {
		it("should clear auth credentials from disk", async () => {
			writeAuthCredentials(dataDir, { appBaseUrl: mockBaseUrl })
			writeGlobalState(dataDir, { welcomeViewCompleted: true })

			const legacyState = new LegacyStateReader({ dataDir })
			const controller = new SdkController({ legacyState, cwd: dataDir })
			const handler = controller.getGrpcHandler()

			// Verify auth exists before logout
			expect(legacyState.readClineAuthInfo()).not.toBeNull()

			// Logout
			const result = await handler.handleRequest({ method: "accountLogoutClicked" })
			expect(result.error).toBeUndefined()

			// Auth should be cleared
			expect(legacyState.readClineAuthInfo()).toBeNull()

			// Auth status should show not authenticated
			const authResult = await handler.handleRequest({ method: "subscribeToAuthStatusUpdate" })
			const authData = authResult.data as { user?: { uid: string } }
			expect(authData.user).toBeUndefined()
		})
	})

	// -----------------------------------------------------------------------
	// Use case: Switch organization and refresh balance
	// -----------------------------------------------------------------------

	describe("setUserOrganization + credit refresh", () => {
		it("should switch org and fetch new balance", async () => {
			writeAuthCredentials(dataDir, {
				appBaseUrl: mockBaseUrl,
				organizations: [
					{ organizationId: "org-alpha", name: "Alpha Corp", active: true, memberId: "mem-1" },
					{ organizationId: "org-beta", name: "Beta Inc", active: false, memberId: "mem-2" },
				],
			})
			writeGlobalState(dataDir, { welcomeViewCompleted: true })

			const legacyState = new LegacyStateReader({ dataDir })
			const controller = new SdkController({ legacyState, cwd: dataDir })
			const handler = controller.getGrpcHandler()

			// Fetch initial balance for org-alpha (active)
			const alphaResult = await handler.handleRequest({
				method: "getOrganizationCredits",
				params: { organizationId: "org-alpha" },
			})
			// Mock returns 500000; SdkController divides by 100 → 5000
			expect((alphaResult.data as Record<string, Record<string, number>>).balance.currentBalance).toBe(5000)

			// Switch to org-beta
			const switchResult = await handler.handleRequest({
				method: "setUserOrganization",
				params: { organizationId: "org-beta" },
			})
			expect(switchResult.error).toBeUndefined()

			// Verify org-beta is now active on disk
			const authInfo = legacyState.readClineAuthInfo()
			const betaOrg = authInfo?.userInfo?.organizations?.find((o) => o.organizationId === "org-beta")
			expect(betaOrg?.active).toBe(true)
			const alphaOrg = authInfo?.userInfo?.organizations?.find((o) => o.organizationId === "org-alpha")
			expect(alphaOrg?.active).toBe(false)

			// Fetch new balance for org-beta (low balance scenario)
			const betaResult = await handler.handleRequest({
				method: "getOrganizationCredits",
				params: { organizationId: "org-beta" },
			})
			// Mock returns 10000; SdkController divides by 100 → 100
			expect((betaResult.data as Record<string, Record<string, number>>).balance.currentBalance).toBe(100)

			// Switch back to personal account (no org)
			await handler.handleRequest({
				method: "setUserOrganization",
				params: { organizationId: undefined },
			})

			// Fetch personal balance - should get user credits, not stale org credits
			const personalResult = await handler.handleRequest({ method: "getUserCredits" })
			// Mock returns 125000; SdkController divides by 100 → 1250
			expect((personalResult.data as Record<string, Record<string, number>>).balance.currentBalance).toBe(1250)
		})

		it("should not persist stale balance after switching orgs (CAVEATS: low credit balance persists)", async () => {
			writeAuthCredentials(dataDir, {
				appBaseUrl: mockBaseUrl,
				organizations: [
					{ organizationId: "org-beta", name: "Beta Inc (low balance)", active: true, memberId: "mem-2" },
					{ organizationId: "org-alpha", name: "Alpha Corp (high balance)", active: false, memberId: "mem-1" },
				],
			})
			writeGlobalState(dataDir, { welcomeViewCompleted: true })

			const legacyState = new LegacyStateReader({ dataDir })
			const controller = new SdkController({ legacyState, cwd: dataDir })
			const handler = controller.getGrpcHandler()

			// Start with low-balance org (org-beta)
			const lowResult = await handler.handleRequest({
				method: "getOrganizationCredits",
				params: { organizationId: "org-beta" },
			})
			// Mock returns 10000; SdkController divides by 100 → 100
			expect((lowResult.data as Record<string, Record<string, number>>).balance.currentBalance).toBe(100)

			// Switch to high-balance org (org-alpha)
			await handler.handleRequest({
				method: "setUserOrganization",
				params: { organizationId: "org-alpha" },
			})

			// The KEY assertion: after switching, the balance should be the NEW org's balance,
			// not the stale low balance from the previous org
			const highResult = await handler.handleRequest({
				method: "getOrganizationCredits",
				params: { organizationId: "org-alpha" },
			})
			// Mock returns 500000; SdkController divides by 100 → 5000
			expect((highResult.data as Record<string, Record<string, number>>).balance.currentBalance).toBe(5000)
		})
	})

	// -----------------------------------------------------------------------
	// Use case: Auth status reflects current state
	// -----------------------------------------------------------------------

	describe("auth status updates", () => {
		it("should reflect logged-in state with orgs", async () => {
			writeAuthCredentials(dataDir, {
				appBaseUrl: mockBaseUrl,
				displayName: "Jane Doe",
				email: "jane@example.com",
				userId: "usr-jane",
				organizations: [
					{ organizationId: "org-alpha", name: "Alpha Corp", active: true, memberId: "mem-1", roles: ["admin"] },
				],
			})
			writeGlobalState(dataDir, { welcomeViewCompleted: true })

			const legacyState = new LegacyStateReader({ dataDir })
			const controller = new SdkController({ legacyState, cwd: dataDir })
			const handler = controller.getGrpcHandler()

			// Check auth status
			const authResult = await handler.handleRequest({ method: "subscribeToAuthStatusUpdate" })
			const authData = authResult.data as { user?: { uid: string; displayName: string; email: string } }
			expect(authData.user?.uid).toBe("usr-jane")
			expect(authData.user?.displayName).toBe("Jane Doe")

			// Check organizations
			const orgResult = await handler.handleRequest({ method: "getUserOrganizations" })
			const orgData = orgResult.data as {
				organizations: Array<{ organizationId: string; active: boolean; roles: string[] }>
			}
			expect(orgData.organizations).toHaveLength(1)
			expect(orgData.organizations[0].organizationId).toBe("org-alpha")
			expect(orgData.organizations[0].active).toBe(true)
			expect(orgData.organizations[0].roles).toContain("admin")
		})
	})
})
