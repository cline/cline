import { ExtensionContext } from 'vscode'
import { ConfigManager, ApiConfigData } from '../ConfigManager'
import { ApiConfiguration } from '../../../shared/api'

// Mock VSCode ExtensionContext
const mockSecrets = {
  get: jest.fn(),
  store: jest.fn(),
  delete: jest.fn()
}

const mockContext = {
  secrets: mockSecrets
} as unknown as ExtensionContext

describe('ConfigManager', () => {
  let configManager: ConfigManager

  beforeEach(() => {
    jest.clearAllMocks()
    configManager = new ConfigManager(mockContext)
  })

  describe('initConfig', () => {
    it('should not write to storage when secrets.get returns null', async () => {
      // Mock readConfig to return null
      mockSecrets.get.mockResolvedValueOnce(null)

      await configManager.initConfig()

      // Should not write to storage because readConfig returns defaultConfig
      expect(mockSecrets.store).not.toHaveBeenCalled()
    })

    it('should not initialize config if it exists', async () => {
      mockSecrets.get.mockResolvedValue(JSON.stringify({
        currentApiConfigName: 'default',
        apiConfigs: {
          default: {
            config: {},
            id: 'default'
          }
        }
      }))

      await configManager.initConfig()

      expect(mockSecrets.store).not.toHaveBeenCalled()
    })

    it('should generate IDs for configs that lack them', async () => {
      // Mock a config with missing IDs
      mockSecrets.get.mockResolvedValue(JSON.stringify({
        currentApiConfigName: 'default',
        apiConfigs: {
          default: {
            config: {}
          },
          test: {
            apiProvider: 'anthropic'
          }
        }
      }))

      await configManager.initConfig()

      // Should have written the config with new IDs
      expect(mockSecrets.store).toHaveBeenCalled()
      const storedConfig = JSON.parse(mockSecrets.store.mock.calls[0][1])
      expect(storedConfig.apiConfigs.default.id).toBeTruthy()
      expect(storedConfig.apiConfigs.test.id).toBeTruthy()
    })

    it('should throw error if secrets storage fails', async () => {
      mockSecrets.get.mockRejectedValue(new Error('Storage failed'))

      await expect(configManager.initConfig()).rejects.toThrow(
        'Failed to initialize config: Error: Failed to read config from secrets: Error: Storage failed'
      )
    })
  })

  describe('ListConfig', () => {
    it('should list all available configs', async () => {
      const existingConfig: ApiConfigData = {
        currentApiConfigName: 'default',
        apiConfigs: {
          default: {
            id: 'default'
          },
          test: {
            apiProvider: 'anthropic',
            id: 'test-id'
          }
        },
        modeApiConfigs: {
          code: 'default',
          architect: 'default',
          ask: 'default'
        }
      }

      mockSecrets.get.mockResolvedValue(JSON.stringify(existingConfig))

      const configs = await configManager.ListConfig()
      expect(configs).toEqual([
        { name: 'default', id: 'default', apiProvider: undefined },
        { name: 'test', id: 'test-id', apiProvider: 'anthropic' }
      ])
    })

    it('should handle empty config file', async () => {
      const emptyConfig: ApiConfigData = {
        currentApiConfigName: 'default',
        apiConfigs: {},
        modeApiConfigs: {
          code: 'default',
          architect: 'default',
          ask: 'default'
        }
      }

      mockSecrets.get.mockResolvedValue(JSON.stringify(emptyConfig))

      const configs = await configManager.ListConfig()
      expect(configs).toEqual([])
    })

    it('should throw error if reading from secrets fails', async () => {
      mockSecrets.get.mockRejectedValue(new Error('Read failed'))

      await expect(configManager.ListConfig()).rejects.toThrow(
        'Failed to list configs: Error: Failed to read config from secrets: Error: Read failed'
      )
    })
  })

  describe('SaveConfig', () => {
    it('should save new config', async () => {
      mockSecrets.get.mockResolvedValue(JSON.stringify({
        currentApiConfigName: 'default',
        apiConfigs: {
          default: {}
        },
        modeApiConfigs: {
          code: 'default',
          architect: 'default',
          ask: 'default'
        }
      }))

      const newConfig: ApiConfiguration = {
        apiProvider: 'anthropic',
        apiKey: 'test-key'
      }

      await configManager.SaveConfig('test', newConfig)

      // Get the actual stored config to check the generated ID
      const storedConfig = JSON.parse(mockSecrets.store.mock.calls[0][1])
      const testConfigId = storedConfig.apiConfigs.test.id

      const expectedConfig = {
        currentApiConfigName: 'default',
        apiConfigs: {
          default: {},
          test: {
            ...newConfig,
            id: testConfigId
          }
        },
        modeApiConfigs: {
          code: 'default',
          architect: 'default',
          ask: 'default'
        }
      }

      expect(mockSecrets.store).toHaveBeenCalledWith(
        'roo_cline_config_api_config',
        JSON.stringify(expectedConfig, null, 2)
      )
    })

    it('should update existing config', async () => {
      const existingConfig: ApiConfigData = {
        currentApiConfigName: 'default',
        apiConfigs: {
          test: {
            apiProvider: 'anthropic',
            apiKey: 'old-key',
            id: 'test-id'
          }
        }
      }

      mockSecrets.get.mockResolvedValue(JSON.stringify(existingConfig))

      const updatedConfig: ApiConfiguration = {
        apiProvider: 'anthropic',
        apiKey: 'new-key'
      }

      await configManager.SaveConfig('test', updatedConfig)

      const expectedConfig = {
        currentApiConfigName: 'default',
        apiConfigs: {
          test: {
            apiProvider: 'anthropic',
            apiKey: 'new-key',
            id: 'test-id'
          }
        }
      }

      expect(mockSecrets.store).toHaveBeenCalledWith(
        'roo_cline_config_api_config',
        JSON.stringify(expectedConfig, null, 2)
      )
    })

    it('should throw error if secrets storage fails', async () => {
      mockSecrets.get.mockResolvedValue(JSON.stringify({
        currentApiConfigName: 'default',
        apiConfigs: { default: {} }
      }))
      mockSecrets.store.mockRejectedValueOnce(new Error('Storage failed'))

      await expect(configManager.SaveConfig('test', {})).rejects.toThrow(
        'Failed to save config: Error: Failed to write config to secrets: Error: Storage failed'
      )
    })
  })

  describe('DeleteConfig', () => {
    it('should delete existing config', async () => {
      const existingConfig: ApiConfigData = {
        currentApiConfigName: 'default',
        apiConfigs: {
          default: {
            id: 'default'
          },
          test: {
            apiProvider: 'anthropic',
            id: 'test-id'
          }
        }
      }

      mockSecrets.get.mockResolvedValue(JSON.stringify(existingConfig))

      await configManager.DeleteConfig('test')

      // Get the stored config to check the ID
      const storedConfig = JSON.parse(mockSecrets.store.mock.calls[0][1])
      expect(storedConfig.currentApiConfigName).toBe('default')
      expect(Object.keys(storedConfig.apiConfigs)).toEqual(['default'])
      expect(storedConfig.apiConfigs.default.id).toBeTruthy()
    })

    it('should throw error when trying to delete non-existent config', async () => {
      mockSecrets.get.mockResolvedValue(JSON.stringify({
        currentApiConfigName: 'default',
        apiConfigs: { default: {} }
      }))

      await expect(configManager.DeleteConfig('nonexistent')).rejects.toThrow(
        "Config 'nonexistent' not found"
      )
    })

    it('should throw error when trying to delete last remaining config', async () => {
      mockSecrets.get.mockResolvedValue(JSON.stringify({
        currentApiConfigName: 'default',
        apiConfigs: {
          default: {
            id: 'default'
          }
        }
      }))

      await expect(configManager.DeleteConfig('default')).rejects.toThrow(
        'Cannot delete the last remaining configuration.'
      )
    })
  })

  describe('LoadConfig', () => {
    it('should load config and update current config name', async () => {
      const existingConfig: ApiConfigData = {
        currentApiConfigName: 'default',
        apiConfigs: {
          test: {
            apiProvider: 'anthropic',
            apiKey: 'test-key',
            id: 'test-id'
          }
        }
      }

      mockSecrets.get.mockResolvedValue(JSON.stringify(existingConfig))

      const config = await configManager.LoadConfig('test')

      expect(config).toEqual({
        apiProvider: 'anthropic',
        apiKey: 'test-key',
        id: 'test-id'
      })

      // Get the stored config to check the structure
      const storedConfig = JSON.parse(mockSecrets.store.mock.calls[0][1])
      expect(storedConfig.currentApiConfigName).toBe('test')
      expect(storedConfig.apiConfigs.test).toEqual({
        apiProvider: 'anthropic',
        apiKey: 'test-key',
        id: 'test-id'
      })
    })

    it('should throw error when config does not exist', async () => {
      mockSecrets.get.mockResolvedValue(JSON.stringify({
        currentApiConfigName: 'default',
        apiConfigs: {
          default: {
            config: {},
            id: 'default'
          }
        }
      }))

      await expect(configManager.LoadConfig('nonexistent')).rejects.toThrow(
        "Config 'nonexistent' not found"
      )
    })

    it('should throw error if secrets storage fails', async () => {
      mockSecrets.get.mockResolvedValue(JSON.stringify({
        currentApiConfigName: 'default',
        apiConfigs: {
          test: {
            config: {
              apiProvider: 'anthropic'
            },
            id: 'test-id'
          }
        }
      }))
      mockSecrets.store.mockRejectedValueOnce(new Error('Storage failed'))

      await expect(configManager.LoadConfig('test')).rejects.toThrow(
        'Failed to load config: Error: Failed to write config to secrets: Error: Storage failed'
      )
    })
  })

  describe('SetCurrentConfig', () => {
    it('should set current config', async () => {
      const existingConfig: ApiConfigData = {
        currentApiConfigName: 'default',
        apiConfigs: {
          default: {
            id: 'default'
          },
          test: {
            apiProvider: 'anthropic',
            id: 'test-id'
          }
        }
      }

      mockSecrets.get.mockResolvedValue(JSON.stringify(existingConfig))

      await configManager.SetCurrentConfig('test')

      // Get the stored config to check the structure
      const storedConfig = JSON.parse(mockSecrets.store.mock.calls[0][1])
      expect(storedConfig.currentApiConfigName).toBe('test')
      expect(storedConfig.apiConfigs.default.id).toBe('default')
      expect(storedConfig.apiConfigs.test).toEqual({
        apiProvider: 'anthropic',
        id: 'test-id'
      })
    })

    it('should throw error when config does not exist', async () => {
      mockSecrets.get.mockResolvedValue(JSON.stringify({
        currentApiConfigName: 'default',
        apiConfigs: { default: {} }
      }))

      await expect(configManager.SetCurrentConfig('nonexistent')).rejects.toThrow(
        "Config 'nonexistent' not found"
      )
    })

    it('should throw error if secrets storage fails', async () => {
      mockSecrets.get.mockResolvedValue(JSON.stringify({
        currentApiConfigName: 'default',
        apiConfigs: {
          test: { apiProvider: 'anthropic' }
        }
      }))
      mockSecrets.store.mockRejectedValueOnce(new Error('Storage failed'))

      await expect(configManager.SetCurrentConfig('test')).rejects.toThrow(
        'Failed to set current config: Error: Failed to write config to secrets: Error: Storage failed'
      )
    })
  })

  describe('HasConfig', () => {
    it('should return true for existing config', async () => {
      const existingConfig: ApiConfigData = {
        currentApiConfigName: 'default',
        apiConfigs: {
          default: {
            id: 'default'
          },
          test: {
            apiProvider: 'anthropic',
            id: 'test-id'
          }
        }
      }

      mockSecrets.get.mockResolvedValue(JSON.stringify(existingConfig))

      const hasConfig = await configManager.HasConfig('test')
      expect(hasConfig).toBe(true)
    })

    it('should return false for non-existent config', async () => {
      mockSecrets.get.mockResolvedValue(JSON.stringify({
        currentApiConfigName: 'default',
        apiConfigs: { default: {} }
      }))

      const hasConfig = await configManager.HasConfig('nonexistent')
      expect(hasConfig).toBe(false)
    })

    it('should throw error if secrets storage fails', async () => {
      mockSecrets.get.mockRejectedValue(new Error('Storage failed'))

      await expect(configManager.HasConfig('test')).rejects.toThrow(
        'Failed to check config existence: Error: Failed to read config from secrets: Error: Storage failed'
      )
    })
  })
})