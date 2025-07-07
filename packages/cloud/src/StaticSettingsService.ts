import {
	ORGANIZATION_ALLOW_ALL,
	OrganizationAllowList,
	OrganizationSettings,
	organizationSettingsSchema,
} from "@roo-code/types"

import type { SettingsService } from "./SettingsService"

export class StaticSettingsService implements SettingsService {
	private settings: OrganizationSettings
	private log: (...args: unknown[]) => void

	constructor(envValue: string, log?: (...args: unknown[]) => void) {
		this.log = log || console.log
		this.settings = this.parseEnvironmentSettings(envValue)
	}

	private parseEnvironmentSettings(envValue: string): OrganizationSettings {
		try {
			const decodedValue = Buffer.from(envValue, "base64").toString("utf-8")
			const parsedJson = JSON.parse(decodedValue)
			return organizationSettingsSchema.parse(parsedJson)
		} catch (error) {
			this.log(`[StaticSettingsService] failed to parse static settings: ${error.message}`, error)
			throw new Error("Failed to parse static settings", { cause: error })
		}
	}

	public getAllowList(): OrganizationAllowList {
		return this.settings?.allowList || ORGANIZATION_ALLOW_ALL
	}

	public getSettings(): OrganizationSettings | undefined {
		return this.settings
	}

	public dispose(): void {
		// No resources to clean up for static settings
	}
}
