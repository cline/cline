// npx vitest run src/__tests__/CloudService.test.ts

import * as vscode from "vscode"
import type { ClineMessage } from "@roo-code/types"

import { CloudService } from "../CloudService"
import { AuthService } from "../AuthService"
import { SettingsService } from "../SettingsService"
import { ShareService, TaskNotFoundError } from "../ShareService"
import { TelemetryClient } from "../TelemetryClient"
import { TelemetryService } from "@roo-code/telemetry"
import { CloudServiceCallbacks } from "../types"

vi.mock("vscode", () => ({
	ExtensionContext: vi.fn(),
	window: {
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
	},
	env: {
		openExternal: vi.fn(),
	},
	Uri: {
		parse: vi.fn(),
	},
}))

vi.mock("@roo-code/telemetry")

vi.mock("../AuthService")

vi.mock("../SettingsService")

vi.mock("../ShareService")

vi.mock("../TelemetryClient")

describe("CloudService", () => {
	let mockContext: vscode.ExtensionContext
	let mockAuthService: {
		initialize: ReturnType<typeof vi.fn>
		login: ReturnType<typeof vi.fn>
		logout: ReturnType<typeof vi.fn>
		isAuthenticated: ReturnType<typeof vi.fn>
		hasActiveSession: ReturnType<typeof vi.fn>
		hasOrIsAcquiringActiveSession: ReturnType<typeof vi.fn>
		getUserInfo: ReturnType<typeof vi.fn>
		getState: ReturnType<typeof vi.fn>
		getSessionToken: ReturnType<typeof vi.fn>
		handleCallback: ReturnType<typeof vi.fn>
		getStoredOrganizationId: ReturnType<typeof vi.fn>
		on: ReturnType<typeof vi.fn>
		off: ReturnType<typeof vi.fn>
		once: ReturnType<typeof vi.fn>
		emit: ReturnType<typeof vi.fn>
	}
	let mockSettingsService: {
		initialize: ReturnType<typeof vi.fn>
		getSettings: ReturnType<typeof vi.fn>
		getAllowList: ReturnType<typeof vi.fn>
		dispose: ReturnType<typeof vi.fn>
	}
	let mockShareService: {
		shareTask: ReturnType<typeof vi.fn>
		canShareTask: ReturnType<typeof vi.fn>
	}
	let mockTelemetryClient: {
		backfillMessages: ReturnType<typeof vi.fn>
	}
	let mockTelemetryService: {
		hasInstance: ReturnType<typeof vi.fn>
		instance: {
			register: ReturnType<typeof vi.fn>
		}
	}

	beforeEach(() => {
		CloudService.resetInstance()

		mockContext = {
			subscriptions: [],
			workspaceState: {
				get: vi.fn(),
				update: vi.fn(),
				keys: vi.fn().mockReturnValue([]),
			},
			secrets: {
				get: vi.fn(),
				store: vi.fn(),
				delete: vi.fn(),
				onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			},
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
				setKeysForSync: vi.fn(),
				keys: vi.fn().mockReturnValue([]),
			},
			extensionUri: { scheme: "file", path: "/mock/path" },
			extensionPath: "/mock/path",
			extensionMode: 1,
			asAbsolutePath: vi.fn((relativePath: string) => `/mock/path/${relativePath}`),
			storageUri: { scheme: "file", path: "/mock/storage" },
			extension: {
				packageJSON: {
					version: "1.0.0",
				},
			},
		} as unknown as vscode.ExtensionContext

		mockAuthService = {
			initialize: vi.fn().mockResolvedValue(undefined),
			login: vi.fn(),
			logout: vi.fn(),
			isAuthenticated: vi.fn().mockReturnValue(false),
			hasActiveSession: vi.fn().mockReturnValue(false),
			hasOrIsAcquiringActiveSession: vi.fn().mockReturnValue(false),
			getUserInfo: vi.fn(),
			getState: vi.fn().mockReturnValue("logged-out"),
			getSessionToken: vi.fn(),
			handleCallback: vi.fn(),
			getStoredOrganizationId: vi.fn().mockReturnValue(null),
			on: vi.fn(),
			off: vi.fn(),
			once: vi.fn(),
			emit: vi.fn(),
		}

		mockSettingsService = {
			initialize: vi.fn(),
			getSettings: vi.fn(),
			getAllowList: vi.fn(),
			dispose: vi.fn(),
		}

		mockShareService = {
			shareTask: vi.fn(),
			canShareTask: vi.fn().mockResolvedValue(true),
		}

		mockTelemetryClient = {
			backfillMessages: vi.fn().mockResolvedValue(undefined),
		}

		mockTelemetryService = {
			hasInstance: vi.fn().mockReturnValue(true),
			instance: {
				register: vi.fn(),
			},
		}

		vi.mocked(AuthService).mockImplementation(() => mockAuthService as unknown as AuthService)
		vi.mocked(SettingsService).mockImplementation(() => mockSettingsService as unknown as SettingsService)
		vi.mocked(ShareService).mockImplementation(() => mockShareService as unknown as ShareService)
		vi.mocked(TelemetryClient).mockImplementation(() => mockTelemetryClient as unknown as TelemetryClient)

		vi.mocked(TelemetryService.hasInstance).mockReturnValue(true)
		Object.defineProperty(TelemetryService, "instance", {
			get: () => mockTelemetryService.instance,
			configurable: true,
		})
	})

	afterEach(() => {
		vi.clearAllMocks()
		CloudService.resetInstance()
	})

	describe("createInstance", () => {
		it("should create and initialize CloudService instance", async () => {
			const callbacks = {
				stateChanged: vi.fn(),
			}

			const cloudService = await CloudService.createInstance(mockContext, callbacks)

			expect(cloudService).toBeInstanceOf(CloudService)
			expect(AuthService).toHaveBeenCalledWith(mockContext, expect.any(Function))
			expect(SettingsService).toHaveBeenCalledWith(
				mockContext,
				mockAuthService,
				expect.any(Function),
				expect.any(Function),
			)
		})

		it("should throw error if instance already exists", async () => {
			await CloudService.createInstance(mockContext)

			await expect(CloudService.createInstance(mockContext)).rejects.toThrow(
				"CloudService instance already created",
			)
		})
	})

	describe("authentication methods", () => {
		let cloudService: CloudService
		let callbacks: CloudServiceCallbacks

		beforeEach(async () => {
			callbacks = { stateChanged: vi.fn() }
			cloudService = await CloudService.createInstance(mockContext, callbacks)
		})

		it("should delegate login to AuthService", async () => {
			await cloudService.login()
			expect(mockAuthService.login).toHaveBeenCalled()
		})

		it("should delegate logout to AuthService", async () => {
			await cloudService.logout()
			expect(mockAuthService.logout).toHaveBeenCalled()
		})

		it("should delegate isAuthenticated to AuthService", () => {
			const result = cloudService.isAuthenticated()
			expect(mockAuthService.isAuthenticated).toHaveBeenCalled()
			expect(result).toBe(false)
		})

		it("should delegate hasActiveSession to AuthService", () => {
			const result = cloudService.hasActiveSession()
			expect(mockAuthService.hasActiveSession).toHaveBeenCalled()
			expect(result).toBe(false)
		})

		it("should delegate getUserInfo to AuthService", async () => {
			await cloudService.getUserInfo()
			expect(mockAuthService.getUserInfo).toHaveBeenCalled()
		})

		it("should return organization ID from user info", () => {
			const mockUserInfo = {
				name: "Test User",
				email: "test@example.com",
				organizationId: "org_123",
				organizationName: "Test Org",
				organizationRole: "admin",
			}
			mockAuthService.getUserInfo.mockReturnValue(mockUserInfo)

			const result = cloudService.getOrganizationId()
			expect(mockAuthService.getUserInfo).toHaveBeenCalled()
			expect(result).toBe("org_123")
		})

		it("should return null when no organization ID available", () => {
			mockAuthService.getUserInfo.mockReturnValue(null)

			const result = cloudService.getOrganizationId()
			expect(result).toBe(null)
		})

		it("should return organization name from user info", () => {
			const mockUserInfo = {
				name: "Test User",
				email: "test@example.com",
				organizationId: "org_123",
				organizationName: "Test Org",
				organizationRole: "admin",
			}
			mockAuthService.getUserInfo.mockReturnValue(mockUserInfo)

			const result = cloudService.getOrganizationName()
			expect(mockAuthService.getUserInfo).toHaveBeenCalled()
			expect(result).toBe("Test Org")
		})

		it("should return null when no organization name available", () => {
			mockAuthService.getUserInfo.mockReturnValue(null)

			const result = cloudService.getOrganizationName()
			expect(result).toBe(null)
		})

		it("should return organization role from user info", () => {
			const mockUserInfo = {
				name: "Test User",
				email: "test@example.com",
				organizationId: "org_123",
				organizationName: "Test Org",
				organizationRole: "admin",
			}
			mockAuthService.getUserInfo.mockReturnValue(mockUserInfo)

			const result = cloudService.getOrganizationRole()
			expect(mockAuthService.getUserInfo).toHaveBeenCalled()
			expect(result).toBe("admin")
		})

		it("should return null when no organization role available", () => {
			mockAuthService.getUserInfo.mockReturnValue(null)

			const result = cloudService.getOrganizationRole()
			expect(result).toBe(null)
		})

		it("should delegate getAuthState to AuthService", () => {
			const result = cloudService.getAuthState()
			expect(mockAuthService.getState).toHaveBeenCalled()
			expect(result).toBe("logged-out")
		})

		it("should delegate handleAuthCallback to AuthService", async () => {
			await cloudService.handleAuthCallback("code", "state")
			expect(mockAuthService.handleCallback).toHaveBeenCalledWith("code", "state", undefined)
		})

		it("should delegate handleAuthCallback with organizationId to AuthService", async () => {
			await cloudService.handleAuthCallback("code", "state", "org_123")
			expect(mockAuthService.handleCallback).toHaveBeenCalledWith("code", "state", "org_123")
		})

		it("should return stored organization ID from AuthService", () => {
			mockAuthService.getStoredOrganizationId.mockReturnValue("org_456")

			const result = cloudService.getStoredOrganizationId()
			expect(mockAuthService.getStoredOrganizationId).toHaveBeenCalled()
			expect(result).toBe("org_456")
		})

		it("should return null when no stored organization ID available", () => {
			mockAuthService.getStoredOrganizationId.mockReturnValue(null)

			const result = cloudService.getStoredOrganizationId()
			expect(result).toBe(null)
		})

		it("should return true when stored organization ID exists", () => {
			mockAuthService.getStoredOrganizationId.mockReturnValue("org_789")

			const result = cloudService.hasStoredOrganizationId()
			expect(result).toBe(true)
		})

		it("should return false when no stored organization ID exists", () => {
			mockAuthService.getStoredOrganizationId.mockReturnValue(null)

			const result = cloudService.hasStoredOrganizationId()
			expect(result).toBe(false)
		})
	})

	describe("organization settings methods", () => {
		let cloudService: CloudService

		beforeEach(async () => {
			cloudService = await CloudService.createInstance(mockContext)
		})

		it("should delegate getAllowList to SettingsService", () => {
			cloudService.getAllowList()
			expect(mockSettingsService.getAllowList).toHaveBeenCalled()
		})
	})

	describe("error handling", () => {
		it("should throw error when accessing methods before initialization", () => {
			expect(() => CloudService.instance.login()).toThrow("CloudService not initialized")
		})

		it("should throw error when accessing instance before creation", () => {
			expect(() => CloudService.instance).toThrow("CloudService not initialized")
		})
	})

	describe("hasInstance", () => {
		it("should return false when no instance exists", () => {
			expect(CloudService.hasInstance()).toBe(false)
		})

		it("should return true when instance exists and is initialized", async () => {
			await CloudService.createInstance(mockContext)
			expect(CloudService.hasInstance()).toBe(true)
		})
	})

	describe("dispose", () => {
		it("should dispose of all services and clean up", async () => {
			const cloudService = await CloudService.createInstance(mockContext)
			cloudService.dispose()

			expect(mockSettingsService.dispose).toHaveBeenCalled()
		})
	})

	describe("shareTask with ClineMessage retry logic", () => {
		let cloudService: CloudService

		beforeEach(async () => {
			// Reset mocks for shareTask tests
			vi.clearAllMocks()

			// Reset authentication state for shareTask tests
			mockAuthService.isAuthenticated.mockReturnValue(true)
			mockAuthService.hasActiveSession.mockReturnValue(true)
			mockAuthService.hasOrIsAcquiringActiveSession.mockReturnValue(true)
			mockAuthService.getState.mockReturnValue("active")

			cloudService = await CloudService.createInstance(mockContext, {})
		})

		it("should call shareTask without retry when successful", async () => {
			const taskId = "test-task-id"
			const visibility = "organization"
			const clineMessages: ClineMessage[] = [
				{
					ts: Date.now(),
					type: "say",
					say: "text",
					text: "Hello world",
				},
			]

			const expectedResult = { success: true, shareUrl: "https://example.com/share/123" }
			mockShareService.shareTask.mockResolvedValue(expectedResult)

			const result = await cloudService.shareTask(taskId, visibility, clineMessages)

			expect(mockShareService.shareTask).toHaveBeenCalledTimes(1)
			expect(mockShareService.shareTask).toHaveBeenCalledWith(taskId, visibility)
			expect(mockTelemetryClient.backfillMessages).not.toHaveBeenCalled()
			expect(result).toEqual(expectedResult)
		})

		it("should retry with backfill when TaskNotFoundError occurs", async () => {
			const taskId = "test-task-id"
			const visibility = "organization"
			const clineMessages: ClineMessage[] = [
				{
					ts: Date.now(),
					type: "say",
					say: "text",
					text: "Hello world",
				},
			]

			const expectedResult = { success: true, shareUrl: "https://example.com/share/123" }

			// First call throws TaskNotFoundError, second call succeeds
			mockShareService.shareTask
				.mockRejectedValueOnce(new TaskNotFoundError(taskId))
				.mockResolvedValueOnce(expectedResult)

			const result = await cloudService.shareTask(taskId, visibility, clineMessages)

			expect(mockShareService.shareTask).toHaveBeenCalledTimes(2)
			expect(mockShareService.shareTask).toHaveBeenNthCalledWith(1, taskId, visibility)
			expect(mockShareService.shareTask).toHaveBeenNthCalledWith(2, taskId, visibility)
			expect(mockTelemetryClient.backfillMessages).toHaveBeenCalledTimes(1)
			expect(mockTelemetryClient.backfillMessages).toHaveBeenCalledWith(clineMessages, taskId)
			expect(result).toEqual(expectedResult)
		})

		it("should not retry when TaskNotFoundError occurs but no clineMessages provided", async () => {
			const taskId = "test-task-id"
			const visibility = "organization"

			const taskNotFoundError = new TaskNotFoundError(taskId)
			mockShareService.shareTask.mockRejectedValue(taskNotFoundError)

			await expect(cloudService.shareTask(taskId, visibility)).rejects.toThrow(TaskNotFoundError)

			expect(mockShareService.shareTask).toHaveBeenCalledTimes(1)
			expect(mockTelemetryClient.backfillMessages).not.toHaveBeenCalled()
		})

		it("should not retry when non-TaskNotFoundError occurs", async () => {
			const taskId = "test-task-id"
			const visibility = "organization"
			const clineMessages: ClineMessage[] = [
				{
					ts: Date.now(),
					type: "say",
					say: "text",
					text: "Hello world",
				},
			]

			const genericError = new Error("Some other error")
			mockShareService.shareTask.mockRejectedValue(genericError)

			await expect(cloudService.shareTask(taskId, visibility, clineMessages)).rejects.toThrow(genericError)

			expect(mockShareService.shareTask).toHaveBeenCalledTimes(1)
			expect(mockTelemetryClient.backfillMessages).not.toHaveBeenCalled()
		})

		it("should work with default parameters", async () => {
			const taskId = "test-task-id"
			const expectedResult = { success: true, shareUrl: "https://example.com/share/123" }
			mockShareService.shareTask.mockResolvedValue(expectedResult)

			const result = await cloudService.shareTask(taskId)

			expect(mockShareService.shareTask).toHaveBeenCalledTimes(1)
			expect(mockShareService.shareTask).toHaveBeenCalledWith(taskId, "organization")
			expect(result).toEqual(expectedResult)
		})
	})
})
