import execa from "execa"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

/**
 * List of VSCode extensions to install for evaluation environments
 * These extensions provide language support and other useful features
 */
export const REQUIRED_EXTENSIONS = [
	"golang.go", // Go language support
	"dbaeumer.vscode-eslint", // ESLint support
	"redhat.java", // Java support
	"ms-python.python", // Python support
	"rust-lang.rust-analyzer", // Rust support
	"ms-vscode.cpptools", // C/C++ support
]

/**
 * Install required VSCode extensions in the specified extensions directory
 * @param extensionsDir The directory where extensions should be installed
 * @returns Promise that resolves when all extensions are installed
 */
export async function installRequiredExtensions(extensionsDir: string): Promise<void> {
	console.log("Installing required VSCode extensions...")

	// Create the extensions directory if it doesn't exist
	if (!fs.existsSync(extensionsDir)) {
		fs.mkdirSync(extensionsDir, { recursive: true })
	}

	// Install each extension
	for (const extension of REQUIRED_EXTENSIONS) {
		try {
			console.log(`Installing extension: ${extension}...`)
			await execa("code", ["--extensions-dir", extensionsDir, "--install-extension", extension, "--force"])
			console.log(`✅ Extension ${extension} installed successfully`)
		} catch (error: any) {
			console.warn(`⚠️ Failed to install extension ${extension}: ${error.message}`)
			// Continue with other extensions even if one fails
		}
	}

	console.log("✅ All required extensions installed")
}

/**
 * Check if a VSCode extension is installed in the specified directory
 * @param extensionsDir The directory to check for installed extensions
 * @param extensionId The ID of the extension to check
 * @returns True if the extension is installed, false otherwise
 */
export function isExtensionInstalled(extensionsDir: string, extensionId: string): boolean {
	// Extensions are installed in directories named publisher.name-version
	// We need to check if any directory starts with the extensionId
	const extensionPrefix = extensionId.toLowerCase() + "-"

	try {
		const files = fs.readdirSync(extensionsDir)
		return files.some((file) => {
			const lowerCaseFile = file.toLowerCase()
			return lowerCaseFile === extensionId.toLowerCase() || lowerCaseFile.startsWith(extensionPrefix)
		})
	} catch (error) {
		return false
	}
}

/**
 * Get the path to the VSCode settings file in the specified user data directory
 * @param userDataDir The VSCode user data directory
 * @returns The path to the settings.json file
 */
export function getSettingsPath(userDataDir: string): string {
	const settingsDir = path.join(userDataDir, "User")
	fs.mkdirSync(settingsDir, { recursive: true })
	return path.join(settingsDir, "settings.json")
}

/**
 * Configure extension settings in the VSCode user data directory
 * @param userDataDir The VSCode user data directory
 */
export function configureExtensionSettings(userDataDir: string): void {
	const settingsPath = getSettingsPath(userDataDir)

	// Read existing settings if they exist
	let settings = {}
	if (fs.existsSync(settingsPath)) {
		try {
			settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"))
		} catch (error) {
			console.warn(`Error reading settings file: ${error}`)
		}
	}

	// Add or update extension-specific settings
	const updatedSettings = {
		...settings,
		// Go extension settings
		"go.toolsManagement.autoUpdate": false,
		"go.survey.prompt": false,

		// ESLint settings
		"eslint.enable": true,
		"eslint.run": "onSave",

		// Java settings
		"java.configuration.checkProjectSettingsExclusions": false,
		"java.configure.checkForOutdatedExtensions": false,
		"java.help.firstView": false,

		// Python settings
		"python.experiments.enabled": false,
		"python.showStartPage": false,

		// Rust settings
		"rust-analyzer.checkOnSave.command": "check",

		// C/C++ settings
		"C_Cpp.intelliSenseEngine": "default",

		// General extension settings
		"extensions.autoUpdate": false,
		"extensions.ignoreRecommendations": true,
	}

	// Write updated settings
	fs.writeFileSync(settingsPath, JSON.stringify(updatedSettings, null, 2))
	console.log("✅ Extension settings configured")
}
