/* eslint-disable @typescript-eslint/no-explicit-any */

import type { MockedFunction } from "vitest"
import * as vscode from "vscode"

import { ShareService, TaskNotFoundError } from "../ShareService"
import type { AuthService } from "../AuthService"
import type { SettingsService } from "../SettingsService"

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch as any

// Mock vscode
vi.mock("vscode", () => ({
	window: {
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		showQuickPick: vi.fn(),
	},
	env: {
		clipboard: {
			writeText: vi.fn(),
		},
		openExternal: vi.fn(),
	},
	Uri: {
		parse: vi.fn(),
	},
	extensions: {
		getExtension: vi.fn(() => ({
			packageJSON: { version: "1.0.0" },
		})),
	},
}))

// Mock config
vi.mock("../Config", () => ({
	getRooCodeApiUrl: () => "https://app.roocode.com",
}))

// Mock utils
vi.mock("../utils", () => ({
	getUserAgent: () => "Roo-Code 1.0.0",
}))

describe("ShareService", () => {
	let shareService: ShareService
	let mockAuthService: AuthService
	let mockSettingsService: SettingsService
	let mockLog: MockedFunction<(...args: unknown[]) => void>

	beforeEach(() => {
		vi.clearAllMocks()
		mockFetch.mockClear()

		mockLog = vi.fn()
		mockAuthService = {
			hasActiveSession: vi.fn(),
			getSessionToken: vi.fn(),
			isAuthenticated: vi.fn(),
		} as any

		mockSettingsService = {
			getSettings: vi.fn(),
		} as any

		shareService = new ShareService(mockAuthService, mockSettingsService, mockLog)
	})

	describe("shareTask", () => {
		it("should share task with organization visibility and copy to clipboard", async () => {
			const mockResponseData = {
				success: true,
				shareUrl: "https://app.roocode.com/share/abc123",
			}

			;(mockAuthService.getSessionToken as any).mockReturnValue("session-token")
			mockFetch.mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue(mockResponseData),
			})

			const result = await shareService.shareTask("task-123", "organization")

			expect(result.success).toBe(true)
			expect(result.shareUrl).toBe("https://app.roocode.com/share/abc123")
			expect(mockFetch).toHaveBeenCalledWith("https://app.roocode.com/api/extension/share", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer session-token",
					"User-Agent": "Roo-Code 1.0.0",
				},
				body: JSON.stringify({ taskId: "task-123", visibility: "organization" }),
				signal: expect.any(AbortSignal),
			})
			expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith("https://app.roocode.com/share/abc123")
		})

		it("should share task with public visibility", async () => {
			const mockResponseData = {
				success: true,
				shareUrl: "https://app.roocode.com/share/abc123",
			}

			;(mockAuthService.getSessionToken as any).mockReturnValue("session-token")
			mockFetch.mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue(mockResponseData),
			})

			const result = await shareService.shareTask("task-123", "public")

			expect(result.success).toBe(true)
			expect(mockFetch).toHaveBeenCalledWith("https://app.roocode.com/api/extension/share", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer session-token",
					"User-Agent": "Roo-Code 1.0.0",
				},
				body: JSON.stringify({ taskId: "task-123", visibility: "public" }),
				signal: expect.any(AbortSignal),
			})
		})

		it("should default to organization visibility when not specified", async () => {
			const mockResponseData = {
				success: true,
				shareUrl: "https://app.roocode.com/share/abc123",
			}

			;(mockAuthService.getSessionToken as any).mockReturnValue("session-token")
			mockFetch.mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue(mockResponseData),
			})

			const result = await shareService.shareTask("task-123")

			expect(result.success).toBe(true)
			expect(mockFetch).toHaveBeenCalledWith("https://app.roocode.com/api/extension/share", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer session-token",
					"User-Agent": "Roo-Code 1.0.0",
				},
				body: JSON.stringify({ taskId: "task-123", visibility: "organization" }),
				signal: expect.any(AbortSignal),
			})
		})

		it("should handle API error response", async () => {
			const mockResponseData = {
				success: false,
				error: "Task not found",
			}

			;(mockAuthService.getSessionToken as any).mockReturnValue("session-token")
			mockFetch.mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue(mockResponseData),
			})

			const result = await shareService.shareTask("task-123", "organization")

			expect(result.success).toBe(false)
			expect(result.error).toBe("Task not found")
		})

		it("should handle authentication errors", async () => {
			;(mockAuthService.getSessionToken as any).mockReturnValue(null)

			await expect(shareService.shareTask("task-123", "organization")).rejects.toThrow("Authentication required")
		})

		it("should handle unexpected errors", async () => {
			;(mockAuthService.getSessionToken as any).mockReturnValue("session-token")
			mockFetch.mockRejectedValue(new Error("Network error"))

			await expect(shareService.shareTask("task-123", "organization")).rejects.toThrow("Network error")
		})

		it("should throw TaskNotFoundError for 404 responses", async () => {
			;(mockAuthService.getSessionToken as any).mockReturnValue("session-token")
			mockFetch.mockResolvedValue({
				ok: false,
				status: 404,
				statusText: "Not Found",
			})

			await expect(shareService.shareTask("task-123", "organization")).rejects.toThrow(TaskNotFoundError)
			await expect(shareService.shareTask("task-123", "organization")).rejects.toThrow(
				"Task 'task-123' not found",
			)
		})

		it("should throw generic Error for non-404 HTTP errors", async () => {
			;(mockAuthService.getSessionToken as any).mockReturnValue("session-token")
			mockFetch.mockResolvedValue({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
			})

			await expect(shareService.shareTask("task-123", "organization")).rejects.toThrow(
				"HTTP 500: Internal Server Error",
			)
			await expect(shareService.shareTask("task-123", "organization")).rejects.not.toThrow(TaskNotFoundError)
		})

		it("should create TaskNotFoundError with correct properties", async () => {
			;(mockAuthService.getSessionToken as any).mockReturnValue("session-token")
			mockFetch.mockResolvedValue({
				ok: false,
				status: 404,
				statusText: "Not Found",
			})

			try {
				await shareService.shareTask("task-123", "organization")
				expect.fail("Expected TaskNotFoundError to be thrown")
			} catch (error) {
				expect(error).toBeInstanceOf(TaskNotFoundError)
				expect(error).toBeInstanceOf(Error)
				expect((error as TaskNotFoundError).message).toBe("Task 'task-123' not found")
			}
		})
	})

	describe("canShareTask", () => {
		it("should return true when authenticated and sharing is enabled", async () => {
			;(mockAuthService.isAuthenticated as any).mockReturnValue(true)
			;(mockSettingsService.getSettings as any).mockReturnValue({
				cloudSettings: {
					enableTaskSharing: true,
				},
			})

			const result = await shareService.canShareTask()

			expect(result).toBe(true)
		})

		it("should return false when authenticated but sharing is disabled", async () => {
			;(mockAuthService.isAuthenticated as any).mockReturnValue(true)
			;(mockSettingsService.getSettings as any).mockReturnValue({
				cloudSettings: {
					enableTaskSharing: false,
				},
			})

			const result = await shareService.canShareTask()

			expect(result).toBe(false)
		})

		it("should return false when authenticated and sharing setting is undefined (default)", async () => {
			;(mockAuthService.isAuthenticated as any).mockReturnValue(true)
			;(mockSettingsService.getSettings as any).mockReturnValue({
				cloudSettings: {},
			})

			const result = await shareService.canShareTask()

			expect(result).toBe(false)
		})

		it("should return false when authenticated and no settings available (default)", async () => {
			;(mockAuthService.isAuthenticated as any).mockReturnValue(true)
			;(mockSettingsService.getSettings as any).mockReturnValue(undefined)

			const result = await shareService.canShareTask()

			expect(result).toBe(false)
		})

		it("should return false when not authenticated", async () => {
			;(mockAuthService.isAuthenticated as any).mockReturnValue(false)

			const result = await shareService.canShareTask()

			expect(result).toBe(false)
		})

		it("should handle errors gracefully", async () => {
			;(mockAuthService.isAuthenticated as any).mockImplementation(() => {
				throw new Error("Auth error")
			})

			const result = await shareService.canShareTask()

			expect(result).toBe(false)
		})
	})
})
