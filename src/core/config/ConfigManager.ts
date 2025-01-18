import { ExtensionContext } from "vscode"
import { ApiConfiguration } from "../../shared/api"
import { Mode } from "../prompts/types"
import { ApiConfigMeta } from "../../shared/ExtensionMessage"

export interface ApiConfigData {
	currentApiConfigName: string
	apiConfigs: {
		[key: string]: ApiConfiguration
	}
	modeApiConfigs?: Partial<Record<Mode, string>>
}

export class ConfigManager {
	private readonly defaultConfig: ApiConfigData = {
		currentApiConfigName: "default",
		apiConfigs: {
			default: {
				id: this.generateId(),
			},
		},
	}

	private readonly SCOPE_PREFIX = "roo_cline_config_"
	private readonly context: ExtensionContext

	constructor(context: ExtensionContext) {
		this.context = context
		this.initConfig().catch(console.error)
	}

	private generateId(): string {
		return Math.random().toString(36).substring(2, 15)
	}

	/**
	 * Initialize config if it doesn't exist
	 */
	async initConfig(): Promise<void> {
		try {
			const config = await this.readConfig()
			if (!config) {
				await this.writeConfig(this.defaultConfig)
				return
			}

			// Migrate: ensure all configs have IDs
			let needsMigration = false
			for (const [name, apiConfig] of Object.entries(config.apiConfigs)) {
				if (!apiConfig.id) {
					apiConfig.id = this.generateId()
					needsMigration = true
				}
			}

			if (needsMigration) {
				await this.writeConfig(config)
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
			const config = await this.readConfig()
			return Object.entries(config.apiConfigs).map(([name, apiConfig]) => ({
				name,
				id: apiConfig.id || "",
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
			const currentConfig = await this.readConfig()
			const existingConfig = currentConfig.apiConfigs[name]
			currentConfig.apiConfigs[name] = {
				...config,
				id: existingConfig?.id || this.generateId(),
			}
			await this.writeConfig(currentConfig)
		} catch (error) {
			throw new Error(`Failed to save config: ${error}`)
		}
	}

	/**
	 * Load a config by name
	 */
	async LoadConfig(name: string): Promise<ApiConfiguration> {
		try {
			const config = await this.readConfig()
			const apiConfig = config.apiConfigs[name]

			if (!apiConfig) {
				throw new Error(`Config '${name}' not found`)
			}

			config.currentApiConfigName = name
			await this.writeConfig(config)

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
			const currentConfig = await this.readConfig()
			if (!currentConfig.apiConfigs[name]) {
				throw new Error(`Config '${name}' not found`)
			}

			// Don't allow deleting the default config
			if (Object.keys(currentConfig.apiConfigs).length === 1) {
				throw new Error(`Cannot delete the last remaining configuration.`)
			}

			delete currentConfig.apiConfigs[name]
			await this.writeConfig(currentConfig)
		} catch (error) {
			throw new Error(`Failed to delete config: ${error}`)
		}
	}

	/**
	 * Set the current active API configuration
	 */
	async SetCurrentConfig(name: string): Promise<void> {
		try {
			const currentConfig = await this.readConfig()
			if (!currentConfig.apiConfigs[name]) {
				throw new Error(`Config '${name}' not found`)
			}

			currentConfig.currentApiConfigName = name
			await this.writeConfig(currentConfig)
		} catch (error) {
			throw new Error(`Failed to set current config: ${error}`)
		}
	}

	/**
	 * Check if a config exists by name
	 */
	async HasConfig(name: string): Promise<boolean> {
		try {
			const config = await this.readConfig()
			return name in config.apiConfigs
		} catch (error) {
			throw new Error(`Failed to check config existence: ${error}`)
		}
	}

	/**
	 * Set the API config for a specific mode
	 */
	async SetModeConfig(mode: Mode, configId: string): Promise<void> {
		try {
			const currentConfig = await this.readConfig()
			if (!currentConfig.modeApiConfigs) {
				currentConfig.modeApiConfigs = {}
			}
			currentConfig.modeApiConfigs[mode] = configId
			await this.writeConfig(currentConfig)
		} catch (error) {
			throw new Error(`Failed to set mode config: ${error}`)
		}
	}

	/**
	 * Get the API config ID for a specific mode
	 */
	async GetModeConfigId(mode: Mode): Promise<string | undefined> {
		try {
			const config = await this.readConfig()
			return config.modeApiConfigs?.[mode]
		} catch (error) {
			throw new Error(`Failed to get mode config: ${error}`)
		}
	}

	private async readConfig(): Promise<ApiConfigData> {
		try {
			const configKey = `${this.SCOPE_PREFIX}api_config`
			const content = await this.context.secrets.get(configKey)

			if (!content) {
				return this.defaultConfig
			}

			return JSON.parse(content)
		} catch (error) {
			throw new Error(`Failed to read config from secrets: ${error}`)
		}
	}

	private async writeConfig(config: ApiConfigData): Promise<void> {
		try {
			const configKey = `${this.SCOPE_PREFIX}api_config`
			const content = JSON.stringify(config, null, 2)
			await this.context.secrets.store(configKey, content)
		} catch (error) {
			throw new Error(`Failed to write config to secrets: ${error}`)
		}
	}
}
