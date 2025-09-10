import {
	type SettingsService,
	type UserFeatures,
	type UserSettingsConfig,
	type UserSettingsData,
	OrganizationAllowList,
	OrganizationSettings,
	organizationSettingsSchema,
	ORGANIZATION_ALLOW_ALL,
} from "@roo-code/types"

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
			this.log(
				`[StaticSettingsService] failed to parse static settings: ${error instanceof Error ? error.message : String(error)}`,
				error,
			)

			throw new Error("Failed to parse static settings", { cause: error })
		}
	}

	public getAllowList(): OrganizationAllowList {
		return this.settings?.allowList || ORGANIZATION_ALLOW_ALL
	}

	public getSettings(): OrganizationSettings | undefined {
		return this.settings
	}

	/**
	 * Returns static user settings with roomoteControlEnabled and extensionBridgeEnabled as true
	 */
	public getUserSettings(): UserSettingsData | undefined {
		return {
			features: {
				roomoteControlEnabled: true,
			},
			settings: {
				extensionBridgeEnabled: true,
				taskSyncEnabled: true,
			},
			version: 1,
		}
	}

	public getUserFeatures(): UserFeatures {
		return {
			roomoteControlEnabled: true,
		}
	}

	public getUserSettingsConfig(): UserSettingsConfig {
		return {
			extensionBridgeEnabled: true,
			taskSyncEnabled: true,
		}
	}

	public async updateUserSettings(_settings: Partial<UserSettingsConfig>): Promise<boolean> {
		throw new Error("User settings updates are not supported in static mode")
	}

	public isTaskSyncEnabled(): boolean {
		// Static settings always enable task sync
		return true
	}

	public dispose(): void {
		// No resources to clean up for static settings.
	}
}
