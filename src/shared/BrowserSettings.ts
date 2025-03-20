export interface BrowserSettings {
	/**
	 * Viewport size settings for the browser window
	 */
	viewport: {
		width: number
		height: number
	}
	/**
	 * Whether to run the browser in headless mode (no visible window)
	 */
	headless: boolean
}

// Import vscode to access configuration and the logger
import * as vscode from "vscode"
import { Logger } from "../services/logging/Logger"

/**
 * Available viewport size presets that users can select from settings
 */
export const BROWSER_VIEWPORT_PRESETS = {
	"Full HD (1920x1080)": { width: 1920, height: 1080 },
	"Large Desktop (1280x800)": { width: 1280, height: 800 },
	"Small Desktop (900x600)": { width: 900, height: 600 },
	"Tablet (768x1024)": { width: 768, height: 1024 },
	"Mobile (360x640)": { width: 360, height: 640 },
} as const

/**
 * Default viewport dimensions if no configuration is available
 */
const DEFAULT_VIEWPORT = { width: 900, height: 600 }

/**
 * Type guard to verify a string is a valid preset key
 */
export function isValidPreset(setting: string): setting is keyof typeof BROWSER_VIEWPORT_PRESETS {
	return setting in BROWSER_VIEWPORT_PRESETS
}

/**
 * Creates browser settings based on user configuration.
 * Reads from VSCode configuration if available, otherwise uses defaults.
 * @returns {BrowserSettings} Configured browser settings
 */
export function getConfiguredBrowserSettings(): BrowserSettings {
	try {
		const config = vscode.workspace.getConfiguration("cline")
		const viewportSetting = config.get<string>("defaultBrowserViewport", "Small Desktop (900x600)")

		let viewport = { ...DEFAULT_VIEWPORT }

		if (viewportSetting === "Custom") {
			// Use Custom dimensions from settings
			viewport = {
				width: config.get<number>("defaultBrowserViewportWidth", DEFAULT_VIEWPORT.width),
				height: config.get<number>("defaultBrowserViewportHeight", DEFAULT_VIEWPORT.height),
			}
		} else if (viewportSetting && isValidPreset(viewportSetting)) {
			// Use preset dimensions
			const preset = BROWSER_VIEWPORT_PRESETS[viewportSetting]
			viewport = {
				width: preset.width,
				height: preset.height,
			}
		}

		return {
			viewport,
			headless: true,
		}
	} catch (e) {
		// Log error to VSCode's output channel
		Logger.log(`Failed to read browser settings from config: ${e instanceof Error ? e.message : String(e)}`)

		// Fallback for tests or non-VSCode environments
		return {
			viewport: DEFAULT_VIEWPORT,
			headless: true,
		}
	}
}

/**
 * Browser settings initialized from configuration when the module is loaded.
 * Used throughout the extension wherever browser settings are needed.
 */
export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = getConfiguredBrowserSettings()
