// VS Code settings.json → Cline StateManager bridge (V14 §3.2)
//
// package.json declares a `cline.*` `contributes.configuration` schema so users
// get IntelliSense, Settings Sync and remote-config support for Cline settings.
// This module is the READ side: it imports `cline.*` values a user explicitly
// set in their settings.json into the file-backed StateManager.
//
// Semantics (single-direction, safe by construction):
//   - Initial import: a settings.json value is imported ONLY when StateManager
//     has no value yet — values chosen through the Cline UI always win.
//   - Later edits: when the user edits `cline.*` in settings.json while Cline
//     is running, the new value is applied (user's explicit intent).
//   - Cline never WRITES back to settings.json, so there is no write loop.

import * as vscode from "vscode"
import { Logger } from "@/shared/services/Logger"

/** VS Code configuration section mirrored by this bridge. */
export const SETTINGS_SECTION = "cline"

/**
 * settings.json key → StateManager global-state key mapping.
 * Keep in sync with the `contributes.configuration` schema in package.json
 * (the schema keys must match the LEFT side of this map).
 */
export const SETTINGS_SCHEMA_MAP: Record<string, string> = {
	language: "preferredLanguage",
	requestTimeoutMs: "requestTimeoutMs",
	terminalConnectionTimeout: "shellIntegrationTimeout",
	terminalReuseEnabled: "terminalReuseEnabled",
	terminalExecutionMode: "vscodeTerminalExecutionMode",
	defaultTerminalProfile: "defaultTerminalProfile",
	backgroundEditEnabled: "backgroundEditEnabled",
	enableCheckpoints: "enableCheckpointsSetting",
	autoCompact: "useAutoCondense",
	hooksEnabled: "hooksEnabled",
	showFeatureTips: "showFeatureTips",
	mcpDisplayMode: "mcpDisplayMode",
	maxConsecutiveMistakes: "maxConsecutiveMistakes",
	subagentsEnabled: "subagentsEnabled",
	worktreesEnabled: "worktreesEnabled",
	yoloMode: "yoloModeToggled",
	openTelemetryEnabled: "openTelemetryEnabled",
}

/** Minimal surface of the VS Code configuration API used by the bridge. */
export interface SettingsBridgeDeps {
	readSettingsJson(): Record<string, unknown>
	onDidChangeConfiguration(listener: (e: { affectsConfiguration(section: string): boolean }) => void): {
		dispose(): void
	}
}

/** Minimal StateManager surface used by the bridge. */
export interface SettingsBridgeWriter {
	readState(stateKey: string): unknown
	writeState(stateKey: string, value: unknown): void
}

export interface SettingsImport {
	stateKey: string
	value: unknown
}

/**
 * Pure planner: decide which settings.json values to import given the current
 * StateManager values.
 *
 * @param settingsJson raw `cline` configuration section values
 * @param current current StateManager values keyed by state key
 * @param map settings-key → state-key mapping (defaults to SETTINGS_SCHEMA_MAP)
 */
export function computeSettingsImport(
	settingsJson: Record<string, unknown>,
	current: Record<string, unknown>,
	map: Record<string, string> = SETTINGS_SCHEMA_MAP,
): SettingsImport[] {
	const plan: SettingsImport[] = []
	for (const [settingsKey, stateKey] of Object.entries(map)) {
		const value = settingsJson[settingsKey]
		if (value === undefined) {
			continue
		}
		// Initial-import rule: never clobber a value the user picked in the UI.
		if (current[stateKey] !== undefined) {
			continue
		}
		plan.push({ stateKey, value })
	}
	return plan
}

/**
 * Pure planner for live edits: a settings.json change always wins (the user is
 * explicitly editing the file right now).
 */
export function computeSettingsOverride(
	settingsJson: Record<string, unknown>,
	current: Record<string, unknown>,
	map: Record<string, string> = SETTINGS_SCHEMA_MAP,
): SettingsImport[] {
	const plan: SettingsImport[] = []
	for (const [settingsKey, stateKey] of Object.entries(map)) {
		const value = settingsJson[settingsKey]
		if (value === undefined) {
			continue
		}
		if (current[stateKey] === value) {
			continue
		}
		plan.push({ stateKey, value })
	}
	return plan
}

/**
 * Bridge that imports `cline.*` settings.json values into StateManager.
 * Register once at extension activation; dispose on deactivation.
 */
export class VscodeSettingsBridge {
	private readonly disposables: Array<{ dispose(): void }> = []

	constructor(
		private readonly deps: SettingsBridgeDeps,
		private readonly writer: SettingsBridgeWriter,
	) {}

	/**
	 * One-shot initial import. Safe to call multiple times (idempotent: values
	 * already present in StateManager are never overwritten).
	 */
	importInitial(): void {
		const settingsJson = this.deps.readSettingsJson()
		const current: Record<string, unknown> = {}
		for (const stateKey of Object.values(SETTINGS_SCHEMA_MAP)) {
			current[stateKey] = this.writer.readState(stateKey)
		}
		const plan = computeSettingsImport(settingsJson, current)
		for (const entry of plan) {
			this.writer.writeState(entry.stateKey, entry.value)
			Logger.log(`[SettingsBridge] Imported cline.${entry.stateKey} from settings.json`)
		}
	}

	/**
	 * Subscribe to live settings.json edits. Returns this bridge for chaining.
	 */
	start(): this {
		const disposable = this.deps.onDidChangeConfiguration((e) => {
			if (!e.affectsConfiguration(SETTINGS_SECTION)) {
				return
			}
			try {
				const settingsJson = this.deps.readSettingsJson()
				const current: Record<string, unknown> = {}
				for (const stateKey of Object.values(SETTINGS_SCHEMA_MAP)) {
					current[stateKey] = this.writer.readState(stateKey)
				}
				const plan = computeSettingsOverride(settingsJson, current)
				for (const entry of plan) {
					this.writer.writeState(entry.stateKey, entry.value)
					Logger.log(`[SettingsBridge] Applied cline.${entry.stateKey} = ${JSON.stringify(entry.value)}`)
				}
			} catch (error) {
				Logger.error("[SettingsBridge] Failed to apply settings.json change", error)
			}
		})
		this.disposables.push(disposable)
		return this
	}

	dispose(): void {
		for (const disposable of this.disposables.splice(0)) {
			try {
				disposable.dispose()
			} catch {
				// best effort
			}
		}
	}
}

/**
 * Default dependency adapter backed by the real VS Code configuration API.
 * `WorkspaceConfiguration` is not a plain object, so values are read through
 * `get()` for exactly the keys declared in SETTINGS_SCHEMA_MAP (which mirror
 * the package.json `contributes.configuration` schema).
 */
export function createVscodeSettingsDeps(): SettingsBridgeDeps {
	return {
		readSettingsJson: () => {
			const config = vscode.workspace.getConfiguration(SETTINGS_SECTION)
			const result: Record<string, unknown> = {}
			for (const settingsKey of Object.keys(SETTINGS_SCHEMA_MAP)) {
				result[settingsKey] = config.get(settingsKey)
			}
			return result
		},
		onDidChangeConfiguration: (listener) => vscode.workspace.onDidChangeConfiguration(listener),
	}
}
