import fs from 'fs'
import path from 'path'
import os from 'os'
import { ApiConfiguration } from '../../shared/api'
import { ApiConfigMeta } from '../../shared/ExtensionMessage'

export interface ApiConfigFile {
  currentApiConfigName: string
  apiConfigs: {
    [key: string]: ApiConfiguration
  }
}

export class ConfigManager {
  private configPath: string

  private defaultConfig: ApiConfigFile = {
    currentApiConfigName: 'default',
    apiConfigs: {
      default: {}
    }
  }

  private initialized: Promise<void>

  constructor(configPath?: string) {
    configPath = configPath || path.join(os.homedir(), '.cline')
    this.configPath = path.join(configPath, 'api-config.json')
    // Initialize config file if it doesn't exist and store the promise
    this.initialized = this.initConfig().catch(error => {
      throw new Error(`Failed to initialize config in constructor: ${error}`)
    })
  }

  /**
   * Initialize config file if it doesn't exist
   */
  async initConfig(): Promise<void> {
    try {
      // Create .cline directory if it doesn't exist
      const dirPath = path.dirname(this.configPath)
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
      }

      // Create config file with default values if it doesn't exist
      if (!fs.existsSync(this.configPath)) {
        await fs.promises.writeFile(
          this.configPath,
          JSON.stringify(this.defaultConfig, null, 2)
        )
      }
    } catch (error) {
      throw new Error(`Failed to initialize config: ${error}`)
    }
  }

  /**
   * List all available configs with metadata
   */
  async ListConfig(): Promise<ApiConfigMeta[]> {
    try {
      await this.initialized
      const config = await this.readConfig()
      return Object.entries(config.apiConfigs).map(([name, apiConfig]) => ({
        name,
        apiProvider: apiConfig.apiProvider,
      }))
    } catch (error) {
      throw new Error(`Failed to list configs: ${error}`)
    }
  }

  /**
   * Save a config with the given name
   */
  async SaveConfig(name: string, config: ApiConfiguration): Promise<void> {
    try {
      await this.initialized
      const currentConfig = await this.readConfig()
      // Update or add the new config
      currentConfig.apiConfigs[name] = config
      
      await fs.promises.writeFile(
        this.configPath,
        JSON.stringify(currentConfig, null, 2)
      )
    } catch (error) {
      throw new Error(`Failed to save config: ${error}`)
    }
  }

  /**
   * Load a config by name
   */
  async LoadConfig(name: string): Promise<ApiConfiguration> {
    try {
      await this.initialized
      const config = await this.readConfig()
      const apiConfig = config.apiConfigs[name]
      
      if (!apiConfig) {
        throw new Error(`Config '${name}' not found`)
      }
      
      config.currentApiConfigName = name;
      await fs.promises.writeFile(
        this.configPath,
        JSON.stringify(config, null, 2)
      )
      
      return apiConfig
    } catch (error) {
      throw new Error(`Failed to load config: ${error}`)
    }
  }

  /**
   * Delete a config by name
   */
  async DeleteConfig(name: string): Promise<void> {
    try {
      await this.initialized
      const currentConfig = await this.readConfig()
      if (!currentConfig.apiConfigs[name]) {
        throw new Error(`Config '${name}' not found`)
      }

      // Don't allow deleting the default config
      if (Object.keys(currentConfig.apiConfigs).length === 1) {
        throw new Error(`Cannot delete the last remaining configuration.`)
      }

      delete currentConfig.apiConfigs[name]

      await fs.promises.writeFile(
        this.configPath,
        JSON.stringify(currentConfig, null, 2)
      )
    } catch (error) {
      throw new Error(`Failed to delete config: ${error}`)
    }
  }

  /**
   * Set the current active API configuration
   */
  async SetCurrentConfig(name: string): Promise<void> {
    try {
      await this.initialized
      const currentConfig = await this.readConfig()
      if (!currentConfig.apiConfigs[name]) {
        throw new Error(`Config '${name}' not found`)
      }

      currentConfig.currentApiConfigName = name
      
      await fs.promises.writeFile(
        this.configPath,
        JSON.stringify(currentConfig, null, 2)
      )
    } catch (error) {
      throw new Error(`Failed to set current config: ${error}`)
    }
  }

  private async readConfig(): Promise<ApiConfigFile> {
    try {
      const content = await fs.promises.readFile(this.configPath, 'utf-8')
      return JSON.parse(content)
    } catch (error) {
      throw new Error(`Failed to read config file: ${error}`)
    }
  }
}