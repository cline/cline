// npx jest src/core/config/__tests__/ProviderSettingsManager.test.ts

import { ExtensionContext } from "vscode"

import type { ProviderSettings } from "@roo-code/types"

import { ProviderSettingsManager, ProviderProfiles } from "../ProviderSettingsManager"

// Mock VSCode ExtensionContext
const mockSecrets = {
	get: jest.fn(),
	store: jest.fn(),
	delete: jest.fn(),
}

const mockGlobalState = {
	get: jest.fn(),
	update: jest.fn(),
}

const mockContext = {
	secrets: mockSecrets,
	globalState: mockGlobalState,
} as unknown as ExtensionContext

describe("ProviderSettingsManager", () => {
	let providerSettingsManager: ProviderSettingsManager

	beforeEach(() => {
		jest.clearAllMocks()
		providerSettingsManager = new ProviderSettingsManager(mockContext)
	})

	describe("initialize", () => {
		it("should not write to storage when secrets.get returns null", async () => {
			// Mock readConfig to return null
			mockSecrets.get.mockResolvedValueOnce(null)

			await providerSettingsManager.initialize()

			// Should not write to storage because readConfig returns defaultConfig
			expect(mockSecrets.store).not.toHaveBeenCalled()
		})

		it("should not initialize config if it exists and migrations are complete", async () => {
			mockSecrets.get.mockResolvedValue(
				JSON.stringify({
					currentApiConfigName: "default",
					apiConfigs: {
						default: {
							config: {},
							id: "default",
							diffEnabled: true,
							fuzzyMatchThreshold: 1.0,
						},
					},
					modeApiConfigs: {},
					migrations: {
						rateLimitSecondsMigrated: true,
						diffSettingsMigrated: true,
						openAiHeadersMigrated: true,
					},
				}),
			)

			await providerSettingsManager.initialize()

			expect(mockSecrets.store).not.toHaveBeenCalled()
		})

		it("should generate IDs for configs that lack them", async () => {
			// Mock a config with missing IDs
			mockSecrets.get.mockResolvedValue(
				JSON.stringify({
					currentApiConfigName: "default",
					apiConfigs: {
						default: {
							config: {},
						},
						test: {
							apiProvider: "anthropic",
						},
					},
					migrations: {
						rateLimitSecondsMigrated: true,
						diffSettingsMigrated: true,
					},
				}),
			)

			await providerSettingsManager.initialize()

			// Should have written the config with new IDs
			expect(mockSecrets.store).toHaveBeenCalled()
			const calls = mockSecrets.store.mock.calls
			const storedConfig = JSON.parse(calls[calls.length - 1][1]) // Get the latest call
			expect(storedConfig.apiConfigs.default.id).toBeTruthy()
			expect(storedConfig.apiConfigs.test.id).toBeTruthy()
		})

		it("should call migrateRateLimitSeconds if it has not done so already", async () => {
			mockGlobalState.get.mockResolvedValue(42)

			mockSecrets.get.mockResolvedValue(
				JSON.stringify({
					currentApiConfigName: "default",
					apiConfigs: {
						default: {
							config: {},
							id: "default",
							rateLimitSeconds: undefined,
						},
						test: {
							apiProvider: "anthropic",
							rateLimitSeconds: undefined,
						},
						existing: {
							apiProvider: "anthropic",
							// this should not really be possible, unless someone has loaded a hand edited config,
							// but we don't overwrite so we'll check that
							rateLimitSeconds: 43,
						},
					},
					migrations: {
						rateLimitSecondsMigrated: false,
					},
				}),
			)

			await providerSettingsManager.initialize()

			const storedConfig = JSON.parse(mockSecrets.store.mock.calls[1][1])
			expect(storedConfig.apiConfigs.default.rateLimitSeconds).toEqual(42)
			expect(storedConfig.apiConfigs.test.rateLimitSeconds).toEqual(42)
			expect(storedConfig.apiConfigs.existing.rateLimitSeconds).toEqual(43)
		})

		it("should throw error if secrets storage fails", async () => {
			mockSecrets.get.mockRejectedValue(new Error("Storage failed"))

			await expect(providerSettingsManager.initialize()).rejects.toThrow(
				"Failed to initialize config: Error: Failed to read provider profiles from secrets: Error: Storage failed",
			)
		})
	})

	describe("ListConfig", () => {
		it("should list all available configs", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: {
						id: "default",
					},
					test: {
						apiProvider: "anthropic",
						id: "test-id",
					},
				},
				modeApiConfigs: {
					code: "default",
					architect: "default",
					ask: "default",
				},
				migrations: {
					rateLimitSecondsMigrated: false,
				},
			}

			mockSecrets.get.mockResolvedValue(JSON.stringify(existingConfig))

			const configs = await providerSettingsManager.listConfig()
			expect(configs).toEqual([
				{ name: "default", id: "default", apiProvider: undefined },
				{ name: "test", id: "test-id", apiProvider: "anthropic" },
			])
		})

		it("should handle empty config file", async () => {
			const emptyConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {},
				modeApiConfigs: {
					code: "default",
					architect: "default",
					ask: "default",
				},
				migrations: {
					rateLimitSecondsMigrated: false,
				},
			}

			mockSecrets.get.mockResolvedValue(JSON.stringify(emptyConfig))

			const configs = await providerSettingsManager.listConfig()
			expect(configs).toEqual([])
		})

		it("should throw error if reading from secrets fails", async () => {
			mockSecrets.get.mockRejectedValue(new Error("Read failed"))

			await expect(providerSettingsManager.listConfig()).rejects.toThrow(
				"Failed to list configs: Error: Failed to read provider profiles from secrets: Error: Read failed",
			)
		})
	})

	describe("SaveConfig", () => {
		it("should save new config", async () => {
			mockSecrets.get.mockResolvedValue(
				JSON.stringify({
					currentApiConfigName: "default",
					apiConfigs: {
						default: {},
					},
					modeApiConfigs: {
						code: "default",
						architect: "default",
						ask: "default",
					},
				}),
			)

			const newConfig: ProviderSettings = {
				apiProvider: "vertex",
				apiModelId: "gemini-2.5-flash-preview-05-20",
				vertexKeyFile: "test-key-file",
			}

			await providerSettingsManager.saveConfig("test", newConfig)

			// Get the actual stored config to check the generated ID
			const storedConfig = JSON.parse(mockSecrets.store.mock.calls[0][1])
			const testConfigId = storedConfig.apiConfigs.test.id

			const expectedConfig = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: {},
					test: {
						...newConfig,
						id: testConfigId,
					},
				},
				modeApiConfigs: {
					code: "default",
					architect: "default",
					ask: "default",
				},
			}

			expect(mockSecrets.store.mock.calls[0][0]).toEqual("roo_cline_config_api_config")
			expect(storedConfig).toEqual(expectedConfig)
		})

		it("should only save provider relevant settings", async () => {
			mockSecrets.get.mockResolvedValue(
				JSON.stringify({
					currentApiConfigName: "default",
					apiConfigs: {
						default: {},
					},
					modeApiConfigs: {
						code: "default",
						architect: "default",
						ask: "default",
					},
				}),
			)

			const newConfig: ProviderSettings = {
				apiProvider: "anthropic",
				apiKey: "test-key",
			}
			const newConfigWithExtra: ProviderSettings = {
				...newConfig,
				openRouterApiKey: "another-key",
			}

			await providerSettingsManager.saveConfig("test", newConfigWithExtra)

			// Get the actual stored config to check the generated ID
			const storedConfig = JSON.parse(mockSecrets.store.mock.lastCall[1])
			const testConfigId = storedConfig.apiConfigs.test.id

			const expectedConfig = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: {},
					test: {
						...newConfig,
						id: testConfigId,
					},
				},
				modeApiConfigs: {
					code: "default",
					architect: "default",
					ask: "default",
				},
			}

			expect(mockSecrets.store.mock.calls[0][0]).toEqual("roo_cline_config_api_config")
			expect(storedConfig).toEqual(expectedConfig)
		})

		it("should update existing config", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					test: {
						apiProvider: "anthropic",
						apiKey: "old-key",
						id: "test-id",
					},
				},
				migrations: {
					rateLimitSecondsMigrated: false,
				},
			}

			mockSecrets.get.mockResolvedValue(JSON.stringify(existingConfig))

			const updatedConfig: ProviderSettings = {
				apiProvider: "anthropic",
				apiKey: "new-key",
			}

			await providerSettingsManager.saveConfig("test", updatedConfig)

			const expectedConfig = {
				currentApiConfigName: "default",
				apiConfigs: {
					test: {
						apiProvider: "anthropic",
						apiKey: "new-key",
						id: "test-id",
					},
				},
				migrations: {
					rateLimitSecondsMigrated: false,
				},
			}

			const storedConfig = JSON.parse(mockSecrets.store.mock.lastCall[1])
			expect(mockSecrets.store.mock.lastCall[0]).toEqual("roo_cline_config_api_config")
			expect(storedConfig).toEqual(expectedConfig)
		})

		it("should throw error if secrets storage fails", async () => {
			mockSecrets.get.mockResolvedValue(
				JSON.stringify({
					currentApiConfigName: "default",
					apiConfigs: { default: {} },
				}),
			)
			mockSecrets.store.mockRejectedValueOnce(new Error("Storage failed"))

			await expect(providerSettingsManager.saveConfig("test", {})).rejects.toThrow(
				"Failed to save config: Error: Failed to write provider profiles to secrets: Error: Storage failed",
			)
		})
	})

	describe("DeleteConfig", () => {
		it("should delete existing config", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: {
						id: "default",
					},
					test: {
						apiProvider: "anthropic",
						id: "test-id",
					},
				},
				migrations: {
					rateLimitSecondsMigrated: false,
				},
			}

			mockSecrets.get.mockResolvedValue(JSON.stringify(existingConfig))

			await providerSettingsManager.deleteConfig("test")

			// Get the stored config to check the ID
			const storedConfig = JSON.parse(mockSecrets.store.mock.calls[0][1])
			expect(storedConfig.currentApiConfigName).toBe("default")
			expect(Object.keys(storedConfig.apiConfigs)).toEqual(["default"])
			expect(storedConfig.apiConfigs.default.id).toBeTruthy()
		})

		it("should throw error when trying to delete non-existent config", async () => {
			mockSecrets.get.mockResolvedValue(
				JSON.stringify({
					currentApiConfigName: "default",
					apiConfigs: { default: {} },
				}),
			)

			await expect(providerSettingsManager.deleteConfig("nonexistent")).rejects.toThrow(
				"Config 'nonexistent' not found",
			)
		})

		it("should throw error when trying to delete last remaining config", async () => {
			mockSecrets.get.mockResolvedValue(
				JSON.stringify({
					currentApiConfigName: "default",
					apiConfigs: {
						default: {
							id: "default",
						},
					},
				}),
			)

			await expect(providerSettingsManager.deleteConfig("default")).rejects.toThrow(
				"Failed to delete config: Error: Cannot delete the last remaining configuration",
			)
		})
	})

	describe("LoadConfig", () => {
		it("should load config and update current config name", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					test: {
						apiProvider: "anthropic",
						apiKey: "test-key",
						id: "test-id",
					},
				},
				migrations: {
					rateLimitSecondsMigrated: false,
				},
			}

			mockGlobalState.get.mockResolvedValue(42)
			mockSecrets.get.mockResolvedValue(JSON.stringify(existingConfig))

			const { name, ...providerSettings } = await providerSettingsManager.activateProfile({ name: "test" })

			expect(name).toBe("test")
			expect(providerSettings).toEqual({ apiProvider: "anthropic", apiKey: "test-key", id: "test-id" })

			// Get the stored config to check the structure.
			const storedConfig = JSON.parse(mockSecrets.store.mock.calls[1][1])
			expect(storedConfig.currentApiConfigName).toBe("test")

			expect(storedConfig.apiConfigs.test).toEqual({
				apiProvider: "anthropic",
				apiKey: "test-key",
				id: "test-id",
			})
		})

		it("should throw error when config does not exist", async () => {
			mockSecrets.get.mockResolvedValue(
				JSON.stringify({
					currentApiConfigName: "default",
					apiConfigs: { default: { config: {}, id: "default" } },
				}),
			)

			await expect(providerSettingsManager.activateProfile({ name: "nonexistent" })).rejects.toThrow(
				"Config with name 'nonexistent' not found",
			)
		})

		it("should throw error if secrets storage fails", async () => {
			mockSecrets.get.mockResolvedValue(
				JSON.stringify({
					currentApiConfigName: "default",
					apiConfigs: { test: { config: { apiProvider: "anthropic" }, id: "test-id" } },
				}),
			)
			mockSecrets.store.mockRejectedValueOnce(new Error("Storage failed"))

			await expect(providerSettingsManager.activateProfile({ name: "test" })).rejects.toThrow(
				"Failed to activate profile: Failed to write provider profiles to secrets: Error: Storage failed",
			)
		})

		it("should remove invalid profiles during load", async () => {
			const invalidConfig = {
				currentApiConfigName: "valid",
				apiConfigs: {
					valid: {
						apiProvider: "anthropic",
						apiKey: "valid-key",
						apiModelId: "claude-3-opus-20240229",
						rateLimitSeconds: 0,
					},
					invalid: {
						// Invalid API provider.
						id: "x.ai",
						apiProvider: "x.ai",
					},
					// Incorrect type.
					anotherInvalid: "not an object",
				},
				migrations: {
					rateLimitSecondsMigrated: true,
				},
			}

			mockSecrets.get.mockResolvedValue(JSON.stringify(invalidConfig))

			await providerSettingsManager.initialize()

			const storeCalls = mockSecrets.store.mock.calls
			expect(storeCalls.length).toBeGreaterThan(0) // Ensure store was called at least once.
			const finalStoredConfigJson = storeCalls[storeCalls.length - 1][1]

			const storedConfig = JSON.parse(finalStoredConfigJson)
			expect(storedConfig.apiConfigs.valid).toBeDefined()
			expect(storedConfig.apiConfigs.invalid).toBeUndefined()
			expect(storedConfig.apiConfigs.anotherInvalid).toBeUndefined()
			expect(Object.keys(storedConfig.apiConfigs)).toEqual(["valid"])
			expect(storedConfig.currentApiConfigName).toBe("valid")
		})
	})

	describe("ResetAllConfigs", () => {
		it("should delete all stored configs", async () => {
			// Setup initial config
			mockSecrets.get.mockResolvedValue(
				JSON.stringify({
					currentApiConfigName: "test",
					apiConfigs: { test: { apiProvider: "anthropic", id: "test-id" } },
				}),
			)

			await providerSettingsManager.resetAllConfigs()

			// Should have called delete with the correct config key
			expect(mockSecrets.delete).toHaveBeenCalledWith("roo_cline_config_api_config")
		})
	})

	describe("HasConfig", () => {
		it("should return true for existing config", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: { default: { id: "default" }, test: { apiProvider: "anthropic", id: "test-id" } },
				migrations: { rateLimitSecondsMigrated: false },
			}

			mockSecrets.get.mockResolvedValue(JSON.stringify(existingConfig))

			const hasConfig = await providerSettingsManager.hasConfig("test")
			expect(hasConfig).toBe(true)
		})

		it("should return false for non-existent config", async () => {
			mockSecrets.get.mockResolvedValue(
				JSON.stringify({ currentApiConfigName: "default", apiConfigs: { default: {} } }),
			)

			const hasConfig = await providerSettingsManager.hasConfig("nonexistent")
			expect(hasConfig).toBe(false)
		})

		it("should throw error if secrets storage fails", async () => {
			mockSecrets.get.mockRejectedValue(new Error("Storage failed"))

			await expect(providerSettingsManager.hasConfig("test")).rejects.toThrow(
				"Failed to check config existence: Error: Failed to read provider profiles from secrets: Error: Storage failed",
			)
		})
	})
})
