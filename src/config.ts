import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { Environment, type EnvironmentConfig } from "./shared/config-types"
import { Logger } from "./shared/services/Logger"

export { Environment, type EnvironmentConfig }

/**
 * Schema for the endpoints.json configuration file used in on-premise deployments.
 * All fields are required and must be valid URLs.
 */
interface EndpointsFileSchema {
	appBaseUrl: string
	apiBaseUrl: string
	mcpBaseUrl: string
}

/**
 * Error thrown when the Beadsmith configuration file exists but is invalid.
 * This error prevents Beadsmith from starting to avoid misconfiguration in enterprise environments.
 */
export class BeadsmithConfigurationError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "BeadsmithConfigurationError"
	}
}

class BeadsmithEndpoint {
	private static _instance: BeadsmithEndpoint | null = null
	private static _initialized = false

	// On-premise config loaded from file (null if not on-premise)
	private onPremiseConfig: EndpointsFileSchema | null = null
	private environment: Environment = Environment.production

	private constructor() {
		// Set environment at module load. Use override if provided.
		const _env = process?.env?.BEADSMITH_ENVIRONMENT_OVERRIDE || process?.env?.BEADSMITH_ENVIRONMENT
		if (_env && Object.values(Environment).includes(_env as Environment)) {
			this.environment = _env as Environment
		}
	}

	/**
	 * Initializes the BeadsmithEndpoint singleton.
	 * Must be called before any other methods.
	 * Reads the endpoints.json file if it exists and validates its schema.
	 *
	 * @throws BeadsmithConfigurationError if the endpoints.json file exists but is invalid
	 */
	public static async initialize(): Promise<void> {
		if (BeadsmithEndpoint._initialized) {
			return
		}

		BeadsmithEndpoint._instance = new BeadsmithEndpoint()

		// Try to load on-premise config from file
		const endpointsConfig = await BeadsmithEndpoint.loadEndpointsFile()
		if (endpointsConfig) {
			BeadsmithEndpoint._instance.onPremiseConfig = endpointsConfig
			Logger.log("Beadsmith running in self-hosted mode with custom endpoints")
		}

		BeadsmithEndpoint._initialized = true
	}

	/**
	 * Returns true if the BeadsmithEndpoint has been initialized.
	 */
	public static isInitialized(): boolean {
		return BeadsmithEndpoint._initialized
	}

	/**
	 * Checks if Beadsmith is running in self-hosted/on-premise mode.
	 * @returns true if in selfHosted mode, or true if not initialized (safety fallback to prevent accidental external calls)
	 */
	public static isSelfHosted(): boolean {
		// Safety fallback: if not initialized, treat as selfHosted
		// to prevent accidental external service calls before configuration is loaded
		if (!BeadsmithEndpoint._initialized) {
			return true
		}
		return BeadsmithEndpoint.config.environment === Environment.selfHosted
	}

	/**
	 * Returns the singleton instance.
	 * @throws Error if not initialized
	 */
	public static get instance(): BeadsmithEndpoint {
		if (!BeadsmithEndpoint._initialized || !BeadsmithEndpoint._instance) {
			throw new Error("BeadsmithEndpoint not initialized. Call BeadsmithEndpoint.initialize() first.")
		}
		return BeadsmithEndpoint._instance
	}

	/**
	 * Static getter for convenient access to the current configuration.
	 * @throws Error if not initialized
	 */
	public static get config(): EnvironmentConfig {
		return BeadsmithEndpoint.instance.config()
	}

	/**
	 * Returns the path to the endpoints.json configuration file.
	 * Located at ~/.beadsmith/endpoints.json
	 */
	private static getEndpointsFilePath(): string {
		return path.join(os.homedir(), ".beadsmith", "endpoints.json")
	}

	/**
	 * Loads and validates the endpoints.json file.
	 * @returns The validated endpoints config, or null if the file doesn't exist
	 * @throws BeadsmithConfigurationError if the file exists but is invalid
	 */
	private static async loadEndpointsFile(): Promise<EndpointsFileSchema | null> {
		const filePath = BeadsmithEndpoint.getEndpointsFilePath()

		try {
			await fs.access(filePath)
		} catch {
			// File doesn't exist - not on-premise mode
			return null
		}

		// File exists, must be valid or we fail
		try {
			const fileContent = await fs.readFile(filePath, "utf8")
			let data: unknown

			try {
				data = JSON.parse(fileContent)
			} catch (parseError) {
				throw new BeadsmithConfigurationError(
					`Invalid JSON in endpoints configuration file (${filePath}): ${parseError instanceof Error ? parseError.message : String(parseError)}`,
				)
			}

			return BeadsmithEndpoint.validateEndpointsSchema(data, filePath)
		} catch (error) {
			if (error instanceof BeadsmithConfigurationError) {
				throw error
			}
			throw new BeadsmithConfigurationError(
				`Failed to read endpoints configuration file (${filePath}): ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	/**
	 * Validates that the provided data matches the EndpointsFileSchema.
	 * All fields must be present and be valid URLs.
	 *
	 * @param data The parsed JSON data to validate
	 * @param filePath The path to the file (for error messages)
	 * @returns The validated EndpointsFileSchema
	 * @throws BeadsmithConfigurationError if validation fails
	 */
	private static validateEndpointsSchema(data: unknown, filePath: string): EndpointsFileSchema {
		if (typeof data !== "object" || data === null) {
			throw new BeadsmithConfigurationError(`Endpoints configuration file (${filePath}) must contain a JSON object`)
		}

		const obj = data as Record<string, unknown>
		const requiredFields = ["appBaseUrl", "apiBaseUrl", "mcpBaseUrl"] as const
		const result: Partial<EndpointsFileSchema> = {}

		for (const field of requiredFields) {
			const value = obj[field]

			if (value === undefined || value === null) {
				throw new BeadsmithConfigurationError(
					`Missing required field "${field}" in endpoints configuration file (${filePath})`,
				)
			}

			if (typeof value !== "string") {
				throw new BeadsmithConfigurationError(
					`Field "${field}" in endpoints configuration file (${filePath}) must be a string`,
				)
			}

			if (!value.trim()) {
				throw new BeadsmithConfigurationError(
					`Field "${field}" in endpoints configuration file (${filePath}) cannot be empty`,
				)
			}

			// Validate URL format
			try {
				new URL(value)
			} catch {
				throw new BeadsmithConfigurationError(
					`Field "${field}" in endpoints configuration file (${filePath}) must be a valid URL. Got: "${value}"`,
				)
			}

			result[field] = value
		}

		return result as EndpointsFileSchema
	}

	/**
	 * Returns the current environment configuration.
	 */
	public config(): EnvironmentConfig {
		return this.getEnvironment()
	}

	/**
	 * Sets the current environment.
	 * @throws Error if in on-premise mode (environment switching is disabled)
	 */
	public setEnvironment(env: string) {
		if (this.onPremiseConfig) {
			throw new Error("Cannot change environment in on-premise mode. Endpoints are configured via ~/.beadsmith/endpoints.json")
		}

		switch (env.toLowerCase()) {
			case "staging":
				this.environment = Environment.staging
				break
			case "local":
				this.environment = Environment.local
				break
			default:
				this.environment = Environment.production
				break
		}
	}

	/**
	 * Returns the current environment configuration.
	 * If running in on-premise mode, returns the custom endpoints.
	 */
	public getEnvironment(): EnvironmentConfig {
		// On-premise mode: use custom endpoints from file
		if (this.onPremiseConfig) {
			return {
				environment: Environment.selfHosted,
				appBaseUrl: this.onPremiseConfig.appBaseUrl,
				apiBaseUrl: this.onPremiseConfig.apiBaseUrl,
				mcpBaseUrl: this.onPremiseConfig.mcpBaseUrl,
			}
		}

		// Standard mode: use built-in environment URLs
		switch (this.environment) {
			case Environment.staging:
				return {
					environment: Environment.staging,
					appBaseUrl: "https://staging-app.cline.bot",
					apiBaseUrl: "https://core-api.staging.int.cline.bot",
					mcpBaseUrl: "https://core-api.staging.int.cline.bot/v1/mcp",
				}
			case Environment.local:
				return {
					environment: Environment.local,
					appBaseUrl: "http://localhost:3000",
					apiBaseUrl: "http://localhost:7777",
					mcpBaseUrl: "https://api.cline.bot/v1/mcp",
				}
			default:
				return {
					environment: Environment.production,
					appBaseUrl: "https://app.cline.bot",
					apiBaseUrl: "https://api.cline.bot",
					mcpBaseUrl: "https://api.cline.bot/v1/mcp",
				}
		}
	}
}

/**
 * Singleton instance to access the current environment configuration.
 * Usage:
 * - BeadsmithEnv.config() to get the current config.
 * - BeadsmithEnv.setEnvironment(Environment.local) to change the environment.
 *
 * IMPORTANT: BeadsmithEndpoint.initialize() must be called before using BeadsmithEnv.
 */
export const BeadsmithEnv = {
	config: () => BeadsmithEndpoint.config,
	setEnvironment: (env: string) => BeadsmithEndpoint.instance.setEnvironment(env),
	getEnvironment: () => BeadsmithEndpoint.instance.getEnvironment(),
}

// Export the class for initialization
export { BeadsmithEndpoint }
