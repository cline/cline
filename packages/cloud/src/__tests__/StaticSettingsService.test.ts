// npx vitest run src/__tests__/StaticSettingsService.test.ts

import { StaticSettingsService } from "../StaticSettingsService.js"

describe("StaticSettingsService", () => {
	const validSettings = {
		version: 1,
		cloudSettings: {
			recordTaskMessages: true,
			enableTaskSharing: true,
			taskShareExpirationDays: 30,
		},
		defaultSettings: {
			enableCheckpoints: true,
			maxOpenTabsContext: 10,
		},
		allowList: {
			allowAll: false,
			providers: {
				anthropic: {
					allowAll: true,
				},
			},
		},
	}

	const validBase64 = Buffer.from(JSON.stringify(validSettings)).toString("base64")

	describe("constructor", () => {
		it("should parse valid base64 encoded JSON settings", () => {
			const service = new StaticSettingsService(validBase64)
			expect(service.getSettings()).toEqual(validSettings)
		})

		it("should throw error for invalid base64", () => {
			expect(() => new StaticSettingsService("invalid-base64!@#")).toThrow("Failed to parse static settings")
		})

		it("should throw error for invalid JSON", () => {
			const invalidJson = Buffer.from("{ invalid json }").toString("base64")
			expect(() => new StaticSettingsService(invalidJson)).toThrow("Failed to parse static settings")
		})

		it("should throw error for invalid schema", () => {
			const invalidSettings = { invalid: "schema" }
			const invalidBase64 = Buffer.from(JSON.stringify(invalidSettings)).toString("base64")
			expect(() => new StaticSettingsService(invalidBase64)).toThrow("Failed to parse static settings")
		})
	})

	describe("getAllowList", () => {
		it("should return the allow list from settings", () => {
			const service = new StaticSettingsService(validBase64)
			expect(service.getAllowList()).toEqual(validSettings.allowList)
		})
	})

	describe("getSettings", () => {
		it("should return the parsed settings", () => {
			const service = new StaticSettingsService(validBase64)
			expect(service.getSettings()).toEqual(validSettings)
		})
	})

	describe("dispose", () => {
		it("should be a no-op for static settings", () => {
			const service = new StaticSettingsService(validBase64)
			expect(() => service.dispose()).not.toThrow()
		})
	})

	describe("logging", () => {
		it("should use provided logger for errors", () => {
			const mockLog = vi.fn()
			expect(() => new StaticSettingsService("invalid-base64!@#", mockLog)).toThrow()

			expect(mockLog).toHaveBeenCalledWith(
				expect.stringContaining("[StaticSettingsService] failed to parse static settings:"),
				expect.any(Error),
			)
		})

		it("should use console.log as default logger for errors", () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
			expect(() => new StaticSettingsService("invalid-base64!@#")).toThrow()

			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("[StaticSettingsService] failed to parse static settings:"),
				expect.any(Error),
			)

			consoleSpy.mockRestore()
		})

		it("should not log anything for successful parsing", () => {
			const mockLog = vi.fn()
			new StaticSettingsService(validBase64, mockLog)

			expect(mockLog).not.toHaveBeenCalled()
		})

		describe("isTaskSyncEnabled", () => {
			it("should always return true", () => {
				const service = new StaticSettingsService(validBase64)
				expect(service.isTaskSyncEnabled()).toBe(true)
			})

			it("should return true regardless of settings content", () => {
				// Create settings with different content
				const differentSettings = {
					version: 2,
					cloudSettings: {
						recordTaskMessages: false,
					},
					defaultSettings: {},
					allowList: { allowAll: false, providers: {} },
				}
				const differentBase64 = Buffer.from(JSON.stringify(differentSettings)).toString("base64")

				const service = new StaticSettingsService(differentBase64)
				expect(service.isTaskSyncEnabled()).toBe(true)
			})
		})
	})
})
