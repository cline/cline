// npx vitest src/core/config/__tests__/ProviderSettingsManager.spec.ts

import { ExtensionContext } from "vscode"

import type { ProviderSettings } from "@roo-code/types"

import { ProviderSettingsManager, ProviderProfiles, SyncCloudProfilesResult } from "../ProviderSettingsManager"

// Mock VSCode ExtensionContext
const mockSecrets = {
	get: vi.fn(),
	store: vi.fn(),
	delete: vi.fn(),
}

const mockGlobalState = {
	get: vi.fn(),
	update: vi.fn(),
}

const mockContext = {
	secrets: mockSecrets,
	globalState: mockGlobalState,
} as unknown as ExtensionContext

describe("ProviderSettingsManager", () => {
	let providerSettingsManager: ProviderSettingsManager

	beforeEach(() => {
		vi.clearAllMocks()
		// Reset all mock implementations to default successful behavior
		mockSecrets.get.mockResolvedValue(null)
		mockSecrets.store.mockResolvedValue(undefined)
		mockSecrets.delete.mockResolvedValue(undefined)
		mockGlobalState.get.mockReturnValue(undefined)
		mockGlobalState.update.mockResolvedValue(undefined)

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
						consecutiveMistakeLimitMigrated: true,
						todoListEnabledMigrated: true,
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

			// Get the last call to store, which should contain the migrated config
			const calls = mockSecrets.store.mock.calls
			const storedConfig = JSON.parse(calls[calls.length - 1][1])
			expect(storedConfig.apiConfigs.default.rateLimitSeconds).toEqual(42)
			expect(storedConfig.apiConfigs.test.rateLimitSeconds).toEqual(42)
			expect(storedConfig.apiConfigs.existing.rateLimitSeconds).toEqual(43)
		})

		it("should call migrateConsecutiveMistakeLimit if it has not done so already", async () => {
			mockSecrets.get.mockResolvedValue(
				JSON.stringify({
					currentApiConfigName: "default",
					apiConfigs: {
						default: {
							config: {},
							id: "default",
							consecutiveMistakeLimit: undefined,
						},
						test: {
							apiProvider: "anthropic",
							consecutiveMistakeLimit: undefined,
						},
						existing: {
							apiProvider: "anthropic",
							// this should not really be possible, unless someone has loaded a hand edited config,
							// but we don't overwrite so we'll check that
							consecutiveMistakeLimit: 5,
						},
					},
					migrations: {
						rateLimitSecondsMigrated: true,
						diffSettingsMigrated: true,
						openAiHeadersMigrated: true,
						consecutiveMistakeLimitMigrated: false,
					},
				}),
			)

			await providerSettingsManager.initialize()

			// Get the last call to store, which should contain the migrated config
			const calls = mockSecrets.store.mock.calls
			const storedConfig = JSON.parse(calls[calls.length - 1][1])
			expect(storedConfig.apiConfigs.default.consecutiveMistakeLimit).toEqual(3)
			expect(storedConfig.apiConfigs.test.consecutiveMistakeLimit).toEqual(3)
			expect(storedConfig.apiConfigs.existing.consecutiveMistakeLimit).toEqual(5)
			expect(storedConfig.migrations.consecutiveMistakeLimitMigrated).toEqual(true)
		})

		it("should call migrateTodoListEnabled if it has not done so already", async () => {
			mockSecrets.get.mockResolvedValue(
				JSON.stringify({
					currentApiConfigName: "default",
					apiConfigs: {
						default: {
							config: {},
							id: "default",
							todoListEnabled: undefined,
						},
						test: {
							apiProvider: "anthropic",
							todoListEnabled: undefined,
						},
						existing: {
							apiProvider: "anthropic",
							// this should not really be possible, unless someone has loaded a hand edited config,
							// but we don't overwrite so we'll check that
							todoListEnabled: false,
						},
					},
					migrations: {
						rateLimitSecondsMigrated: true,
						diffSettingsMigrated: true,
						openAiHeadersMigrated: true,
						consecutiveMistakeLimitMigrated: true,
						todoListEnabledMigrated: false,
					},
				}),
			)

			await providerSettingsManager.initialize()

			// Get the last call to store, which should contain the migrated config
			const calls = mockSecrets.store.mock.calls
			const storedConfig = JSON.parse(calls[calls.length - 1][1])
			expect(storedConfig.apiConfigs.default.todoListEnabled).toEqual(true)
			expect(storedConfig.apiConfigs.test.todoListEnabled).toEqual(true)
			expect(storedConfig.apiConfigs.existing.todoListEnabled).toEqual(false)
			expect(storedConfig.migrations.todoListEnabledMigrated).toEqual(true)
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
			const storedConfig = JSON.parse(mockSecrets.store.mock.calls[mockSecrets.store.mock.calls.length - 1][1])
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

			const storedConfig = JSON.parse(mockSecrets.store.mock.calls[mockSecrets.store.mock.calls.length - 1][1])
			expect(mockSecrets.store.mock.calls[mockSecrets.store.mock.calls.length - 1][0]).toEqual(
				"roo_cline_config_api_config",
			)
			expect(storedConfig).toEqual(expectedConfig)
		})

		it("should throw error if secrets storage fails", async () => {
			mockSecrets.get.mockResolvedValue(
				JSON.stringify({
					currentApiConfigName: "default",
					apiConfigs: { default: {} },
					migrations: {
						rateLimitSecondsMigrated: true,
						diffSettingsMigrated: true,
						openAiHeadersMigrated: true,
					},
				}),
			)
			mockSecrets.store.mockRejectedValue(new Error("Storage failed"))

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
			const calls = mockSecrets.store.mock.calls
			const storedConfig = JSON.parse(calls[calls.length - 1][1])
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
					apiConfigs: { test: { apiProvider: "anthropic", id: "test-id" } },
					migrations: {
						rateLimitSecondsMigrated: true,
						diffSettingsMigrated: true,
						openAiHeadersMigrated: true,
					},
				}),
			)
			mockSecrets.store.mockRejectedValue(new Error("Storage failed"))

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

	describe("syncCloudProfiles", () => {
		it("should add new cloud profiles without secret keys", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: { id: "default-id" },
				},
				cloudProfileIds: [],
			}

			mockSecrets.get.mockResolvedValue(JSON.stringify(existingConfig))

			const cloudProfiles = {
				"cloud-profile": {
					id: "cloud-id-1",
					apiProvider: "anthropic" as const,
					apiKey: "secret-key", // This should be removed
					apiModelId: "claude-3-opus-20240229",
				},
			}

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles)

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(false)
			expect(result.activeProfileId).toBe("")

			const storedConfig = JSON.parse(mockSecrets.store.mock.calls[0][1])
			expect(storedConfig.apiConfigs["cloud-profile"]).toEqual({
				id: "cloud-id-1",
				apiProvider: "anthropic",
				apiModelId: "claude-3-opus-20240229",
				// apiKey should be removed
			})
			expect(storedConfig.cloudProfileIds).toEqual(["cloud-id-1"])
		})

		it("should update existing cloud profiles by ID, preserving secret keys", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: { id: "default-id" },
					"existing-cloud": {
						id: "cloud-id-1",
						apiProvider: "anthropic" as const,
						apiKey: "existing-secret",
						apiModelId: "claude-3-haiku-20240307",
					},
				},
				cloudProfileIds: ["cloud-id-1"],
			}

			mockSecrets.get.mockResolvedValue(JSON.stringify(existingConfig))

			const cloudProfiles = {
				"updated-name": {
					id: "cloud-id-1",
					apiProvider: "anthropic" as const,
					apiKey: "new-secret", // Should be ignored
					apiModelId: "claude-3-opus-20240229",
				},
			}

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles)

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(false)
			expect(result.activeProfileId).toBe("")

			const storedConfig = JSON.parse(mockSecrets.store.mock.calls[0][1])
			expect(storedConfig.apiConfigs["updated-name"]).toEqual({
				id: "cloud-id-1",
				apiProvider: "anthropic",
				apiKey: "existing-secret", // Preserved
				apiModelId: "claude-3-opus-20240229", // Updated
			})
			expect(storedConfig.apiConfigs["existing-cloud"]).toBeUndefined()
			expect(storedConfig.cloudProfileIds).toEqual(["cloud-id-1"])
		})

		it("should delete cloud profiles not in the new cloud profiles", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: { id: "default-id" },
					"cloud-profile-1": { id: "cloud-id-1", apiProvider: "anthropic" as const },
					"cloud-profile-2": { id: "cloud-id-2", apiProvider: "openai" as const },
				},
				cloudProfileIds: ["cloud-id-1", "cloud-id-2"],
			}

			mockSecrets.get.mockResolvedValue(JSON.stringify(existingConfig))

			const cloudProfiles = {
				"cloud-profile-1": {
					id: "cloud-id-1",
					apiProvider: "anthropic" as const,
				},
				// cloud-profile-2 is missing, should be deleted
			}

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles)

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(false)
			expect(result.activeProfileId).toBe("")

			const storedConfig = JSON.parse(mockSecrets.store.mock.calls[0][1])
			expect(storedConfig.apiConfigs["cloud-profile-1"]).toBeDefined()
			expect(storedConfig.apiConfigs["cloud-profile-2"]).toBeUndefined()
			expect(storedConfig.cloudProfileIds).toEqual(["cloud-id-1"])
		})

		it("should rename existing non-cloud profile when cloud profile has same name", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: { id: "default-id" },
					"conflict-name": { id: "local-id", apiProvider: "openai" as const },
				},
				cloudProfileIds: [],
			}

			mockSecrets.get.mockResolvedValue(JSON.stringify(existingConfig))

			const cloudProfiles = {
				"conflict-name": {
					id: "cloud-id-1",
					apiProvider: "anthropic" as const,
				},
			}

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles)

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(false)
			expect(result.activeProfileId).toBe("")

			const storedConfig = JSON.parse(mockSecrets.store.mock.calls[0][1])
			expect(storedConfig.apiConfigs["conflict-name"]).toEqual({
				id: "cloud-id-1",
				apiProvider: "anthropic",
			})
			expect(storedConfig.apiConfigs["conflict-name_local"]).toEqual({
				id: "local-id",
				apiProvider: "openai",
			})
			expect(storedConfig.cloudProfileIds).toEqual(["cloud-id-1"])
		})

		it("should handle multiple naming conflicts with incremental suffixes", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: { id: "default-id" },
					"conflict-name": { id: "local-id-1", apiProvider: "openai" as const },
					"conflict-name_local": { id: "local-id-2", apiProvider: "vertex" as const },
				},
				cloudProfileIds: [],
			}

			mockSecrets.get.mockResolvedValue(JSON.stringify(existingConfig))

			const cloudProfiles = {
				"conflict-name": {
					id: "cloud-id-1",
					apiProvider: "anthropic" as const,
				},
			}

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles)

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(false)
			expect(result.activeProfileId).toBe("")

			const storedConfig = JSON.parse(mockSecrets.store.mock.calls[0][1])
			expect(storedConfig.apiConfigs["conflict-name"]).toEqual({
				id: "cloud-id-1",
				apiProvider: "anthropic",
			})
			expect(storedConfig.apiConfigs["conflict-name_1"]).toEqual({
				id: "local-id-1",
				apiProvider: "openai",
			})
			expect(storedConfig.apiConfigs["conflict-name_local"]).toEqual({
				id: "local-id-2",
				apiProvider: "vertex",
			})
		})

		it("should handle empty cloud profiles by deleting all cloud-managed profiles", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: { id: "default-id" },
					"cloud-profile-1": { id: "cloud-id-1", apiProvider: "anthropic" as const },
					"cloud-profile-2": { id: "cloud-id-2", apiProvider: "openai" as const },
				},
				cloudProfileIds: ["cloud-id-1", "cloud-id-2"],
			}

			mockSecrets.get.mockResolvedValue(JSON.stringify(existingConfig))

			const cloudProfiles = {}

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles)

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(false)
			expect(result.activeProfileId).toBe("")

			const storedConfig = JSON.parse(mockSecrets.store.mock.calls[0][1])
			expect(storedConfig.apiConfigs["cloud-profile-1"]).toBeUndefined()
			expect(storedConfig.apiConfigs["cloud-profile-2"]).toBeUndefined()
			expect(storedConfig.apiConfigs["default"]).toBeDefined()
			expect(storedConfig.cloudProfileIds).toEqual([])
		})

		it("should skip cloud profiles without IDs", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: { id: "default-id" },
				},
				cloudProfileIds: [],
			}

			mockSecrets.get.mockResolvedValue(JSON.stringify(existingConfig))

			const cloudProfiles = {
				"valid-profile": {
					id: "cloud-id-1",
					apiProvider: "anthropic" as const,
				},
				"invalid-profile": {
					// Missing id
					apiProvider: "openai" as const,
				},
			}

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles)

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(false)
			expect(result.activeProfileId).toBe("")

			const storedConfig = JSON.parse(mockSecrets.store.mock.calls[0][1])
			expect(storedConfig.apiConfigs["valid-profile"]).toBeDefined()
			expect(storedConfig.apiConfigs["invalid-profile"]).toBeUndefined()
			expect(storedConfig.cloudProfileIds).toEqual(["cloud-id-1"])
		})

		it("should handle complex sync scenario with multiple operations", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: { id: "default-id" },
					"keep-cloud": { id: "cloud-id-1", apiProvider: "anthropic" as const, apiKey: "secret1" },
					"delete-cloud": { id: "cloud-id-2", apiProvider: "openai" as const },
					"rename-me": { id: "local-id", apiProvider: "vertex" as const },
				},
				cloudProfileIds: ["cloud-id-1", "cloud-id-2"],
			}

			mockSecrets.get.mockResolvedValue(JSON.stringify(existingConfig))

			const cloudProfiles = {
				"updated-keep": {
					id: "cloud-id-1",
					apiProvider: "anthropic" as const,
					apiKey: "new-secret", // Should be ignored
					apiModelId: "claude-3-opus-20240229",
				},
				"rename-me": {
					id: "cloud-id-3",
					apiProvider: "openai" as const,
				},
				// delete-cloud is missing (should be deleted)
				// new profile
				"new-cloud": {
					id: "cloud-id-4",
					apiProvider: "vertex" as const,
				},
			}

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles)

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(false)
			expect(result.activeProfileId).toBe("")

			const storedConfig = JSON.parse(mockSecrets.store.mock.calls[0][1])

			// Check deletions
			expect(storedConfig.apiConfigs["delete-cloud"]).toBeUndefined()
			expect(storedConfig.apiConfigs["keep-cloud"]).toBeUndefined()

			// Check updates
			expect(storedConfig.apiConfigs["updated-keep"]).toEqual({
				id: "cloud-id-1",
				apiProvider: "anthropic",
				apiKey: "secret1", // preserved
				apiModelId: "claude-3-opus-20240229",
			})

			// Check renames
			expect(storedConfig.apiConfigs["rename-me_local"]).toEqual({
				id: "local-id",
				apiProvider: "vertex",
			})
			expect(storedConfig.apiConfigs["rename-me"]).toEqual({
				id: "cloud-id-3",
				apiProvider: "openai",
			})

			// Check new additions
			expect(storedConfig.apiConfigs["new-cloud"]).toEqual({
				id: "cloud-id-4",
				apiProvider: "vertex",
			})

			expect(storedConfig.cloudProfileIds).toEqual(["cloud-id-1", "cloud-id-3", "cloud-id-4"])
		})

		it("should throw error if secrets storage fails", async () => {
			mockSecrets.get.mockResolvedValue(
				JSON.stringify({
					currentApiConfigName: "default",
					apiConfigs: { default: { id: "default-id" } },
					cloudProfileIds: [],
				}),
			)
			mockSecrets.store.mockRejectedValue(new Error("Storage failed"))

			await expect(providerSettingsManager.syncCloudProfiles({})).rejects.toThrow(
				"Failed to sync cloud profiles: Error: Failed to write provider profiles to secrets: Error: Storage failed",
			)
		})

		it("should track active profile changes when active profile is updated", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "active-profile",
				apiConfigs: {
					"active-profile": {
						id: "active-id",
						apiProvider: "anthropic" as const,
						apiKey: "old-key",
					},
				},
				cloudProfileIds: ["active-id"],
			}

			mockSecrets.get.mockResolvedValue(JSON.stringify(existingConfig))

			const cloudProfiles = {
				"active-profile": {
					id: "active-id",
					apiProvider: "anthropic" as const,
					apiModelId: "claude-3-opus-20240229", // Updated setting
				},
			}

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles, "active-profile")

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(true)
			expect(result.activeProfileId).toBe("active-id")
		})

		it("should track active profile changes when active profile is deleted", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "active-profile",
				apiConfigs: {
					"active-profile": { id: "active-id", apiProvider: "anthropic" as const },
					"backup-profile": { id: "backup-id", apiProvider: "openai" as const },
				},
				cloudProfileIds: ["active-id"],
			}

			mockSecrets.get.mockResolvedValue(JSON.stringify(existingConfig))

			const cloudProfiles = {} // Active profile deleted

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles, "active-profile")

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(true)
			expect(result.activeProfileId).toBe("backup-id") // Should switch to first available
		})

		it("should create default profile when all profiles are deleted", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "only-profile",
				apiConfigs: {
					"only-profile": { id: "only-id", apiProvider: "anthropic" as const },
				},
				cloudProfileIds: ["only-id"],
			}

			mockSecrets.get.mockResolvedValue(JSON.stringify(existingConfig))

			const cloudProfiles = {} // All profiles deleted

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles, "only-profile")

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(true)
			expect(result.activeProfileId).toBeTruthy() // Should have new default profile ID

			const storedConfig = JSON.parse(mockSecrets.store.mock.calls[0][1])
			expect(storedConfig.apiConfigs["default"]).toBeDefined()
			expect(storedConfig.apiConfigs["default"].id).toBe(result.activeProfileId)
		})

		it("should not mark active profile as changed when it's not affected", async () => {
			const existingConfig: ProviderProfiles = {
				currentApiConfigName: "local-profile",
				apiConfigs: {
					"local-profile": { id: "local-id", apiProvider: "anthropic" as const },
					"cloud-profile": { id: "cloud-id", apiProvider: "openai" as const },
				},
				cloudProfileIds: ["cloud-id"],
			}

			mockSecrets.get.mockResolvedValue(JSON.stringify(existingConfig))

			const cloudProfiles = {
				"cloud-profile": {
					id: "cloud-id",
					apiProvider: "openai" as const,
					apiModelId: "gpt-4", // Updated cloud profile
				},
			}

			const result = await providerSettingsManager.syncCloudProfiles(cloudProfiles, "local-profile")

			expect(result.hasChanges).toBe(true)
			expect(result.activeProfileChanged).toBe(false)
			expect(result.activeProfileId).toBe("local-id")
		})
	})
})
