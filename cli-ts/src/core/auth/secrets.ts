/**
 * Secrets storage for API keys
 * Stores API keys in ~/.cline/secrets.json with restricted permissions
 */

import fs from "fs"
import path from "path"
import { getDefaultConfigDir } from "../config.js"

/**
 * Stored secrets schema
 */
export interface StoredSecrets {
	[providerId: string]: string
}

/**
 * Secrets storage class
 */
export class SecretsStorage {
	private secretsPath: string
	private configDir: string

	constructor(configDir?: string) {
		this.configDir = configDir || getDefaultConfigDir()
		this.secretsPath = path.join(this.configDir, "secrets.json")
	}

	/**
	 * Ensure the config directory exists with proper permissions
	 */
	private ensureConfigDir(): void {
		if (!fs.existsSync(this.configDir)) {
			fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 })
		}
	}

	/**
	 * Load secrets from disk
	 */
	load(): StoredSecrets {
		try {
			if (fs.existsSync(this.secretsPath)) {
				const content = fs.readFileSync(this.secretsPath, "utf-8")
				return JSON.parse(content) as StoredSecrets
			}
		} catch {
			// Return empty on error
		}
		return {}
	}

	/**
	 * Save secrets to disk with restricted permissions
	 */
	save(secrets: StoredSecrets): void {
		this.ensureConfigDir()
		fs.writeFileSync(this.secretsPath, JSON.stringify(secrets, null, 2), {
			mode: 0o600, // Read/write for owner only
		})
	}

	/**
	 * Get API key for a provider
	 */
	getApiKey(providerId: string): string | undefined {
		const secrets = this.load()
		return secrets[providerId]
	}

	/**
	 * Set API key for a provider
	 */
	setApiKey(providerId: string, apiKey: string): void {
		const secrets = this.load()
		secrets[providerId] = apiKey
		this.save(secrets)
	}

	/**
	 * Delete API key for a provider
	 */
	deleteApiKey(providerId: string): boolean {
		const secrets = this.load()
		if (providerId in secrets) {
			delete secrets[providerId]
			this.save(secrets)
			return true
		}
		return false
	}

	/**
	 * List all providers with stored keys
	 */
	listProviders(): string[] {
		const secrets = this.load()
		return Object.keys(secrets)
	}

	/**
	 * Check if a provider has a stored key
	 */
	hasApiKey(providerId: string): boolean {
		const secrets = this.load()
		return providerId in secrets
	}

	/**
	 * Get the path to the secrets file
	 */
	getSecretsPath(): string {
		return this.secretsPath
	}

	/**
	 * Clear all secrets
	 */
	clear(): void {
		this.save({})
	}
}

/**
 * Create a secrets storage instance
 */
export function createSecretsStorage(configDir?: string): SecretsStorage {
	return new SecretsStorage(configDir)
}

/**
 * Mask an API key for display (show first/last 4 chars)
 */
export function maskApiKey(key: string): string {
	if (key.length <= 8) {
		return "****"
	}
	return `${key.slice(0, 4)}...${key.slice(-4)}`
}
