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
	remoteBrowserHost?: string
	setCachedStateField: SetCachedStateField<
		"browserToolEnabled" | "browserViewportSize" | "screenshotQuality" | "remoteBrowserHost"
	>
}

export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
	viewport: {
		width: 900,
		height: 600,
	},
	headless: true,
	remoteBrowserHost,
	// chromeType: "chromium",
}

export const BROWSER_VIEWPORT_PRESETS = {
	"Large Desktop (1280x800)": { width: 1280, height: 800 },
	"Small Desktop (900x600)": { width: 900, height: 600 },
	"Tablet (768x1024)": { width: 768, height: 1024 },
	"Mobile (360x640)": { width: 360, height: 640 },
} as const

const testConnection = async () => {
	try {
		// Send a message to the extension to test the connection
		vscode.postMessage({
			type: "testBrowserConnection",
			text: remoteBrowserHost,
		})
	} catch (error) {
		setTestResult({
			success: false,
			message: `Error: ${error instanceof Error ? error.message : String(error)}`,
		})
	}
}

const discoverBrowser = async () => {
	try {
		// Send a message to the extension to discover Chrome instances
		vscode.postMessage({
			type: "discoverBrowser",
		})
	} catch (error) {
		setTestResult({
			success: false,
			message: `Error: ${error instanceof Error ? error.message : String(error)}`,
		})
	}
}
