/**
 * Browser functionality configuration settings.
 *
 * This module defines types and constants for configuring the embedded browser
 * used by AI models to access web content. These settings control how the browser
 * renders pages, including viewport dimensions and execution mode.
 */

/**
 * Configuration settings for the embedded browser.
 *
 * @property viewport - Dimensions of the browser viewport
 * @property viewport.width - Width of the viewport in pixels
 * @property viewport.height - Height of the viewport in pixels
 * @property headless - Whether to run the browser in headless mode (without visible UI)
 */
export interface BrowserSettings {
	// Viewport size settings
	viewport: {
		width: number
		height: number
	}
	// Browser mode settings
	headless: boolean
	// Chrome installation to use
	// chromeType: "chromium" | "system"
}

/**
 * Default browser settings applied when custom settings are not provided.
 * Uses a small desktop viewport (900x600) and runs in headless mode.
 */
export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
	viewport: {
		width: 900,
		height: 600,
	},
	headless: true,
	// chromeType: "chromium",
}

/**
 * Predefined viewport size configurations for common device types.
 * These presets can be selected by users to quickly configure the browser
 * for testing different screen sizes and responsive layouts.
 */
export const BROWSER_VIEWPORT_PRESETS = {
	"Large Desktop (1280x800)": { width: 1280, height: 800 },
	"Small Desktop (900x600)": { width: 900, height: 600 },
	"Tablet (768x1024)": { width: 768, height: 1024 },
	"Mobile (360x640)": { width: 360, height: 640 },
} as const
