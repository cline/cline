import * as vscode from "vscode"
import { ZodError } from "zod"

import {
	PROVIDER_SETTINGS_KEYS,
	GLOBAL_SETTINGS_KEYS,
	SECRET_STATE_KEYS,
	GLOBAL_STATE_KEYS,
	ProviderSettings,
	GlobalSettings,
	SecretState,
	GlobalState,
	RooCodeSettings,
	providerSettingsSchema,
	globalSettingsSchema,
	isSecretStateKey,
} from "../../schemas"
import { logger } from "../../utils/logging"
import { telemetryService } from "../../services/telemetry/TelemetryService"

type GlobalStateKey = keyof GlobalState
type SecretStateKey = keyof SecretState
type RooCodeSettingsKey = keyof RooCodeSettings

const PASS_THROUGH_STATE_KEYS = ["taskHistory"]

export const isPassThroughStateKey = (key: string) => PASS_THROUGH_STATE_KEYS.includes(key)

const globalSettingsExportSchema = globalSettingsSchema.omit({
	taskHistory: true,
	listApiConfigMeta: true,
	currentApiConfigName: true,
})

export class ContextProxy {
	private readonly originalContext: vscode.ExtensionContext

	private stateCache: GlobalState
	private secretCache: SecretState
	private _isInitialized = false

	constructor(context: vscode.ExtensionContext) {
		this.originalContext = context
		this.stateCache = {}
		this.secretCache = {}
		this._isInitialized = false
	}

	public get isInitialized() {
		return this._isInitialized
	}

	public async initialize() {
		for (const key of GLOBAL_STATE_KEYS) {
			try {
				this.stateCache[key] = this.originalContext.globalState.get(key)
			} catch (error) {
				logger.error(`Error loading global ${key}: ${error instanceof Error ? error.message : String(error)}`)
			}
		}

		const promises = SECRET_STATE_KEYS.map(async (key) => {
			try {
				this.secretCache[key] = await this.originalContext.secrets.get(key)
			} catch (error) {
				logger.error(`Error loading secret ${key}: ${error instanceof Error ? error.message : String(error)}`)
			}
		})

		await Promise.all(promises)

		this._isInitialized = true
	}

	public get extensionUri() {
		return this.originalContext.extensionUri
	}

	public get extensionPath() {
		return this.originalContext.extensionPath
	}

	public get globalStorageUri() {
		return this.originalContext.globalStorageUri
	}

	public get logUri() {
		return this.originalContext.logUri
	}

	public get extension() {
		return this.originalContext.extension
	}

	public get extensionMode() {
		return this.originalContext.extensionMode
	}

	/**
	 * ExtensionContext.globalState
	 * https://code.visualstudio.com/api/references/vscode-api#ExtensionContext.globalState
	 */

	getGlobalState<K extends GlobalStateKey>(key: K): GlobalState[K]
	getGlobalState<K extends GlobalStateKey>(key: K, defaultValue: GlobalState[K]): GlobalState[K]
	getGlobalState<K extends GlobalStateKey>(key: K, defaultValue?: GlobalState[K]): GlobalState[K] {
		if (isPassThroughStateKey(key)) {
			const value = this.originalContext.globalState.get<GlobalState[K]>(key)
			return value === undefined || value === null ? defaultValue : value
		}

		const value = this.stateCache[key]
		return value !== undefined ? value : defaultValue
	}

	updateGlobalState<K extends GlobalStateKey>(key: K, value: GlobalState[K]) {
		if (isPassThroughStateKey(key)) {
			return this.originalContext.globalState.update(key, value)
		}

		this.stateCache[key] = value
		return this.originalContext.globalState.update(key, value)
	}

	private getAllGlobalState(): GlobalState {
		return Object.fromEntries(GLOBAL_STATE_KEYS.map((key) => [key, this.getGlobalState(key)]))
	}

	/**
	 * ExtensionContext.secrets
	 * https://code.visualstudio.com/api/references/vscode-api#ExtensionContext.secrets
	 */

	getSecret(key: SecretStateKey) {
		return this.secretCache[key]
	}

	storeSecret(key: SecretStateKey, value?: string) {
		// Update cache.
		this.secretCache[key] = value

		// Write directly to context.
		return value === undefined
			? this.originalContext.secrets.delete(key)
			: this.originalContext.secrets.store(key, value)
	}

	private getAllSecretState(): SecretState {
		return Object.fromEntries(SECRET_STATE_KEYS.map((key) => [key, this.getSecret(key)]))
	}

	/**
	 * GlobalSettings
	 */

	public getGlobalSettings(): GlobalSettings {
		const values = this.getValues()

		try {
			return globalSettingsSchema.parse(values)
		} catch (error) {
			if (error instanceof ZodError) {
				telemetryService.captureSchemaValidationError({ schemaName: "GlobalSettings", error })
			}

			return GLOBAL_SETTINGS_KEYS.reduce((acc, key) => ({ ...acc, [key]: values[key] }), {} as GlobalSettings)
		}
	}

	/**
	 * ProviderSettings
	 */

	public getProviderSettings(): ProviderSettings {
		const values = this.getValues()

		try {
			return providerSettingsSchema.parse(values)
		} catch (error) {
			if (error instanceof ZodError) {
				telemetryService.captureSchemaValidationError({ schemaName: "ProviderSettings", error })
			}

			return PROVIDER_SETTINGS_KEYS.reduce((acc, key) => ({ ...acc, [key]: values[key] }), {} as ProviderSettings)
		}
	}

	public async setProviderSettings(values: ProviderSettings) {
		// Explicitly clear out any old API configuration values before that
		// might not be present in the new configuration.
		// If a value is not present in the new configuration, then it is assumed
		// that the setting's value should be `undefined` and therefore we
		// need to remove it from the state cache if it exists.
		await this.setValues({
			...PROVIDER_SETTINGS_KEYS.filter((key) => !isSecretStateKey(key))
				.filter((key) => !!this.stateCache[key])
				.reduce((acc, key) => ({ ...acc, [key]: undefined }), {} as ProviderSettings),
			...values,
		})
	}

	/**
	 * RooCodeSettings
	 */

	public setValue<K extends RooCodeSettingsKey>(key: K, value: RooCodeSettings[K]) {
		return isSecretStateKey(key) ? this.storeSecret(key, value as string) : this.updateGlobalState(key, value)
	}

	public getValue<K extends RooCodeSettingsKey>(key: K): RooCodeSettings[K] {
		return isSecretStateKey(key)
			? (this.getSecret(key) as RooCodeSettings[K])
			: (this.getGlobalState(key) as RooCodeSettings[K])
	}

	public getValues(): RooCodeSettings {
		return { ...this.getAllGlobalState(), ...this.getAllSecretState() }
	}

	public async setValues(values: RooCodeSettings) {
		const entries = Object.entries(values) as [RooCodeSettingsKey, unknown][]
		await Promise.all(entries.map(([key, value]) => this.setValue(key, value)))
	}

	/**
	 * Import / Export
	 */

	public async export(): Promise<GlobalSettings | undefined> {
		try {
			const globalSettings = globalSettingsExportSchema.parse(this.getValues())
			return Object.fromEntries(Object.entries(globalSettings).filter(([_, value]) => value !== undefined))
		} catch (error) {
			if (error instanceof ZodError) {
				telemetryService.captureSchemaValidationError({ schemaName: "GlobalSettings", error })
			}

			return undefined
		}
	}

	/**
	 * Resets all global state, secrets, and in-memory caches.
	 * This clears all data from both the in-memory caches and the VSCode storage.
	 * @returns A promise that resolves when all reset operations are complete
	 */
	public async resetAllState() {
		// Clear in-memory caches
		this.stateCache = {}
		this.secretCache = {}

		await Promise.all([
			...GLOBAL_STATE_KEYS.map((key) => this.originalContext.globalState.update(key, undefined)),
			...SECRET_STATE_KEYS.map((key) => this.originalContext.secrets.delete(key)),
		])

		await this.initialize()
	}
}
