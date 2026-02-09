#!/usr/bin/env node

/**
 * DAG Engine Setup Script
 *
 * Sets up the Python DAG analysis engine environment:
 * - Checks Python 3.12+ is available
 * - Creates venv at dag-engine/.venv
 * - Installs Python dependencies
 * - Installs js-parser Node dependencies
 *
 * Exits gracefully if Python is unavailable (doesn't fail the build).
 */

import chalk from "chalk"
import { spawnSync } from "child_process"
import * as fs from "fs/promises"
import * as path from "path"

const DAG_ENGINE_DIR = path.resolve("dag-engine")
const VENV_DIR = path.join(DAG_ENGINE_DIR, ".venv")
const JS_PARSER_DIR = path.join(DAG_ENGINE_DIR, "js-parser")

// Minimum Python version required
const MIN_PYTHON_VERSION = { major: 3, minor: 12 }

/**
 * Parse Python version string like "Python 3.12.1" into { major, minor, patch }
 */
function parsePythonVersion(versionString) {
	const match = versionString.match(/Python\s+(\d+)\.(\d+)(?:\.(\d+))?/)
	if (!match) {
		return null
	}
	return {
		major: parseInt(match[1], 10),
		minor: parseInt(match[2], 10),
		patch: match[3] ? parseInt(match[3], 10) : 0,
	}
}

/**
 * Check if the version meets the minimum requirement
 */
function meetsMinimumVersion(version) {
	if (version.major > MIN_PYTHON_VERSION.major) {
		return true
	}
	if (version.major === MIN_PYTHON_VERSION.major && version.minor >= MIN_PYTHON_VERSION.minor) {
		return true
	}
	return false
}

/**
 * Find a suitable Python executable
 * Returns { pythonPath, version } or null if not found
 */
function findPython() {
	// Try common Python executable names
	const pythonCandidates = process.platform === "win32" ? ["python", "python3", "py -3"] : ["python3", "python"]

	for (const candidate of pythonCandidates) {
		try {
			const result = spawnSync(candidate.split(" ")[0], [...candidate.split(" ").slice(1), "--version"], {
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
				shell: process.platform === "win32",
			})

			if (result.status === 0) {
				const versionOutput = (result.stdout || result.stderr || "").trim()
				const version = parsePythonVersion(versionOutput)

				if (version && meetsMinimumVersion(version)) {
					return {
						pythonPath: candidate,
						version,
						versionString: versionOutput,
					}
				}
			}
		} catch {
			// Continue to next candidate
		}
	}

	return null
}

/**
 * Check if the virtual environment exists and is valid
 */
async function venvExists() {
	try {
		const pythonBin =
			process.platform === "win32" ? path.join(VENV_DIR, "Scripts", "python.exe") : path.join(VENV_DIR, "bin", "python")

		await fs.access(pythonBin)
		return true
	} catch {
		return false
	}
}

/**
 * Create a virtual environment
 */
function createVenv(pythonPath) {
	console.log(chalk.cyan(`Creating virtual environment at ${VENV_DIR}...`))

	const args = pythonPath.split(" ")
	const command = args[0]
	const commandArgs = [...args.slice(1), "-m", "venv", VENV_DIR]

	const result = spawnSync(command, commandArgs, {
		encoding: "utf-8",
		stdio: "inherit",
		shell: process.platform === "win32",
	})

	if (result.status !== 0) {
		throw new Error(`Failed to create virtual environment (exit code: ${result.status})`)
	}

	console.log(chalk.green("✓ Virtual environment created"))
}

/**
 * Get the path to the venv's pip executable
 */
function getVenvPip() {
	return process.platform === "win32" ? path.join(VENV_DIR, "Scripts", "pip.exe") : path.join(VENV_DIR, "bin", "pip")
}

/**
 * Install Python dependencies using pip
 */
function installPythonDeps() {
	console.log(chalk.cyan("Installing Python dependencies..."))

	const pip = getVenvPip()

	// First, upgrade pip using spawnSync for safety
	try {
		const upgradeResult = spawnSync(pip, ["install", "--upgrade", "pip"], {
			encoding: "utf-8",
			stdio: "inherit",
			cwd: DAG_ENGINE_DIR,
		})
		if (upgradeResult.status !== 0) {
			console.log(chalk.yellow("Warning: Could not upgrade pip, continuing with existing version"))
		}
	} catch {
		console.log(chalk.yellow("Warning: Could not upgrade pip, continuing with existing version"))
	}

	// Install the package in editable mode
	const installResult = spawnSync(pip, ["install", "-e", "."], {
		encoding: "utf-8",
		stdio: "inherit",
		cwd: DAG_ENGINE_DIR,
	})

	if (installResult.status !== 0) {
		throw new Error(`Failed to install Python dependencies (exit code: ${installResult.status})`)
	}

	console.log(chalk.green("✓ Python dependencies installed"))
}

/**
 * Install js-parser Node dependencies
 */
async function installJsParserDeps() {
	console.log(chalk.cyan("Installing js-parser Node dependencies..."))

	// Check if js-parser directory exists
	try {
		await fs.access(JS_PARSER_DIR)
	} catch {
		console.log(chalk.yellow("Warning: js-parser directory not found, skipping"))
		return
	}

	// Check if package.json exists
	try {
		await fs.access(path.join(JS_PARSER_DIR, "package.json"))
	} catch {
		console.log(chalk.yellow("Warning: js-parser/package.json not found, skipping"))
		return
	}

	try {
		const result = spawnSync("npm", ["install"], {
			encoding: "utf-8",
			stdio: "inherit",
			cwd: JS_PARSER_DIR,
			shell: true,
		})

		if (result.status !== 0 && result.status !== null) {
			throw new Error(`npm install exited with code ${result.status}`)
		}

		if (result.error) {
			throw result.error
		}

		console.log(chalk.green("✓ js-parser dependencies installed"))
	} catch (error) {
		console.log(chalk.yellow("Warning: Failed to install js-parser dependencies"))
		console.log(chalk.yellow(`  ${error.message}`))
	}
}

/**
 * Main setup function
 */
async function main() {
	console.log(chalk.bold.blue("\n=== DAG Engine Setup ===\n"))

	// Check if dag-engine directory exists
	try {
		await fs.access(DAG_ENGINE_DIR)
	} catch {
		console.log(chalk.yellow("DAG engine directory not found at:"), DAG_ENGINE_DIR)
		console.log(chalk.yellow("Skipping DAG engine setup."))
		return
	}

	// Find Python
	console.log(chalk.cyan("Checking for Python 3.12+..."))
	const pythonInfo = findPython()

	if (!pythonInfo) {
		console.log(chalk.yellow("\n⚠ Python 3.12+ not found on system PATH"))
		console.log(chalk.yellow("DAG analysis features will not be available."))
		console.log(chalk.dim("\nTo enable DAG analysis, install Python 3.12 or later:"))
		console.log(chalk.dim("  - Windows: https://www.python.org/downloads/"))
		console.log(chalk.dim("  - macOS: brew install python@3.12"))
		console.log(chalk.dim("  - Linux: sudo apt install python3.12 (or your distro's package manager)"))
		console.log(chalk.dim("\nThen run: npm run setup:dag\n"))
		return
	}

	console.log(chalk.green(`✓ Found ${pythonInfo.versionString} (${pythonInfo.pythonPath})`))

	// Check if venv already exists
	if (await venvExists()) {
		console.log(chalk.green("✓ Virtual environment already exists"))
	} else {
		createVenv(pythonInfo.pythonPath)
	}

	// Install Python dependencies
	installPythonDeps()

	// Install js-parser dependencies
	await installJsParserDeps()

	console.log(chalk.bold.green("\n✓ DAG engine setup complete!\n"))
	console.log(chalk.dim("DAG analysis features are now available."))
	console.log(chalk.dim("Enable in Settings > Features > DAG Analysis\n"))
}

// Run main
main().catch((error) => {
	console.error(chalk.red("\nDAG engine setup failed:"), error.message)
	console.log(chalk.yellow("DAG analysis features will not be available.\n"))
	// Exit with 0 to not fail the overall build
	process.exit(0)
})
