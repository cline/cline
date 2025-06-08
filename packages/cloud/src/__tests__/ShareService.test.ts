/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi, type MockedFunction } from "vitest"
import axios from "axios"
import * as vscode from "vscode"

import { ShareService } from "../ShareService"
import type { AuthService } from "../AuthService"
import type { SettingsService } from "../SettingsService"

// Mock axios
vi.mock("axios")
const mockedAxios = axios as any

// Mock vscode
vi.mock("vscode", () => ({
	window: {
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
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
		it("should share task and copy to clipboard", async () => {
			const mockResponse = {
				data: {
					success: true,
					shareUrl: "https://app.roocode.com/share/abc123",
				},
			}

			;(mockAuthService.hasActiveSession as any).mockReturnValue(true)
			;(mockAuthService.getSessionToken as any).mockReturnValue("session-token")
			mockedAxios.post.mockResolvedValue(mockResponse)

			const result = await shareService.shareTask("task-123")

			expect(result).toBe(true)
			expect(mockedAxios.post).toHaveBeenCalledWith(
				"https://app.roocode.com/api/extension/share",
				{ taskId: "task-123" },
				{
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer session-token",
						"User-Agent": "Roo-Code 1.0.0",
					},
				},
			)
			expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith("https://app.roocode.com/share/abc123")
		})

		it("should handle API error response", async () => {
			const mockResponse = {
				data: {
					success: false,
					error: "Task not found",
				},
			}

			;(mockAuthService.hasActiveSession as any).mockReturnValue(true)
			;(mockAuthService.getSessionToken as any).mockReturnValue("session-token")
			mockedAxios.post.mockResolvedValue(mockResponse)

			const result = await shareService.shareTask("task-123")

			expect(result).toBe(false)
		})

		it("should handle authentication errors", async () => {
			;(mockAuthService.hasActiveSession as any).mockReturnValue(false)

			const result = await shareService.shareTask("task-123")

			expect(result).toBe(false)
			expect(mockedAxios.post).not.toHaveBeenCalled()
		})

		it("should handle 403 error for disabled sharing", async () => {
			;(mockAuthService.hasActiveSession as any).mockReturnValue(true)
			;(mockAuthService.getSessionToken as any).mockReturnValue("session-token")

			const error = {
				isAxiosError: true,
				response: {
					status: 403,
					data: {
						error: "Task sharing is not enabled for this organization",
					},
				},
			}

			mockedAxios.isAxiosError.mockReturnValue(true)
			mockedAxios.post.mockRejectedValue(error)

			const result = await shareService.shareTask("task-123")

			expect(result).toBe(false)
		})

		it("should handle unexpected errors", async () => {
			;(mockAuthService.hasActiveSession as any).mockReturnValue(true)
			;(mockAuthService.getSessionToken as any).mockReturnValue("session-token")

			mockedAxios.post.mockRejectedValue(new Error("Network error"))

			const result = await shareService.shareTask("task-123")

			expect(result).toBe(false)
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
