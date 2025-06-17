import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import * as vscode from "vscode"
import { z } from "zod"

import { CloudService, getClerkBaseUrl, PRODUCTION_CLERK_BASE_URL } from "@roo-code/cloud"
import { Package } from "../../shared/package"

// MDM Configuration Schema
const mdmConfigSchema = z.object({
	requireCloudAuth: z.boolean(),
	organizationId: z.string().optional(),
})

export type MdmConfig = z.infer<typeof mdmConfigSchema>

export type ComplianceResult = { compliant: true } | { compliant: false; reason: string }

export class MdmService {
	private static _instance: MdmService | null = null
	private mdmConfig: MdmConfig | null = null
	private log: (...args: unknown[]) => void

	private constructor(log?: (...args: unknown[]) => void) {
		this.log = log || console.log
	}

	/**
	 * Initialize the MDM service by loading configuration
	 */
	public async initialize(): Promise<void> {
		try {
			this.mdmConfig = await this.loadMdmConfig()
			if (this.mdmConfig) {
				this.log("[MDM] Loaded MDM configuration:", this.mdmConfig)
				// Automatically enable Roo Code Cloud when MDM config is present
				await this.ensureCloudEnabled()
			} else {
				this.log("[MDM] No MDM configuration found")
			}
		} catch (error) {
			this.log("[MDM] Error loading MDM configuration:", error)
			// Don't throw - extension should work without MDM config
		}
	}

	/**
	 * Check if cloud authentication is required by MDM policy
	 */
	public requiresCloudAuth(): boolean {
		return this.mdmConfig?.requireCloudAuth ?? false
	}

	/**
	 * Get the required organization ID from MDM policy
	 */
	public getRequiredOrganizationId(): string | undefined {
		return this.mdmConfig?.organizationId
	}

	/**
	 * Ensure Roo Code Cloud is enabled when MDM config is present
	 */
	private async ensureCloudEnabled(): Promise<void> {
		try {
			const config = vscode.workspace.getConfiguration(Package.name)
			const currentValue = config.get<boolean>("rooCodeCloudEnabled", false)

			if (!currentValue) {
				this.log("[MDM] Enabling Roo Code Cloud due to MDM policy")
				await config.update("rooCodeCloudEnabled", true, vscode.ConfigurationTarget.Global)
			}
		} catch (error) {
			this.log("[MDM] Error enabling Roo Code Cloud:", error)
		}
	}

	/**
	 * Check if the current state is compliant with MDM policy
	 */
	public isCompliant(): ComplianceResult {
		// If no MDM policy, always compliant
		if (!this.requiresCloudAuth()) {
			return { compliant: true }
		}

		// Check if cloud service is available and authenticated
		if (!CloudService.hasInstance() || !CloudService.instance.hasActiveSession()) {
			return {
				compliant: false,
				reason: "Your organization requires Roo Code Cloud authentication. Please sign in to continue.",
			}
		}

		// Check organization match if specified
		const requiredOrgId = this.getRequiredOrganizationId()
		if (requiredOrgId) {
			try {
				const currentOrgId = CloudService.instance.getOrganizationId()
				if (currentOrgId !== requiredOrgId) {
					return {
						compliant: false,
						reason: "You must be authenticated with your organization's Roo Code Cloud account.",
					}
				}
			} catch (error) {
				this.log("[MDM] Error checking organization ID:", error)
				return {
					compliant: false,
					reason: "Unable to verify organization authentication.",
				}
			}
		}

		return { compliant: true }
	}

	/**
	 * Load MDM configuration from system location
	 */
	private async loadMdmConfig(): Promise<MdmConfig | null> {
		const configPath = this.getMdmConfigPath()

		try {
			// Check if file exists
			if (!fs.existsSync(configPath)) {
				return null
			}

			// Read and parse the configuration file
			const configContent = fs.readFileSync(configPath, "utf-8")
			const parsedConfig = JSON.parse(configContent)

			// Validate against schema
			return mdmConfigSchema.parse(parsedConfig)
		} catch (error) {
			this.log(`[MDM] Error reading MDM config from ${configPath}:`, error)
			return null
		}
	}

	/**
	 * Get the platform-specific MDM configuration file path
	 */
	private getMdmConfigPath(): string {
		const platform = os.platform()
		const isProduction = getClerkBaseUrl() === PRODUCTION_CLERK_BASE_URL
		const configFileName = isProduction ? "mdm.json" : "mdm.dev.json"

		switch (platform) {
			case "win32": {
				// Windows: %ProgramData%\RooCode\mdm.json or mdm.dev.json
				const programData = process.env.PROGRAMDATA || "C:\\ProgramData"
				return path.join(programData, "RooCode", configFileName)
			}

			case "darwin":
				// macOS: /Library/Application Support/RooCode/mdm.json or mdm.dev.json
				return `/Library/Application Support/RooCode/${configFileName}`

			case "linux":
			default:
				// Linux: /etc/roo-code/mdm.json or mdm.dev.json
				return `/etc/roo-code/${configFileName}`
		}
	}

	/**
	 * Get the singleton instance
	 */
	public static getInstance(): MdmService {
		if (!this._instance) {
			throw new Error("MdmService not initialized. Call createInstance() first.")
		}
		return this._instance
	}

	/**
	 * Create and initialize the singleton instance
	 */
	public static async createInstance(log?: (...args: unknown[]) => void): Promise<MdmService> {
		if (this._instance) {
			throw new Error("MdmService instance already exists")
		}

		this._instance = new MdmService(log)
		await this._instance.initialize()
		return this._instance
	}

	/**
	 * Check if instance exists
	 */
	public static hasInstance(): boolean {
		return this._instance !== null
	}

	/**
	 * Reset the instance (for testing)
	 */
	public static resetInstance(): void {
		this._instance = null
	}
}
