import * as vscode from "vscode"

/**
 * ConfigurationService handles retrieval and updating of configuration settings.
 */
export class ConfigurationService {
	/**
	 * Retrieves a configuration value.
	 * @param section The section to retrieve the configuration value from.
	 * @param key The key of the configuration setting.
	 * @param defaultValue The default value to return if the configuration is not set.
	 */
	static getConfigValue<T>(section: string, key: string, defaultValue: T): T {
		const config = vscode.workspace.getConfiguration(section)
		return config.get<T>(key, defaultValue)
	}

	/**
	 * Updates a configuration value.
	 * @param section The section to update the configuration value in.
	 * @param key The key of the configuration setting.
	 * @param value The value to set for the configuration.
	 */
	static async setConfigValue<T>(section: string, key: string, value: T): Promise<void> {
		const config = vscode.workspace.getConfiguration(section)
		await config.update(key, value, vscode.ConfigurationTarget.Global)
	}
}
