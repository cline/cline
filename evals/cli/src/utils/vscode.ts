import execa from "execa"
import * as path from "path"
import * as fs from "fs"
import fetch from "node-fetch"
import * as os from "os"
import { installRequiredExtensions, configureExtensionSettings } from "./extensions"

// Store temporary directories for cleanup
interface VSCodeResources {
	tempUserDataDir: string
	tempExtensionsDir: string
	vscodePid?: number
}

// Global map to track resources for each workspace
const workspaceResources = new Map<string, VSCodeResources>()

/**
 * Spawn a VSCode instance with the Cline extension
 * @param workspacePath The workspace path to open
 * @param vsixPath Optional path to a VSIX file to install
 * @returns The resources created for this VS Code instance
 */
export async function spawnVSCode(workspacePath: string, vsixPath?: string): Promise<VSCodeResources> {
	// Ensure the workspace path exists
	if (!fs.existsSync(workspacePath)) {
		throw new Error(`Workspace path does not exist: ${workspacePath}`)
	}

	// If no VSIX path is provided, build one with IS_TEST=true
	if (!vsixPath) {
		try {
			// Build the VSIX (no longer need to set IS_TEST=true as we'll use evals.env file)
			console.log("Building VSIX...")
			const clineRoot = path.resolve(process.cwd(), "..", "..")
			await execa("npx", ["vsce", "package"], {
				cwd: clineRoot,
				stdio: "inherit",
			})

			// Find the generated VSIX file(s)
			const files = fs.readdirSync(clineRoot)
			const vsixFiles = files.filter((file) => file.endsWith(".vsix"))

			if (vsixFiles.length > 0) {
				// Get file stats to find the most recent one
				const vsixFilesWithStats = vsixFiles.map((file) => {
					const filePath = path.join(clineRoot, file)
					return {
						file,
						path: filePath,
						mtime: fs.statSync(filePath).mtime,
					}
				})

				// Sort by modification time (most recent first)
				vsixFilesWithStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

				// Use the most recent VSIX
				vsixPath = vsixFilesWithStats[0].path
				console.log(`Using most recent VSIX: ${vsixPath} (modified ${vsixFilesWithStats[0].mtime.toISOString()})`)

				// Log all found VSIX files for debugging
				if (vsixFiles.length > 1) {
					console.log(`Found ${vsixFiles.length} VSIX files:`)
					vsixFilesWithStats.forEach((f) => {
						console.log(`  - ${f.file} (modified ${f.mtime.toISOString()})`)
					})
				}
			} else {
				console.warn("Could not find generated VSIX file")
			}
		} catch (error) {
			console.warn("Failed to build test VSIX:", error)
		}
	}

	// Create a temporary user data directory for this VS Code instance
	const tempUserDataDir = path.join(os.tmpdir(), `vscode-cline-eval-${Date.now()}`)
	fs.mkdirSync(tempUserDataDir, { recursive: true })
	console.log(`Created temporary user data directory: ${tempUserDataDir}`)

	// Create a temporary extensions directory to ensure no other extensions are loaded
	const tempExtensionsDir = path.join(os.tmpdir(), `vscode-cline-eval-ext-${Date.now()}`)
	fs.mkdirSync(tempExtensionsDir, { recursive: true })
	console.log(`Created temporary extensions directory: ${tempExtensionsDir}`)

	// Create evals.env file in the workspace to trigger test mode
	console.log(`Creating evals.env file in workspace: ${workspacePath}`)
	const evalsEnvPath = path.join(workspacePath, "evals.env")
	fs.writeFileSync(
		evalsEnvPath,
		`# This file activates Cline test mode
# Created at: ${new Date().toISOString()}
# 
# This file is automatically detected by the Cline extension
# and enables test mode for automated evaluations.
#
# Delete this file to deactivate test mode.
`,
	)

	// Create settings.json in the temporary user data directory to disable workspace trust
	// and configure Cline to auto-open on startup
	const settingsDir = path.join(tempUserDataDir, "User")
	fs.mkdirSync(settingsDir, { recursive: true })
	const settingsPath = path.join(settingsDir, "settings.json")
	const settings = {
		// Disable workspace trust
		"security.workspace.trust.enabled": false,
		"security.workspace.trust.startupPrompt": "never",
		"security.workspace.trust.banner": "never",
		"security.workspace.trust.emptyWindow": true,

		// Configure startup behavior
		"workbench.startupEditor": "none",

		// Auto-open Cline on startup
		"cline.autoOpenOnStartup": true,

		// Show the activity bar and sidebar
		"workbench.activityBar.visible": true,
		"workbench.sideBar.visible": true,
		"workbench.view.extension.saoudrizwan.claude-dev-ActivityBar.visible": true,
		"workbench.view.alwaysShowHeaderActions": true,
		"workbench.editor.openSideBySideDirection": "right",

		// Disable GitLens from opening automatically
		"gitlens.views.repositories.autoReveal": false,
		"gitlens.views.fileHistory.autoReveal": false,
		"gitlens.views.lineHistory.autoReveal": false,
		"gitlens.views.compare.autoReveal": false,
		"gitlens.views.search.autoReveal": false,
		"gitlens.showWelcomeOnInstall": false,
		"gitlens.showWhatsNewAfterUpgrades": false,

		// Disable other extensions that might compete for startup focus
		"extensions.autoUpdate": false,
	}
	fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
	console.log(`Created settings.json to disable workspace trust and auto-open Cline`)

	// Create keybindings.json to automatically open Cline on startup
	const keybindingsPath = path.join(settingsDir, "keybindings.json")
	const keybindings = [
		{
			key: "alt+c",
			command: "workbench.view.extension.saoudrizwan.claude-dev-ActivityBar",
			when: "viewContainer.workbench.view.extension.saoudrizwan.claude-dev-ActivityBar.enabled",
		},
		{
			key: "alt+shift+c",
			command: "cline.openInNewTab",
			when: "viewContainer.workbench.view.extension.saoudrizwan.claude-dev-ActivityBar.enabled",
		},
	]
	fs.writeFileSync(keybindingsPath, JSON.stringify(keybindings, null, 2))
	console.log(`Created keybindings.json to help with Cline activation`)

	// Build the command arguments with custom user data directory
	const args = [
		// Use a custom user data directory to isolate this instance
		"--user-data-dir",
		tempUserDataDir,
		// Use a custom extensions directory to ensure only our extension is loaded
		"--extensions-dir",
		tempExtensionsDir,
		// Disable workspace trust
		"--disable-workspace-trust",
		"-n",
		workspacePath,
		// Force the extension to be activated on startup
		"--start-up-extension",
		"saoudrizwan.claude-dev",
		// Run a command on startup to open Cline
		"--command",
		"workbench.view.extension.saoudrizwan.claude-dev-ActivityBar",
		// Additional flags to help with extension activation
		"--disable-gpu=false",
		"--max-memory=4096",
	]

	// Create a startup script to run commands after VS Code launches
	const startupScriptPath = path.join(settingsDir, "startup.js")
	const startupScript = `
		// This script will be executed when VS Code starts
		setTimeout(() => {
			// Try to open Cline in the sidebar
			require('vscode').commands.executeCommand('workbench.view.extension.saoudrizwan.claude-dev-ActivityBar');
			
			// Also try to open Cline in a tab as a fallback
			setTimeout(() => {
				require('vscode').commands.executeCommand('cline.openInNewTab');
			}, 5000);
		}, 5000);
	`
	fs.writeFileSync(startupScriptPath, startupScript)
	console.log(`Created startup script to activate Cline`)

	// If a VSIX is provided, install it
	if (vsixPath) {
		if (!fs.existsSync(vsixPath)) {
			throw new Error(`VSIX file does not exist: ${vsixPath}`)
		}
		args.unshift("--install-extension", vsixPath)
	}

	// Install required extensions
	console.log("Installing required VSCode extensions...")
	await installRequiredExtensions(tempExtensionsDir)

	// Configure extension settings
	console.log("Configuring extension settings...")
	configureExtensionSettings(tempUserDataDir)

	// Execute the command
	try {
		// We don't need to install extensions globally anymore since we're using a custom user data directory
		// The VSIX will be installed in the isolated environment if provided in the args

		// Launch VS Code
		console.log("Launching VS Code...")
		await execa("code", args, {
			stdio: "inherit",
		})

		// Wait longer for VSCode to initialize and extension to load
		console.log("Waiting for VS Code to initialize...")
		await new Promise((resolve) => setTimeout(resolve, 30000))

		// Create a JavaScript file that will be loaded as a VS Code extension
		const extensionDir = path.join(tempExtensionsDir, "cline-activator")
		fs.mkdirSync(extensionDir, { recursive: true })

		// Create package.json for the extension
		const packageJsonPath = path.join(extensionDir, "package.json")
		const packageJson = {
			name: "cline-activator",
			displayName: "Cline Activator",
			description: "Activates Cline and starts the test server",
			version: "0.0.1",
			engines: {
				vscode: "^1.60.0",
			},
			main: "./extension.js",
			activationEvents: ["*"],
			contributes: {
				commands: [
					{
						command: "cline-activator.activate",
						title: "Activate Cline",
					},
				],
			},
		}
		fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2))

		// Create extension.js
		const extensionJsPath = path.join(extensionDir, "extension.js")
		const extensionJs = `
			const vscode = require('vscode');
			
			/**
			 * @param {vscode.ExtensionContext} context
			 */
			function activate(context) {
				console.log('Cline Activator is now active!');
				
				// Register the command to activate Cline
				let disposable = vscode.commands.registerCommand('cline-activator.activate', async function () {
					try {
						// Make sure the Cline extension is activated
						const extension = vscode.extensions.getExtension('saoudrizwan.claude-dev');
						if (!extension) {
							console.error('Cline extension not found');
							return;
						}
						
						if (!extension.isActive) {
							console.log('Activating Cline extension...');
							await extension.activate();
						}
						
						// Show the Cline sidebar
						console.log('Opening Cline sidebar...');
						await vscode.commands.executeCommand('workbench.view.extension.saoudrizwan.claude-dev-ActivityBar');
						
						// Wait a moment for the sidebar to initialize
						await new Promise(resolve => setTimeout(resolve, 2000));
						
						// Also open Cline in a tab as a fallback
						console.log('Opening Cline in a tab...');
						await vscode.commands.executeCommand('cline.openInNewTab');
						
						// Wait a moment for the tab to initialize
						await new Promise(resolve => setTimeout(resolve, 2000));
						
						// Create the test server if it doesn't exist
						console.log('Creating test server...');
						
						// Get the visible webview instance
						const clineRootPath = '${path.resolve(process.cwd(), "..", "..")}';
						const visibleWebview = require(path.join(clineRootPath, 'src', 'core', 'webview')).WebviewProvider.getVisibleInstance();
						if (visibleWebview) {
							require(path.join(clineRootPath, 'src', 'services', 'test', 'TestServer')).createTestServer(visibleWebview);
							console.log('Test server created successfully');
						} else {
							console.error('No visible webview instance found');
						}
					} catch (error) {
						console.error('Error activating Cline:', error);
					}
				});
				
				context.subscriptions.push(disposable);
				
				// Automatically run the command after a delay
				setTimeout(() => {
					vscode.commands.executeCommand('cline-activator.activate');
				}, 5000);
			}
			
			function deactivate() {}
			
			module.exports = {
				activate,
				deactivate
			}
		`
		fs.writeFileSync(extensionJsPath, extensionJs)
		console.log(`Created Cline Activator extension`)

		// Try multiple approaches to activate the extension
		let serverStarted = false

		// Create an activation script to run in VS Code
		const activationScriptPath = path.join(settingsDir, "activate-cline.js")
		const activationScript = `
			// This script will be executed to activate Cline and start the test server
			const vscode = require('vscode');
			
			// Execute the cline-activator.activate command
			vscode.commands.executeCommand('cline-activator.activate');
		`
		fs.writeFileSync(activationScriptPath, activationScript)
		console.log(`Created activation script to run in VS Code`)

		// Execute the activation script
		try {
			console.log("Executing activation script to start Cline and test server...")
			await execa(
				"code",
				[
					"--user-data-dir",
					tempUserDataDir,
					"--extensions-dir",
					tempExtensionsDir,
					"--folder-uri",
					`file://${workspacePath}`,
					"--execute",
					activationScriptPath,
				],
				{
					stdio: "inherit",
				},
			)

			// Wait for the test server to start
			console.log("Waiting for test server to start...")
			for (let i = 0; i < 30; i++) {
				try {
					// Try to connect to the test server
					const response = await fetch("http://localhost:9876/task", {
						method: "OPTIONS",
						headers: {
							"Content-Type": "application/json",
						},
					})

					if (response.status === 204) {
						console.log("Test server is running!")
						serverStarted = true
						break
					}
				} catch (error) {
					// Server not started yet, wait and try again
					await new Promise((resolve) => setTimeout(resolve, 1000))
				}
			}
		} catch (error) {
			console.warn("Failed to execute activation script:", error)
		}

		if (!serverStarted) {
			console.warn("Test server did not start after multiple attempts")
			console.log("You may need to manually open the Cline extension in VS Code")
		}

		// Store the resources for this workspace
		const resources: VSCodeResources = {
			tempUserDataDir,
			tempExtensionsDir,
		}

		// Store in the global map
		workspaceResources.set(workspacePath, resources)

		// Return the resources
		return resources
	} catch (error: any) {
		throw new Error(`Failed to spawn VSCode: ${error.message}`)
	}
}

/**
 * Clean up VS Code resources and shut down the test server
 * @param workspacePath The workspace path to clean up resources for
 */
export async function cleanupVSCode(workspacePath: string): Promise<void> {
	console.log(`Cleaning up VS Code resources for workspace: ${workspacePath}`)

	// Get the resources for this workspace
	const resources = workspaceResources.get(workspacePath)
	if (!resources) {
		console.log(`No resources found for workspace: ${workspacePath}`)
		return
	}

	// Try to shut down the test server
	try {
		console.log("Shutting down test server...")
		await fetch("http://localhost:9876/shutdown", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
		}).catch(() => {
			// Ignore errors, the server might already be down
		})
	} catch (error) {
		console.warn(`Error shutting down test server: ${error}`)
	}

	// Try to gracefully close VS Code instead of killing it
	try {
		console.log("Attempting to gracefully close VS Code...")

		// Create a settings file that will disable the crash reporter and the exit confirmation dialog
		const settingsDir = path.join(resources.tempUserDataDir, "User")
		const settingsPath = path.join(settingsDir, "settings.json")

		// Read existing settings if they exist
		let settings = {}
		if (fs.existsSync(settingsPath)) {
			try {
				settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"))
			} catch (error) {
				console.warn(`Error reading settings file: ${error}`)
			}
		}

		// Update settings to disable crash reporter and exit confirmation
		settings = {
			...settings,
			"window.confirmBeforeClose": "never",
			"telemetry.enableCrashReporter": false,
			"window.restoreWindows": "none",
			"window.newWindowDimensions": "default",
		}

		// Write updated settings
		fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))

		// On macOS, use AppleScript to quit VS Code gracefully
		if (process.platform === "darwin") {
			try {
				// First try AppleScript to quit VS Code gracefully
				await execa("osascript", ["-e", 'tell application "Visual Studio Code" to quit'])

				// Wait a moment for VS Code to close
				await new Promise((resolve) => setTimeout(resolve, 2000))
			} catch (appleScriptError) {
				console.warn(`Error using AppleScript to quit VS Code: ${appleScriptError}`)
			}
		} else if (process.platform === "win32") {
			// On Windows, try to use taskkill without /F first
			try {
				await execa("taskkill", ["/IM", "code.exe"])

				// Wait a moment for VS Code to close
				await new Promise((resolve) => setTimeout(resolve, 2000))
			} catch (taskkillError) {
				console.warn(`Error using taskkill to quit VS Code: ${taskkillError}`)
			}
		} else {
			// On Linux, try to use SIGTERM first
			try {
				// Find VS Code processes
				const { stdout } = await execa("ps", ["aux"])
				const lines = stdout.split("\n")

				for (const line of lines) {
					if (line.includes(resources.tempUserDataDir)) {
						const parts = line.trim().split(/\s+/)
						const pid = parseInt(parts[1])

						if (pid && !isNaN(pid)) {
							console.log(`Sending SIGTERM to VS Code process with PID: ${pid}`)
							try {
								// Use SIGTERM instead of SIGKILL for a graceful shutdown
								process.kill(pid, "SIGTERM")
							} catch (killError) {
								console.warn(`Failed to terminate process ${pid}: ${killError}`)
							}
						}
					}
				}

				// Wait a moment for VS Code to close
				await new Promise((resolve) => setTimeout(resolve, 2000))
			} catch (psError) {
				console.warn(`Error listing processes: ${psError}`)
			}
		}

		// If graceful methods failed, fall back to forceful termination as a last resort
		// Check if VS Code is still running with the temp user data dir
		let vsCodeStillRunning = false

		if (process.platform !== "win32") {
			try {
				const { stdout } = await execa("ps", ["aux"])
				vsCodeStillRunning = stdout.split("\n").some((line) => line.includes(resources.tempUserDataDir))
			} catch (error) {
				console.warn(`Error checking if VS Code is still running: ${error}`)
			}
		} else {
			try {
				const { stdout } = await execa("tasklist", ["/FI", `IMAGENAME eq code.exe`])
				vsCodeStillRunning = stdout.includes("code.exe")
			} catch (error) {
				console.warn(`Error checking if VS Code is still running: ${error}`)
			}
		}

		// If VS Code is still running, use forceful termination as a last resort
		if (vsCodeStillRunning) {
			console.log("Graceful shutdown failed, falling back to forceful termination...")

			if (process.platform === "win32") {
				try {
					await execa("taskkill", ["/IM", "code.exe", "/F"])
				} catch (error) {
					console.warn(`Error forcefully terminating VS Code: ${error}`)
				}
			} else {
				try {
					const { stdout } = await execa("ps", ["aux"])
					const lines = stdout.split("\n")

					for (const line of lines) {
						if (line.includes(resources.tempUserDataDir)) {
							const parts = line.trim().split(/\s+/)
							const pid = parseInt(parts[1])

							if (pid && !isNaN(pid)) {
								console.log(`Forcefully killing VS Code process with PID: ${pid}`)
								try {
									process.kill(pid, "SIGKILL")
								} catch (killError) {
									console.warn(`Failed to kill process ${pid}: ${killError}`)
								}
							}
						}
					}
				} catch (error) {
					console.warn(`Error forcefully terminating VS Code: ${error}`)
				}
			}
		}
	} catch (error) {
		console.warn(`Error closing VS Code: ${error}`)
	}

	// Clean up temporary directories and evals.env file
	try {
		console.log(`Removing temporary user data directory: ${resources.tempUserDataDir}`)
		fs.rmSync(resources.tempUserDataDir, { recursive: true, force: true })
	} catch (error) {
		console.warn(`Error removing temporary user data directory: ${error}`)
	}

	try {
		console.log(`Removing temporary extensions directory: ${resources.tempExtensionsDir}`)
		fs.rmSync(resources.tempExtensionsDir, { recursive: true, force: true })
	} catch (error) {
		console.warn(`Error removing temporary extensions directory: ${error}`)
	}

	// Remove the evals.env file
	try {
		const evalsEnvPath = path.join(workspacePath, "evals.env")
		if (fs.existsSync(evalsEnvPath)) {
			console.log(`Removing evals.env file: ${evalsEnvPath}`)
			fs.unlinkSync(evalsEnvPath)
		}
	} catch (error) {
		console.warn(`Error removing evals.env file: ${error}`)
	}

	// Remove from the global map
	workspaceResources.delete(workspacePath)

	console.log("Cleanup completed")
}
