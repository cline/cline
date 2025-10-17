import { describe, it, expect, vi, beforeEach } from "vitest"
import { CloudAPI } from "../CloudAPI.js"
import { AuthenticationError } from "../errors.js"
import type { AuthService } from "@roo-code/types"

// Mock fetch globally
global.fetch = vi.fn()

describe("CloudAPI", () => {
	let mockAuthService: Partial<AuthService>
	let cloudAPI: CloudAPI

	beforeEach(() => {
		// Mock only the methods we need for testing
		mockAuthService = {
			getSessionToken: vi.fn().mockReturnValue("test-token"),
		}

		cloudAPI = new CloudAPI(mockAuthService as AuthService)
		vi.clearAllMocks()
	})

	describe("getCloudAgents", () => {
		it("should return cloud agents on success", async () => {
			const mockAgents = [
				{ id: "1", name: "Agent 1", type: "code", icon: "code" },
				{ id: "2", name: "Agent 2", type: "chat", icon: "chat" },
			]

			// Mock successful response with schema-compliant format
			;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ success: true, data: mockAgents }),
			})

			const agents = await cloudAPI.getCloudAgents()

			expect(agents).toEqual(mockAgents)
			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining("/api/cloud-agents"),
				expect.objectContaining({
					method: "GET",
					headers: expect.objectContaining({
						Authorization: "Bearer test-token",
					}),
				}),
			)
		})

		it("should throw AuthenticationError on 401 response", async () => {
			// Mock 401 response
			;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: false,
				status: 401,
				statusText: "Unauthorized",
				json: async () => ({ error: "Authentication required" }),
			})

			await expect(cloudAPI.getCloudAgents()).rejects.toThrow(AuthenticationError)
		})

		it("should throw AuthenticationError when no session token", async () => {
			// Mock no session token
			mockAuthService.getSessionToken = vi.fn().mockReturnValue(null)

			await expect(cloudAPI.getCloudAgents()).rejects.toThrow(AuthenticationError)
		})

		it("should return empty array when agents array is empty", async () => {
			// Mock response with empty agents array
			;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ success: true, data: [] }),
			})

			const agents = await cloudAPI.getCloudAgents()

			expect(agents).toEqual([])
		})
	})
})
