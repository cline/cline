/**
 * Browser functionality configuration settings.
 *
 * This module defines types and constants for configuring the embedded browser
 * used by AI models to access web content. These settings control how the browser
 * renders pages, including viewport dimensions and execution mode.
 *
 * The embedded browser allows AI assistants to search the web, visit URLs,
 * and extract information from websites to provide up-to-date information
 * and perform research tasks on behalf of users.
 */

/**
 * Configuration settings for the embedded browser.
 *
 * These settings control the visual rendering and execution mode of the browser
 * used by AI assistants for web access.
 */
export interface BrowserSettings {
	/**
	 * Viewport dimensions that determine the visible area of web pages.
	 * This affects how responsive websites render content and can be used
	 * to emulate different device types (desktop, tablet, mobile).
	 */
	viewport: {
		/** Width of the browser viewport in pixels */
		width: number
		/** Height of the browser viewport in pixels */
		height: number
	}

	/**
	 * Whether to run the browser in headless mode.
	 *
	 * When true (headless):
	 * - The browser runs in the background without visible UI
	 * - More efficient for automated tasks and server environments
	 * - Pages render without displaying a window to the user
	 *
	 * When false (headed):
	 * - A browser window is shown to the user
	 * - Useful for debugging and watching the AI navigate
	 * - More resource-intensive but provides visual feedback
	 */
	headless: boolean

	/**
	 * Specifies which Chrome installation to use.
	 * Currently not implemented/enabled.
	 *
	 * Potential future options:
	 * - "chromium": Use the bundled Chromium browser
	 * - "system": Use the system's installed Chrome/Chromium
	 */
	// chromeType: "chromium" | "system"
}

/**
 * Default browser settings applied when custom settings are not provided.
 *
 * Uses a small desktop viewport (900x600) and runs in headless mode for efficiency.
 * These defaults balance between having adequate screen space for most websites
 * while maintaining reasonable performance.
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
 *
 * These presets allow testing how websites appear on different devices:
 * - Large Desktop: Suitable for content-rich websites and applications
 * - Small Desktop: Default setting, balances screen space and performance
 * - Tablet: Simulates tablet devices in portrait orientation
 * - Mobile: Simulates mobile phone screens
 *
 * Using these presets helps ensure the AI can properly interact with
 * responsive websites that adapt their layout to different screen sizes.
 */
export const BROWSER_VIEWPORT_PRESETS = {
	"Large Desktop (1280x800)": { width: 1280, height: 800 },
	"Small Desktop (900x600)": { width: 900, height: 600 },
	"Tablet (768x1024)": { width: 768, height: 1024 },
	"Mobile (360x640)": { width: 360, height: 640 },
} as const
