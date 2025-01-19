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

export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
	viewport: {
		width: 900,
		height: 600,
	},
	headless: true,
	// chromeType: "chromium",
}

export const BROWSER_VIEWPORT_PRESETS = {
	"Large Desktop (1280x800)": { width: 1280, height: 800 },
	"Small Desktop (900x600)": { width: 900, height: 600 },
	"Tablet (768x1024)": { width: 768, height: 1024 },
	"Mobile (360x640)": { width: 360, height: 640 },
} as const
