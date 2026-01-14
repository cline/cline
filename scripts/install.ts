#!/usr/bin/env npx tsx

/**
 * Unified installer for Cline
 *
 * Supports local (development) installation, and standard (production) installation
 *
 * Usage:
 *   npx tsx scripts/install.ts [--local] [options]
 *
 * Examples:
 *   npx tsx scripts/install.ts
 *   npx tsx scripts/install.ts --local
 *   npx tsx scripts/install.ts 3.42.1
 */

import { execSync } from "node:child_process"
import fs from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, "..")

interface ParsedArgs {
	local: boolean
	version: string
}

interface RunOptions {
	cwd?: string
	env?: NodeJS.ProcessEnv
	silent?: boolean
}

interface Platform {
	name: "aix" | "darwin" | "freebsd" | "linux" | "openbsd" | "sunos" | "win" | "android" | "haiku" | "cygwin" | "netbsd"
	arch: "arm" | "arm64" | "ia32" | "loong64" | "mips" | "mipsel" | "ppc" | "ppc64" | "riscv64" | "s390" | "s390x" | "x64"
}

const SupportedPlatforms: Platform[] = [
	{ name: "darwin", arch: "arm64" },
	{ name: "darwin", arch: "x64" },
	{ name: "linux", arch: "arm64" },
	{ name: "linux", arch: "x64" },
	{ name: "win", arch: "x64" },
]

// Colors for terminal output
const colors = {
	reset: "\x1b[0m",
	bright: "\x1b[1m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	cyan: "\x1b[36m",
	magenta: "\x1b[35m",
} as const

function log(message: string, color: string = colors.reset): void {
	console.log(`${color}${message}${colors.reset}`)
}

function logStep(step: string, message: string): void {
	log(`\n${colors.bright}[${step}]${colors.reset} ${message}`, colors.cyan)
}

function logSuccess(message: string): void {
	log(`  ✓ ${message}`, colors.green)
}

function logError(message: string): void {
	log(`  ✗ ${message}`, colors.red)
}

function logWarning(message: string): void {
	log(`  ! ${message}`, colors.yellow)
}

function logSeparator(): void {
	log("=".repeat(60), colors.bright)
}

/**
 * Parse command line arguments
 */
function parseArgs(): ParsedArgs {
	const args = process.argv.slice(2)
	const result: ParsedArgs = {
		local: false,
		version: "latest",
	}

	for (const arg of args) {
		if (arg === "--local") {
			result.local = true
		} else if (arg === "--help" || arg === "-h") {
			console.log(`
Unified Installer for Cline

Usage:
  npx tsx scripts/install.ts [--local]

Options:
  --local                Install using local build instead of production build
`)
			process.exit(0)
		} else {
			// Assume arg is version and attempt to set it. Create validator later
			result.version = arg
		}
	}

	return result
}

/**
 * Run a command synchronously with cross-platform support
 */
function run(cmd: string, opts: RunOptions = {}): void {
	const { cwd = ROOT_DIR, env = process.env, silent = false } = opts

	if (!silent) {
		log(`  $ ${cmd}`, colors.yellow)
	}

	try {
		execSync(cmd, {
			cwd,
			env,
			stdio: silent ? "pipe" : "inherit",
		})
	} catch {
		throw new Error(`Command failed: ${cmd}`)
	}
}

/**
 * Run a command and return the output
 */
function runCapture(cmd: string, opts: { cwd?: string } = {}): string | null {
	const { cwd = ROOT_DIR } = opts

	try {
		return execSync(cmd, {
			cwd,
			encoding: "utf8",
		}).trim()
	} catch {
		return null
	}
}

async function detectOS(): Promise<Platform> {
	const sanitizedPlatform = (() => {
		switch (process.platform) {
			case "win32":
				return "win"
			default:
				return process.platform
		}
	})()
	return { name: sanitizedPlatform, arch: process.arch }
}

function ValidateOS({ name, arch }: Platform) {
	return new Promise((resolve) => {
		const isSupported = !!SupportedPlatforms.find((platform) => {
			if (platform.arch === arch) {
				if (platform.name === name) {
					return true
				}
			}
		})
		if (isSupported) {
			resolve(true)
		} else {
			throw new Error(`Unsupported Operating System: ${name}-${arch}`)
		}
	})
}

async function getInstallDirectory({ name }: Platform) {
	switch (name) {
		case "win":
			return (
				(process.env.APPDATA && path.join(process.env.APPDATA, ".cline", "cli")) ||
				path.join(homedir(), "AppData", "Roaming", ".cline", ".cli")
			)
		case "darwin":
		case "linux":
			return process.env.XDG_CONFIG_HOME || path.join(homedir(), ".cline", ".cli")
		default:
			throw new Error(`Unhandled operating system: ${name}\n\nPlease report this error to support@cline.bot or on github!`)
	}
}

async function rebuildCLI({ name }: Platform) {
	try {
		// Build for current platform
		const buildFor = name === "win" ? "windows" : "unix"
		log(`Building explicitly for ${buildFor}`)
		execSync(`npm run build:cli:${buildFor}`, { stdio: "inherit" })
	} catch (error) {
		throw new Error(`Error building CLI binaries: ${error}`)
	}
}

async function rebuildClineCore() {
	try {
		// Build standalone package
		execSync(`npm run compile-standalone`, { stdio: "inherit" })
	} catch (error) {
		throw new Error(`Error building Cline Core: ${error}`)
	}
}

async function removePreviousCLI({ name }: Platform, installDirectory: string) {
	switch (name) {
		// biome-ignore lint/suspicious/noFallthroughSwitchClause: Only windows install is deprecated. This shouldn't be a factor, as we're adding support, but it's future-proofing.
		case "win":
			// Check if a previous installation exists at old install location
			const oldInstallDir = path.join(homedir(), ".cline")
			const deprecatedInstallDir = await (async () => {
				try {
					await fs.access(oldInstallDir)
					return true
				} catch (_error) {
					return false
				}
			})()
			if (deprecatedInstallDir) {
				logWarning(
					"Deprecated installation of Cline CLI detected. Migration will be attempted, however data loss may occur.",
				)
				log("Copying old files...", colors.yellow)
				try {
					await fs.cp(oldInstallDir, path.resolve(installDirectory, "../"), { recursive: true })
				} catch (error) {
					throw new Error(`Failed to copy old files: ${error}`)
				}
				try {
					log("Removing old directory...", colors.yellow)
					await fs.rm(oldInstallDir, { recursive: true, force: true })
				} catch (error) {
					throw new Error(
						`Unable to perform migration. The following error was returned: \n\n${error}\n\nPlease manually move the .cline folder located at ${oldInstallDir} to ${path.resolve(installDirectory, "..")}`,
					)
				}
			}
		case "darwin":
		case "linux":
			log("Removing existing installation for clean install, if necessary", colors.yellow)
			const previousInstall = await (async () => {
				try {
					await fs.access(installDirectory)
					return true
				} catch (_error) {
					return false
				}
			})()
			if (previousInstall) {
				try {
					await fs.rm(installDirectory, { recursive: true, force: true })
				} catch (error) {
					throw new Error(`Unable to remove previous installation: ${error}`)
				}
			} else {
				log("No previous cline installation detected.", colors.green)
			}
	}
}

async function ensureDirectory(directory: string) {
	const dirExists = await (async () => {
		try {
			await fs.access(directory)
			return true
		} catch (_error) {
			return false
		}
	})()
	if (dirExists) {
		return
	} else {
		try {
			await fs.mkdir(directory, { recursive: true })
		} catch (error) {
			throw new Error(`Unable to create installation directory: ${error}`)
		}
	}
}

async function copyStandalone(installDirectory: string) {
	const standaloneDir: string = path.resolve(ROOT_DIR, "dist-standalone")
	try {
		await fs.cp(standaloneDir, installDirectory, { recursive: true })
	} catch (error) {
		throw new Error(`Failed to copy standalone package files: ${error}`)
	}
}

async function copyPlatformModules({ name, arch }: Platform, installDirectory: string) {
	const moduleDir: string = path.resolve(ROOT_DIR, "dist-standalone", "binaries", `${name}-${arch}`, "node_modules")
	try {
		await fs.cp(moduleDir, installDirectory, { recursive: true })
	} catch (error) {
		throw new Error(`Failed to copy platform module files for ${name}-${arch}: ${error}`)
	}
}

async function copyBinaries({ name, arch }: Platform, installDirectory: string) {
	try {
		switch (name) {
			case "win":
				await fs.cp(
					path.resolve(ROOT_DIR, "cli", "bin", `cline-windows-${arch}.exe`),
					path.resolve(installDirectory, "bin", "cline.exe"),
				)
				await fs.cp(
					path.resolve(ROOT_DIR, "cli", "bin", `cline-host-windows-${arch}.exe`),
					path.resolve(installDirectory, "bin", "cline-host.exe"),
				)
				break
			case "darwin":
			case "linux":
				await fs.cp(path.resolve(ROOT_DIR, "cli", "bin", `cline`), path.resolve(installDirectory, "bin", "cline"))
				await fs.cp(
					path.resolve(ROOT_DIR, "cli", "bin", `cline-host`),
					path.resolve(installDirectory, "bin", "cline-host"),
				)
				break
		}
	} catch (error) {
		throw new Error(`Failed to copy platform module files for ${name}-${arch}: ${error}`)
	}
}

function linkSystemNode(installDirectory: string): Promise<string> {
	return new Promise(async (resolve) => {
		try {
			await fs.symlink(path.resolve(process.argv[0]), path.resolve(installDirectory, "bin", "node"))
			const nodev = execSync("node -v", { cwd: path.resolve(installDirectory, "bin") }).toString()
			resolve(nodev)
		} catch (error: any) {
			if (error.code === "EEXIST") {
				const nodev = execSync("node -v", { cwd: path.resolve(installDirectory, "bin") }).toString()
				resolve(nodev)
				return
			}
			throw new Error(`Unable to link node: ${error}`)
		}
	})
}

async function makeExecutable({ name }: Platform, installDirectory: string) {
	try {
		switch (name) {
			case "win":
				await fs.chmod(path.resolve(installDirectory, "bin", "cline.exe"), 0x755)
				await fs.chmod(path.resolve(installDirectory, "bin", "cline-host.exe"), 0x755)
				break
			case "darwin":
			case "linux":
				await fs.chmod(path.resolve(installDirectory, "bin", "cline"), 0x755)
				await fs.chmod(path.resolve(installDirectory, "bin", "cline-host"), 0x755)
				break
		}
	} catch (error) {
		throw new Error(`Failed to set permissions for files: ${error}`)
	}
}

async function rebuildNativeModules(installDirectory: string) {
	try {
		execSync("npm rebuild better-sqlite3", { cwd: installDirectory })
	} catch (error) {
		throw new Error(`Failed to rebuild modules: ${error}`)
	}
}

async function configurePATH({ name }: Platform, installDirectory: string) {
	try {
		const absolutePath = path.resolve(installDirectory, "bin")

		if (name === "win") {
			try {
				// Get current user PATH
				const stdout = execSync(`powershell -Command "[Environment]::GetEnvironmentVariable('Path', 'User')"`, {
					encoding: "utf-8",
				})

				const currentPath = stdout.trim()

				// Check if already in PATH
				if (currentPath.split(";").some((p) => p.toLowerCase() === absolutePath.toLowerCase())) {
					log("Directory already in PATH", colors.green)
					return
				}

				// Add to PATH
				const newPath = currentPath ? `${currentPath};${absolutePath}` : absolutePath

				execSync(`powershell -Command "[Environment]::SetEnvironmentVariable('Path', '${newPath}', 'User')"`)

				log("Added to PATH. Restart your terminal for changes to take effect.", colors.green)
			} catch (error) {
				throw new Error(`Failed to add to Windows PATH: ${error}`)
			}
		} else {
			// Unix-like (Linux, macOS, etc.)

			const shellConfigFiles = [
				path.join(homedir(), ".bashrc"),
				path.join(homedir(), ".bash_profile"),
				path.join(homedir(), ".zshrc"),
				path.join(homedir(), ".profile"),
			]

			const exportLine = `\nexport PATH="$PATH:${absolutePath}"\n`

			try {
				// Determine which shell config file to use
				let targetFile: string | null = null

				for (const file of shellConfigFiles) {
					try {
						await fs.access(file)
						targetFile = file
						break
					} catch (_error) {}
				}

				// Default to .bashrc if none exist
				if (!targetFile) {
					targetFile = path.join(homedir(), ".bashrc")
				}

				// Check if already present
				const content = await fs.readFile(targetFile, "utf-8")

				if (content.includes(`PATH="$PATH:${absolutePath}"`)) {
					log("Directory already in PATH", colors.green)
					return
				}

				// Append to file
				fs.appendFile(targetFile, exportLine)

				log(`Added to PATH in ${targetFile}. Run 'source ${targetFile}' or restart your terminal.`, colors.green)
			} catch (error) {
				throw new Error(`Failed to configure PATH: ${error}`)
			}
		}
	} catch (error) {
		throw new Error(`Failed to configure PATH: ${error}`)
	}
}

async function isElevated({ name }: Platform): Promise<boolean> {
	try {
		switch (name) {
			case "win":
				await execSync("fltmc")
				return true
			case "darwin":
			case "linux":
				return (process.getuid && process.getuid() === 0) || false
		}
	} catch (_error) {
		throw new Error("This script requires an elevated terminal to run. Please run this using elevated permissions!")
	}
	return false
}

async function installLocal() {
	logStep("1", "Checking operating system...")
	// Detect OS
	const platform: Platform = await detectOS()
	logStep("2", "Validating compatibility...")
	// Validate support
	await ValidateOS(platform)
	logSuccess(`Operating System: ${platform.name}-${platform.arch} is supported.`)
	const elevated = await isElevated(platform)
	if (!elevated) {
		throw new Error("This script requires an elevated terminal to run. Please run this using elevated permissions!")
	}
	// Get install directory
	logStep("3", "Getting install directory...")
	const installDirectory = await getInstallDirectory(platform)
	logSuccess(`Set install directory to: ${installDirectory}`)
	// Rebuild the binaries
	logStep("4", "Rebuilding binaries...")
	await rebuildCLI(platform)
	logSuccess("Binaries built.")
	// Rebuild standalone package
	logStep("5", "Rebuilding standalone package...")
	await rebuildClineCore()
	logSuccess("Standalone Package rebuilt.")
	// Remove existing Cline installation
	logStep("6", "Remove previous Cline CLI Installation")
	await removePreviousCLI(platform, installDirectory)
	// Create install directory
	logStep("7", "Ensuring install directory exists")
	await ensureDirectory(path.resolve(installDirectory, "bin"))
	logSuccess(`Validated install directory: ${installDirectory}`)
	// Copy standalone package first
	logStep("8", "Copying standalone package")
	await copyStandalone(installDirectory)
	logSuccess("Standalone package copied.")
	// Copy platform-specific modules
	logStep("9", `Installing platform-specific modules for ${platform.name}-${platform.arch}`)
	await copyPlatformModules(platform, installDirectory)
	logSuccess("Modules copied.")
	// Copy binaries
	logStep("10", "Copying platform binaries")
	await copyBinaries(platform, installDirectory)
	logSuccess("Binaries copied successfully.")
	// Use system node (via symlink)
	logStep("11", "Linking system node to Cline")
	const systemNodeVersion = await linkSystemNode(installDirectory)
	logSuccess("Link successful.")
	// Make binaries executable
	logStep("12", "Ensuring binaries are executable")
	await makeExecutable(platform, installDirectory)
	logSuccess("Files are executable.")
	// Rebuild better-sqlite3 for system node.js
	logStep("13", `Rebuilding native modules for Node.js version ${systemNodeVersion}`)
	await rebuildNativeModules(installDirectory)
	logSuccess("Native modules rebuilt.")
	// Configure system PATH
	logStep("14", "Configuring system PATH")
	await configurePATH(platform, installDirectory)
	logSuccess("Linked Cline CLI to PATH.")
	// Installation Complete
	logSeparator()
	log("Cline CLI has been installed!", colors.green)
	log("Now you're Cooking with Cline CLI!", colors.magenta)
	logSeparator()
}

async function installProd() {
	// Get install directory
	// Set github Repo
	// Get requested version, default to latest
	// Check prerequisites
	// Check rate limit
	// Get requested release
	// Show info
	// Remove existing Cline installation
	// Download package
	// Inflate package to install directory
	// Validate
	// Configure system PATH
	// Installation Complete
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
	const args = parseArgs()

	logSeparator()
	log("Cline Installer", colors.bright)
	logSeparator()

	const startTime = Date.now()

	try {
		if (args.local) {
			// Build both dev and prod
			log("\nInstalling for Local Development...", colors.cyan)

			// Dev Install
			await installLocal()
		} else {
			await installProd()
		}

		const duration = ((Date.now() - startTime) / 1000).toFixed(2)
		logSeparator()
		log(`Installed successfully in ${duration}s`, colors.green)
		logSeparator()
	} catch (error) {
		const duration = ((Date.now() - startTime) / 1000).toFixed(2)
		logSeparator()
		logError(`Install failed after ${duration}s`)
		logError((error as Error).message)
		logSeparator()
		process.exit(1)
	}
}

main()
