import * as path from "path"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

// Mock dependencies
vi.mock("fs", () => ({
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
}))

vi.mock("os", () => ({
	platform: vi.fn(),
}))

vi.mock("@roo-code/cloud", () => ({
	CloudService: {
		hasInstance: vi.fn(),
		instance: {
			hasActiveSession: vi.fn(),
			getOrganizationId: vi.fn(),
		},
	},
	getClerkBaseUrl: vi.fn(),
	PRODUCTION_CLERK_BASE_URL: "https://clerk.roocode.com",
}))

vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(),
	},
	ConfigurationTarget: {
		Global: 1,
	},
}))

vi.mock("../../../shared/package", () => ({
	Package: {
		publisher: "roo-code",
		name: "roo-cline",
		version: "1.0.0",
		outputChannel: "Roo-Code",
		sha: undefined,
	},
}))

import * as fs from "fs"
import * as os from "os"
import * as vscode from "vscode"
import { MdmService } from "../MdmService"
import { CloudService, getClerkBaseUrl, PRODUCTION_CLERK_BASE_URL } from "@roo-code/cloud"

const mockFs = fs as any
const mockOs = os as any
const mockCloudService = CloudService as any
const mockVscode = vscode as any
const mockGetClerkBaseUrl = getClerkBaseUrl as any

describe("MdmService", () => {
	let originalPlatform: string

	beforeEach(() => {
		// Reset singleton
		MdmService.resetInstance()

		// Store original platform
		originalPlatform = process.platform

		// Set default platform for tests
		mockOs.platform.mockReturnValue("darwin")

		// Setup default mock for getClerkBaseUrl to return development URL
		mockGetClerkBaseUrl.mockReturnValue("https://dev.clerk.roocode.com")

		// Setup VSCode mocks
		const mockConfig = {
			get: vi.fn().mockReturnValue(false),
			update: vi.fn().mockResolvedValue(undefined),
		}
		mockVscode.workspace.getConfiguration.mockReturnValue(mockConfig)

		// Reset mocks
		vi.clearAllMocks()
		// Re-setup the default after clearing
		mockGetClerkBaseUrl.mockReturnValue("https://dev.clerk.roocode.com")
	})

	afterEach(() => {
		// Restore original platform
		Object.defineProperty(process, "platform", {
			value: originalPlatform,
		})
	})

	describe("initialization", () => {
		it("should create instance successfully", async () => {
			mockFs.existsSync.mockReturnValue(false)

			const service = await MdmService.createInstance()
			expect(service).toBeInstanceOf(MdmService)
		})

		it("should load MDM config if file exists", async () => {
			const mockConfig = {
				requireCloudAuth: true,
				organizationId: "test-org-123",
			}

			mockFs.existsSync.mockReturnValue(true)
			mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig))

			const service = await MdmService.createInstance()

			expect(service.requiresCloudAuth()).toBe(true)
			expect(service.getRequiredOrganizationId()).toBe("test-org-123")
		})

		it("should handle missing MDM config file gracefully", async () => {
			mockFs.existsSync.mockReturnValue(false)

			const service = await MdmService.createInstance()

			expect(service.requiresCloudAuth()).toBe(false)
			expect(service.getRequiredOrganizationId()).toBeUndefined()
		})

		it("should handle invalid JSON gracefully", async () => {
			mockFs.existsSync.mockReturnValue(true)
			mockFs.readFileSync.mockReturnValue("invalid json")

			const service = await MdmService.createInstance()

			expect(service.requiresCloudAuth()).toBe(false)
		})
	})

	describe("platform-specific config paths", () => {
		let originalNodeEnv: string | undefined

		beforeEach(() => {
			originalNodeEnv = process.env.NODE_ENV
		})

		afterEach(() => {
			if (originalNodeEnv !== undefined) {
				process.env.NODE_ENV = originalNodeEnv
			} else {
				delete process.env.NODE_ENV
			}
		})

		it("should use correct path for Windows in production", async () => {
			mockOs.platform.mockReturnValue("win32")
			process.env.PROGRAMDATA = "C:\\ProgramData"
			mockGetClerkBaseUrl.mockReturnValue(PRODUCTION_CLERK_BASE_URL)

			mockFs.existsSync.mockReturnValue(false)

			await MdmService.createInstance()

			expect(mockFs.existsSync).toHaveBeenCalledWith(path.join("C:\\ProgramData", "RooCode", "mdm.json"))
		})

		it("should use correct path for Windows in development", async () => {
			mockOs.platform.mockReturnValue("win32")
			process.env.PROGRAMDATA = "C:\\ProgramData"
			mockGetClerkBaseUrl.mockReturnValue("https://dev.clerk.roocode.com")

			mockFs.existsSync.mockReturnValue(false)

			await MdmService.createInstance()

			expect(mockFs.existsSync).toHaveBeenCalledWith(path.join("C:\\ProgramData", "RooCode", "mdm.dev.json"))
		})

		it("should use correct path for macOS in production", async () => {
			mockOs.platform.mockReturnValue("darwin")
			mockGetClerkBaseUrl.mockReturnValue(PRODUCTION_CLERK_BASE_URL)

			mockFs.existsSync.mockReturnValue(false)

			await MdmService.createInstance()

			expect(mockFs.existsSync).toHaveBeenCalledWith("/Library/Application Support/RooCode/mdm.json")
		})

		it("should use correct path for macOS in development", async () => {
			mockOs.platform.mockReturnValue("darwin")
			mockGetClerkBaseUrl.mockReturnValue("https://dev.clerk.roocode.com")

			mockFs.existsSync.mockReturnValue(false)

			await MdmService.createInstance()

			expect(mockFs.existsSync).toHaveBeenCalledWith("/Library/Application Support/RooCode/mdm.dev.json")
		})

		it("should use correct path for Linux in production", async () => {
			mockOs.platform.mockReturnValue("linux")
			mockGetClerkBaseUrl.mockReturnValue(PRODUCTION_CLERK_BASE_URL)

			mockFs.existsSync.mockReturnValue(false)

			await MdmService.createInstance()

			expect(mockFs.existsSync).toHaveBeenCalledWith("/etc/roo-code/mdm.json")
		})

		it("should use correct path for Linux in development", async () => {
			mockOs.platform.mockReturnValue("linux")
			mockGetClerkBaseUrl.mockReturnValue("https://dev.clerk.roocode.com")

			mockFs.existsSync.mockReturnValue(false)

			await MdmService.createInstance()

			expect(mockFs.existsSync).toHaveBeenCalledWith("/etc/roo-code/mdm.dev.json")
		})

		it("should default to dev config when NODE_ENV is not set", async () => {
			mockOs.platform.mockReturnValue("darwin")
			mockGetClerkBaseUrl.mockReturnValue("https://dev.clerk.roocode.com")

			mockFs.existsSync.mockReturnValue(false)

			await MdmService.createInstance()

			expect(mockFs.existsSync).toHaveBeenCalledWith("/Library/Application Support/RooCode/mdm.dev.json")
		})
	})

	describe("compliance checking", () => {
		it("should be compliant when no MDM policy exists", async () => {
			mockFs.existsSync.mockReturnValue(false)

			const service = await MdmService.createInstance()
			const compliance = service.isCompliant()

			expect(compliance.compliant).toBe(true)
		})

		it("should be compliant when authenticated and no org requirement", async () => {
			const mockConfig = { requireCloudAuth: true }
			mockFs.existsSync.mockReturnValue(true)
			mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig))

			mockCloudService.hasInstance.mockReturnValue(true)
			mockCloudService.instance.hasActiveSession.mockReturnValue(true)

			const service = await MdmService.createInstance()
			const compliance = service.isCompliant()

			expect(compliance.compliant).toBe(true)
		})

		it("should be non-compliant when not authenticated", async () => {
			const mockConfig = { requireCloudAuth: true }
			mockFs.existsSync.mockReturnValue(true)
			mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig))

			// Mock CloudService to indicate no instance or no active session
			mockCloudService.hasInstance.mockReturnValue(false)

			const service = await MdmService.createInstance()
			const compliance = service.isCompliant()

			expect(compliance.compliant).toBe(false)
			if (!compliance.compliant) {
				expect(compliance.reason).toContain("requires Roo Code Cloud authentication")
			}
		})

		it("should be non-compliant when wrong organization", async () => {
			const mockConfig = {
				requireCloudAuth: true,
				organizationId: "required-org-123",
			}
			mockFs.existsSync.mockReturnValue(true)
			mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig))

			// Mock CloudService to have instance and active session but wrong org
			mockCloudService.hasInstance.mockReturnValue(true)
			mockCloudService.instance.hasActiveSession.mockReturnValue(true)
			mockCloudService.instance.getOrganizationId.mockReturnValue("different-org-456")

			const service = await MdmService.createInstance()
			const compliance = service.isCompliant()

			expect(compliance.compliant).toBe(false)
			if (!compliance.compliant) {
				expect(compliance.reason).toContain("organization's Roo Code Cloud account")
			}
		})

		it("should be compliant when correct organization", async () => {
			const mockConfig = {
				requireCloudAuth: true,
				organizationId: "correct-org-123",
			}
			mockFs.existsSync.mockReturnValue(true)
			mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig))

			mockCloudService.hasInstance.mockReturnValue(true)
			mockCloudService.instance.hasActiveSession.mockReturnValue(true)
			mockCloudService.instance.getOrganizationId.mockReturnValue("correct-org-123")

			const service = await MdmService.createInstance()
			const compliance = service.isCompliant()

			expect(compliance.compliant).toBe(true)
		})
	})

	describe("cloud enablement", () => {
		it("should enable Roo Code Cloud when MDM config is present and setting is disabled", async () => {
			const mockConfig = {
				requireCloudAuth: true,
				organizationId: "test-org-123",
			}

			mockFs.existsSync.mockReturnValue(true)
			mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig))

			const mockVsCodeConfig = {
				get: vi.fn().mockReturnValue(false), // rooCodeCloudEnabled is false
				update: vi.fn().mockResolvedValue(undefined),
			}
			mockVscode.workspace.getConfiguration.mockReturnValue(mockVsCodeConfig)

			await MdmService.createInstance()

			expect(mockVscode.workspace.getConfiguration).toHaveBeenCalledWith("roo-cline")
			expect(mockVsCodeConfig.get).toHaveBeenCalledWith("rooCodeCloudEnabled", false)
			expect(mockVsCodeConfig.update).toHaveBeenCalledWith("rooCodeCloudEnabled", true, 1) // ConfigurationTarget.Global
		})

		it("should not update setting when Roo Code Cloud is already enabled", async () => {
			const mockConfig = {
				requireCloudAuth: true,
				organizationId: "test-org-123",
			}

			mockFs.existsSync.mockReturnValue(true)
			mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig))

			const mockVsCodeConfig = {
				get: vi.fn().mockReturnValue(true), // rooCodeCloudEnabled is already true
				update: vi.fn().mockResolvedValue(undefined),
			}
			mockVscode.workspace.getConfiguration.mockReturnValue(mockVsCodeConfig)

			await MdmService.createInstance()

			expect(mockVsCodeConfig.get).toHaveBeenCalledWith("rooCodeCloudEnabled", false)
			expect(mockVsCodeConfig.update).not.toHaveBeenCalled()
		})

		it("should enable cloud even when requireCloudAuth is false", async () => {
			const mockConfig = {
				requireCloudAuth: false, // Cloud auth not required, but config file exists
			}

			mockFs.existsSync.mockReturnValue(true)
			mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig))

			const mockVsCodeConfig = {
				get: vi.fn().mockReturnValue(false),
				update: vi.fn().mockResolvedValue(undefined),
			}
			mockVscode.workspace.getConfiguration.mockReturnValue(mockVsCodeConfig)

			await MdmService.createInstance()

			expect(mockVsCodeConfig.update).toHaveBeenCalledWith("rooCodeCloudEnabled", true, 1)
		})

		it("should not enable cloud when no MDM config exists", async () => {
			mockFs.existsSync.mockReturnValue(false)

			const mockVsCodeConfig = {
				get: vi.fn().mockReturnValue(false),
				update: vi.fn().mockResolvedValue(undefined),
			}
			mockVscode.workspace.getConfiguration.mockReturnValue(mockVsCodeConfig)

			await MdmService.createInstance()

			expect(mockVsCodeConfig.update).not.toHaveBeenCalled()
		})

		it("should handle VSCode configuration errors gracefully", async () => {
			const mockConfig = {
				requireCloudAuth: true,
			}

			mockFs.existsSync.mockReturnValue(true)
			mockFs.readFileSync.mockReturnValue(JSON.stringify(mockConfig))

			const mockVsCodeConfig = {
				get: vi.fn().mockReturnValue(false),
				update: vi.fn().mockRejectedValue(new Error("Configuration update failed")),
			}
			mockVscode.workspace.getConfiguration.mockReturnValue(mockVsCodeConfig)

			// Should not throw
			await expect(MdmService.createInstance()).resolves.toBeInstanceOf(MdmService)
		})
	})

	describe("singleton pattern", () => {
		it("should throw error when accessing instance before creation", () => {
			expect(() => MdmService.getInstance()).toThrow("MdmService not initialized")
		})

		it("should throw error when creating instance twice", async () => {
			mockFs.existsSync.mockReturnValue(false)

			await MdmService.createInstance()

			await expect(MdmService.createInstance()).rejects.toThrow("instance already exists")
		})

		it("should return same instance", async () => {
			mockFs.existsSync.mockReturnValue(false)

			const service1 = await MdmService.createInstance()
			const service2 = MdmService.getInstance()

			expect(service1).toBe(service2)
		})
	})
})
