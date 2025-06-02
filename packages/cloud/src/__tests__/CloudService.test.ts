// npx vitest run src/__tests__/CloudService.test.ts

import * as vscode from "vscode"

import { CloudService } from "../CloudService"
import { AuthService } from "../AuthService"
import { SettingsService } from "../SettingsService"
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

describe("CloudService", () => {
	let mockContext: vscode.ExtensionContext
	let mockAuthService: {
		initialize: ReturnType<typeof vi.fn>
		login: ReturnType<typeof vi.fn>
		logout: ReturnType<typeof vi.fn>
		isAuthenticated: ReturnType<typeof vi.fn>
		hasActiveSession: ReturnType<typeof vi.fn>
		getUserInfo: ReturnType<typeof vi.fn>
		getState: ReturnType<typeof vi.fn>
		getSessionToken: ReturnType<typeof vi.fn>
		handleCallback: ReturnType<typeof vi.fn>
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
	let mockTelemetryService: {
		hasInstance: ReturnType<typeof vi.fn>
		instance: {
			register: ReturnType<typeof vi.fn>
		}
	}

	beforeEach(() => {
		CloudService.resetInstance()

		mockContext = {
			secrets: {
				get: vi.fn(),
				store: vi.fn(),
				delete: vi.fn(),
			},
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
			},
			extension: {
				packageJSON: {
					version: "1.0.0",
				},
			},
		} as unknown as vscode.ExtensionContext

		mockAuthService = {
			initialize: vi.fn(),
			login: vi.fn(),
			logout: vi.fn(),
			isAuthenticated: vi.fn().mockReturnValue(false),
			hasActiveSession: vi.fn().mockReturnValue(false),
			getUserInfo: vi.fn(),
			getState: vi.fn().mockReturnValue("logged-out"),
			getSessionToken: vi.fn(),
			handleCallback: vi.fn(),
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

		mockTelemetryService = {
			hasInstance: vi.fn().mockReturnValue(true),
			instance: {
				register: vi.fn(),
			},
		}

		vi.mocked(AuthService.createInstance).mockResolvedValue(mockAuthService as unknown as AuthService)
		Object.defineProperty(AuthService, "instance", { get: () => mockAuthService, configurable: true })

		vi.mocked(SettingsService.createInstance).mockResolvedValue(mockSettingsService as unknown as SettingsService)
		Object.defineProperty(SettingsService, "instance", { get: () => mockSettingsService, configurable: true })

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
			expect(AuthService.createInstance).toHaveBeenCalledWith(mockContext, expect.any(Function))
			expect(SettingsService.createInstance).toHaveBeenCalledWith(mockContext, expect.any(Function))
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

		it("should delegate getAuthState to AuthService", () => {
			const result = cloudService.getAuthState()
			expect(mockAuthService.getState).toHaveBeenCalled()
			expect(result).toBe("logged-out")
		})

		it("should delegate handleAuthCallback to AuthService", async () => {
			await cloudService.handleAuthCallback("code", "state")
			expect(mockAuthService.handleCallback).toHaveBeenCalledWith("code", "state")
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
})
