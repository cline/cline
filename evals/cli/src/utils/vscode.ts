import execa from "execa"
import * as path from "path"
import * as fs from "fs"
import fetch from "node-fetch"

/**
 * Spawn a VSCode instance with the Cline extension
 * @param workspacePath The workspace path to open
 * @param vsixPath Optional path to a VSIX file to install
 */
export async function spawnVSCode(workspacePath: string, vsixPath?: string): Promise<void> {
	// Ensure the workspace path exists
	if (!fs.existsSync(workspacePath)) {
		throw new Error(`Workspace path does not exist: ${workspacePath}`)
	}

	// If no VSIX path is provided, build one with IS_TEST=true
	if (!vsixPath) {
		try {
			// Build the VSIX with IS_TEST=true
			console.log("Building test VSIX...")
			const clineRoot = path.resolve(process.cwd(), "..", "..")
			await execa("npx", ["vsce", "package"], {
				cwd: clineRoot,
				env: {
					IS_TEST: "true",
				},
				stdio: "inherit",
			})

			// Find the generated VSIX file
			const files = fs.readdirSync(clineRoot)
			const vsixFile = files.find((file) => file.endsWith(".vsix"))
			if (vsixFile) {
				vsixPath = path.join(clineRoot, vsixFile)
				console.log(`Using built VSIX: ${vsixPath}`)
			} else {
				console.warn("Could not find generated VSIX file")
			}
		} catch (error) {
			console.warn("Failed to build test VSIX:", error)
		}
	}

	// Create a backup of the user's settings and add our temporary settings
	const userDataDir = path.join(os.homedir(), "Library", "Application Support", "Code", "User")
	const settingsPath = path.join(userDataDir, "settings.json")
	const settingsBackupPath = path.join(userDataDir, "settings.json.cline-backup")
	
	try {
		// Ensure the directory exists
		fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
		
		// Create a backup of the existing settings if they exist
		if (fs.existsSync(settingsPath) && !fs.existsSync(settingsBackupPath)) {
			try {
				fs.copyFileSync(settingsPath, settingsBackupPath)
				console.log(`Created backup of VS Code settings at ${settingsBackupPath}`)
			} catch (error) {
				console.warn("Failed to create backup of settings:", error)
			}
		}
		
		// Read existing settings if they exist
		let settings: Record<string, any> = {}
		if (fs.existsSync(settingsPath)) {
			try {
				const settingsContent = fs.readFileSync(settingsPath, "utf-8")
				settings = JSON.parse(settingsContent)
			} catch (error) {
				console.warn("Failed to parse existing settings:", error)
			}
		}
		
		// Add our settings to auto-open Cline, but preserve existing values
		const newSettings = {
			...settings,
			// Only set these if they don't already exist
			"workbench.startupEditor": settings["workbench.startupEditor"] || "none",
			"workbench.activityBar.visible": settings["workbench.activityBar.visible"] !== false,
			"window.restoreWindows": settings["window.restoreWindows"] || "none",
			"window.newWindowDimensions": settings["window.newWindowDimensions"] || "default",
			"workbench.statusBar.visible": settings["workbench.statusBar.visible"] !== false,
		}
		
		// Write the settings back
		fs.writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2))
		console.log("Updated VS Code settings to help with extension activation")
		
		// Register a cleanup function to restore settings on process exit
		process.on('exit', () => {
			if (fs.existsSync(settingsBackupPath)) {
				try {
					fs.copyFileSync(settingsBackupPath, settingsPath)
					fs.unlinkSync(settingsBackupPath)
					console.log("Restored original VS Code settings")
				} catch (error) {
					console.warn("Failed to restore settings:", error)
				}
			}
		})
	} catch (error) {
		console.warn("Failed to update VS Code settings:", error)
	}

	// Build the command arguments
	const args = [
		"--disable-workspace-trust",
		"-n",
		workspacePath,
		// Force the extension to be activated on startup
		"--start-up-extension", "saoudrizwan.claude-dev",
		// Additional flags to help with extension activation
		"--disable-extensions=false",
		"--disable-gpu=false",
		"--max-memory=4096"
	]

	// If a VSIX is provided, install it
	if (vsixPath) {
		if (!fs.existsSync(vsixPath)) {
			throw new Error(`VSIX file does not exist: ${vsixPath}`)
		}
		args.unshift("--install-extension", vsixPath)
	}

	// Execute the command
	try {
		// Install common extensions that might help with activation
		console.log("Installing common VS Code extensions...")
		try {
			await execa("code", ["--install-extension", "dbaeumer.vscode-eslint"], { stdio: "ignore" })
			await execa("code", ["--install-extension", "ms-python.python"], { stdio: "ignore" })
		} catch (error) {
			console.warn("Failed to install some VS Code extensions:", error)
		}

		// Explicitly install our extension by ID to ensure it's properly registered
		console.log("Ensuring Cline extension is installed...")
		await execa("code", ["--install-extension", "saoudrizwan.claude-dev"], {
			stdio: "ignore",
		})

		// Launch VS Code
		console.log("Launching VS Code...")
		await execa("code", args, {
			stdio: "inherit",
		})

		// Wait longer for VSCode to initialize and extension to load
		console.log("Waiting for VS Code to initialize...")
		await new Promise((resolve) => setTimeout(resolve, 15000))

		// Try multiple approaches to activate the extension
		let serverStarted = false

		// Approach 1: Focus the Cline sidebar view
		if (!serverStarted) {
			try {
				console.log("Attempting to focus Cline sidebar (approach 1)...")
				// This command focuses the Cline sidebar view
				await execa(
					"code",
					["--folder-uri", `file://${workspacePath}`, "--command", "workbench.view.extension.saoudrizwan.claude-dev-ActivityBar"],
					{
						stdio: "ignore",
					},
				)
				
				// Wait a moment for the sidebar to open
				await new Promise((resolve) => setTimeout(resolve, 3000))
				
				// Then try to focus the specific view inside the sidebar
				await execa(
					"code",
					[
						"--folder-uri",
						`file://${workspacePath}`,
						"--command",
						"workbench.view.extension.saoudrizwan.claude-dev.SidebarProvider.focus",
					],
					{
						stdio: "ignore",
					},
				)
				
				// Wait for the test server to start
				console.log("Waiting for test server to start...")
				for (let i = 0; i < 15; i++) {
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
				console.warn("Failed to focus Cline sidebar (approach 1):", error)
			}
		}

		// Approach 2: Open Cline in a panel view
		if (!serverStarted) {
			try {
				console.log("Trying to open Cline in a panel view (approach 2)...")
				await execa("code", ["--folder-uri", `file://${workspacePath}`, "--command", "cline.openInNewTab"], {
					stdio: "ignore",
				})
				
				// Wait for the panel to open and test server to start
				await new Promise((resolve) => setTimeout(resolve, 5000))
				
				// Check if the server started
				for (let i = 0; i < 15; i++) {
					try {
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
				console.warn("Failed to open Cline panel (approach 2):", error)
			}
		}

		// Approach 3: Try to execute a Cline command directly
		if (!serverStarted) {
			try {
				console.log("Trying to execute Cline command directly (approach 3)...")
				await execa("code", ["--folder-uri", `file://${workspacePath}`, "--command", "cline.plusButtonClicked"], {
					stdio: "ignore",
				})
				
				// Wait for the command to execute and test server to start
				await new Promise((resolve) => setTimeout(resolve, 5000))
				
				// Check if the server started
				for (let i = 0; i < 15; i++) {
					try {
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
				console.warn("Failed to execute Cline command (approach 3):", error)
			}
		}

		if (!serverStarted) {
			console.warn("Test server did not start after multiple attempts")
			console.log("You may need to manually open the Cline extension in VS Code")
		}
	} catch (error: any) {
		throw new Error(`Failed to spawn VSCode: ${error.message}`)
	}
}

// Import os module for user directory paths
import * as os from "os"
