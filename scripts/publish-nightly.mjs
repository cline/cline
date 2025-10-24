#!/usr/bin/env node

/**
 * Nightly publish script for VS Code extension
 * Converts package.json to testing version, packages, publishes, and restores
 *
 * This script:
 * 1. Backs up the original package.json
 * 2. Updates package.json with:
 *    - New version (major.minor.timestamp format)
 *    - Changes name to "cline-nightly"
 *    - Changes displayName to "Cline (Nightly)"
 * 3. Packages the extension as a .vsix file
 * 4. Publishes to VS Code Marketplace (if VSCE_PAT is set)
 * 5. Publishes to OpenVSX Registry (if OVSX_PAT is set)
 * 6. Restores the original package.json
 *
 * Usage:
 *   npm run publish:marketplace:nightly
 *   npm run publish:marketplace:nightly -- --dry-run
 *
 * Environment variables:
 *   VSCE_PAT  - Personal Access Token for VS Code Marketplace
 *   OVSX_PAT  - Personal Access Token for OpenVSX Registry
 *
 * Dependencies:
 *   - vsce (VS Code Extension Manager)
 *   - ovsx (OpenVSX CLI)
 */

import { execFileSync, execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ANSI color codes for console output
const colors = {
	reset: "\x1b[0m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
}

// Logging utilities
const log = {
	info: (msg) => console.log(`${colors.green}[INFO]${colors.reset} ${msg}`),
	warn: (msg) => console.log(`${colors.yellow}[WARN]${colors.reset} ${msg}`),
	error: (msg) => console.error(`${colors.red}[ERROR]${colors.reset} ${msg}`),
}

// Configuration
const config = {
	// The name and display name for the nightly version
	nightlyName: "cline-nightly",
	nightlyDisplayName: "Cline (Nightly)",
	projectRoot: path.join(__dirname, ".."),
	get packageJsonPath() {
		return path.join(this.projectRoot, "package.json")
	},
	get packageBackupPath() {
		return path.join(this.projectRoot, "package.json.backup")
	},
	get distDir() {
		return path.join(this.projectRoot, "dist")
	},
	get vsixPath() {
		return path.join(this.distDir, "cline-nightly.vsix")
	},
}

// Utility class for managing the publish process
class NightlyPublisher {
	constructor() {
		this.originalPackageJson = null
		this.hasBackup = false
	}

	/**
	 * Check if required dependencies are installed
	 */
	checkDependencies() {
		const dependencies = [
			{ name: "vsce", check: "vsce --version" },
			{ name: "npx", check: "npx --version" },
		]

		const missing = []

		for (const dep of dependencies) {
			try {
				execSync(dep.check, { stdio: "ignore" })
			} catch {
				missing.push(dep.name)
			}
		}

		if (missing.length > 0) {
			throw new Error(
				`Missing required dependencies: ${missing.join(", ")}. Please install them before running this script.`,
			)
		}

		log.info("All dependencies are installed")
	}

	/**
	 * Check if a command exists
	 */
	commandExists(command) {
		try {
			execSync(`which ${command}`, { stdio: "ignore" })
			return true
		} catch {
			return false
		}
	}

	/**
	 * Create backup of package.json
	 */
	backupPackageJson() {
		if (!fs.existsSync(config.packageJsonPath)) {
			throw new Error(`package.json not found at ${config.packageJsonPath}`)
		}

		log.info("Backing up original package.json")
		this.originalPackageJson = fs.readFileSync(config.packageJsonPath, "utf-8")
		fs.writeFileSync(config.packageBackupPath, this.originalPackageJson)
		this.hasBackup = true
	}

	/**
	 * Restore original package.json
	 */
	restorePackageJson() {
		if (this.hasBackup && fs.existsSync(config.packageBackupPath)) {
			log.info("Restoring original package.json")
			fs.writeFileSync(config.packageJsonPath, this.originalPackageJson)
			fs.unlinkSync(config.packageBackupPath)
			this.hasBackup = false
		}
	}

	/**
	 * Generate new version with timestamp
	 * Format: major.minor.timestamp
	 */
	generateVersion(currentVersion) {
		// Extract major.minor from current version (e.g., "3.27.1" -> "3.27")
		const versionParts = currentVersion.split(".")
		if (versionParts.length < 2) {
			throw new Error(`Invalid version format: ${currentVersion}`)
		}

		const major = versionParts[0]
		const minor = versionParts[1]
		const timestamp = Math.floor(Date.now() / 1000)

		return `${major}.${minor}.${timestamp}`
	}

	/**
	 * Update package.json with nightly configuration
	 */
	updatePackageJson() {
		// Replace any occurrences cline. or claude-dev with nightly name
		const rawContent = fs.readFileSync(config.packageJsonPath, "utf-8")
		const content = rawContent.replaceAll("claude-dev", config.nightlyName).replaceAll('"cline.', `"${config.nightlyName}.`)

		const pkg = JSON.parse(content)
		const currentVersion = pkg.version

		if (!currentVersion) {
			throw new Error("Could not read version from package.json")
		}

		log.info(`Current version: ${currentVersion}`)

		const newVersion = this.generateVersion(currentVersion)
		log.info(`New version: ${newVersion}`)

		// Update package.json fields
		pkg.version = newVersion
		pkg.name = config.nightlyName
		pkg.displayName = config.nightlyDisplayName
		pkg.contributes.viewsContainers.activitybar.title = config.nightlyDisplayName

		// Save updated package.json
		log.info("Updating package.json for nightly build")
		fs.writeFileSync(config.packageJsonPath, JSON.stringify(pkg, null, "\t"))

		return newVersion
	}

	/**
	 * Package the extension
	 */
	packageExtension() {
		// Ensure dist directory exists
		if (!fs.existsSync(config.distDir)) {
			fs.mkdirSync(config.distDir, { recursive: true })
		}

		log.info("Packaging extension")

		const args = [
			"package",
			"--pre-release",
			"--no-update-package-json",
			"--no-git-tag-version",
			"--allow-package-secrets",
			"sendgrid",
			"--out",
			config.vsixPath,
		]

		try {
			execFileSync("vsce", args, {
				stdio: "inherit",
				cwd: config.projectRoot,
			})
			log.info(`Package created: ${config.vsixPath}`)
		} catch (error) {
			throw new Error(`Failed to package extension: ${error.message}`)
		}
	}

	/**
	 * Publish to VS Code Marketplace
	 */
	publishToVSCodeMarketplace() {
		const token = process.env.VSCE_PAT

		if (!token) {
			log.warn("VSCE_PAT not set, skipping VS Code Marketplace publish")
			return false
		}

		log.info("Publishing to VS Code Marketplace")

		const args = ["publish", "--pre-release", "--no-git-tag-version", "--packagePath", config.vsixPath]

		try {
			execFileSync("vsce", args, {
				env: { ...process.env, VSCE_PAT: token },
				stdio: "inherit",
				cwd: config.projectRoot,
			})
			log.info("Successfully published to VS Code Marketplace")
			return true
		} catch (error) {
			throw new Error(`Failed to publish to VS Code Marketplace: ${error.message}`)
		}
	}

	/**
	 * Publish to OpenVSX Registry
	 */
	publishToOpenVSX() {
		const token = process.env.OVSX_PAT

		if (!token) {
			log.warn("OVSX_PAT not set, skipping OpenVSX Registry publish")
			return false
		}

		log.info("Publishing to OpenVSX Registry")

		const args = ["ovsx", "publish", "--pre-release", "--packagePath", config.vsixPath, "--pat", token]

		try {
			execFileSync("npx", args, {
				stdio: "inherit",
				cwd: config.projectRoot,
			})
			log.info("Successfully published to OpenVSX Registry")
			return true
		} catch (error) {
			throw new Error(`Failed to publish to OpenVSX Registry: ${error.message}`)
		}
	}

	/**
	 * Main execution flow
	 */
	async run(isDryRun = false) {
		try {
			log.info(`Starting nightly publish process${isDryRun ? " (dry run)" : ""}`)

			// Step 1: Check dependencies
			this.checkDependencies()

			// Step 2: Backup package.json
			this.backupPackageJson()

			// Step 3: Update package.json
			const newVersion = this.updatePackageJson()

			// Step 4: Package extension
			this.packageExtension()

			// Step 5: Publish to marketplaces (skip if dry run)
			let vsCodePublished = false
			let openVSXPublished = false

			if (isDryRun) {
				log.info("Dry run mode: Skipping marketplace publishing")
			} else {
				vsCodePublished = this.publishToVSCodeMarketplace()
				openVSXPublished = this.publishToOpenVSX()
			}

			// Summary
			log.info(`Nightly publish process completed successfully${isDryRun ? " (dry run)" : ""}`)
			log.info(`Package created for v${newVersion}: ${config.vsixPath}`)

			if (!isDryRun && !vsCodePublished && !openVSXPublished) {
				log.warn("Extension was packaged but not published to any marketplace")
				log.warn("Set VSCE_PAT and/or OVSX_PAT environment variables to enable publishing")
			}
		} catch (error) {
			log.error(`Publish failed: ${error.message}`)
			process.exit(1)
		} finally {
			// Always restore package.json
			this.restorePackageJson()
		}
	}
}

// Handle cleanup on process exit
const publisher = new NightlyPublisher()

process.on("exit", () => {
	publisher.restorePackageJson()
})

process.on("SIGINT", () => {
	log.info("\nInterrupted, cleaning up...")
	publisher.restorePackageJson()
	process.exit(130)
})

process.on("SIGTERM", () => {
	log.info("\nTerminated, cleaning up...")
	publisher.restorePackageJson()
	process.exit(143)
})

// Parse command line arguments
const args = process.argv.slice(2)
const isDryRun = args.includes("--dry-run") || args.includes("-n")
const showHelp = args.includes("--help") || args.includes("-h")

if (showHelp) {
	console.log(`
Nightly publish script for VS Code extension

Usage:
  npm run publish:marketplace:nightly [options]

Options:
  --dry-run, -n    Run without actually publishing (package only)
  --help, -h       Show this help message

Environment variables:
  VSCE_PAT         Personal Access Token for VS Code Marketplace
  OVSX_PAT         Personal Access Token for OpenVSX Registry

Examples:
  npm run publish:marketplace:nightly                    # Full publish
  npm run publish:marketplace:nightly  -- --dry-run      # Package only
  VSCE_PAT="token" npm run publish:marketplace:nightly   # Publish to VS Code only
`)
	process.exit(0)
}

// Run the publisher
publisher.run(isDryRun).catch((error) => {
	log.error(error.message)
	process.exit(1)
})
