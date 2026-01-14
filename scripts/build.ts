#!/usr/bin/env npx tsx

/**
 * Unified Build Orchestrator for Cline
 *
 * Cross-platform build script that works on Windows, macOS, and Linux.
 *
 * Usage:
 *   npx tsx scripts/build.ts --surface=<vscode|jetbrains|cli|all> [options]
 *
 * Options:
 *   --surface=<surface>    Build target: vscode, jetbrains, cli, or all
 *   --platform=<platform>  CLI platform: unix, windows, or all (default: unix)
 *   --prod                 Production build (minification, strip debug symbols)
 *   --all-stages           Build both dev and prod
 *
 * Examples:
 *   npx tsx scripts/build.ts --surface=vscode
 *   npx tsx scripts/build.ts --surface=cli --platform=windows --prod
 *   npx tsx scripts/build.ts --surface=all --platform=all --all-stages
 */

import { execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, "..")

// Types
type Surface = "vscode" | "jetbrains" | "cli" | "npm" | "all"
type PlatformGroup = "unix" | "windows" | "all"

interface CliTarget {
	GOOS: string
	GOARCH: string
}

interface ParsedArgs {
	surface: Surface
	platform: PlatformGroup
	prod: boolean
	allStages: boolean
}

interface RunOptions {
	cwd?: string
	env?: NodeJS.ProcessEnv
	silent?: boolean
}

interface BuildState {
	protos: boolean
	protosGo: boolean
	webview: boolean
}

// CLI build targets by platform group
const CLI_PLATFORMS: Record<"unix" | "windows", CliTarget[]> = {
	unix: [
		{ GOOS: "darwin", GOARCH: "amd64" },
		{ GOOS: "darwin", GOARCH: "arm64" },
		{ GOOS: "linux", GOARCH: "amd64" },
		{ GOOS: "linux", GOARCH: "arm64" },
	],
	windows: [
		{ GOOS: "windows", GOARCH: "amd64" },
		{ GOOS: "windows", GOARCH: "arm64" },
	],
}

// Colors for terminal output
const colors = {
	reset: "\x1b[0m",
	bright: "\x1b[1m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	cyan: "\x1b[36m",
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
		surface: "all",
		platform: "unix",
		prod: false,
		allStages: false,
	}

	for (const arg of args) {
		if (arg.startsWith("--surface=")) {
			result.surface = arg.split("=")[1] as Surface
		} else if (arg.startsWith("--platform=")) {
			result.platform = arg.split("=")[1] as PlatformGroup
		} else if (arg === "--prod") {
			result.prod = true
		} else if (arg === "--all-stages") {
			result.allStages = true
		} else if (arg === "--help" || arg === "-h") {
			console.log(`
Unified Build Orchestrator for Cline

Usage:
  npx tsx scripts/build.ts --surface=<surface> [options]

Surfaces:
  vscode      Build VS Code extension
  jetbrains   Build JetBrains standalone package
  cli         Build Go CLI binaries
  npm         Build npm package (CLI + standalone for npm distribution)
  all         Build all surfaces (vscode + jetbrains + cli, excludes npm)

Options:
  --platform=<platform>  CLI platform target: unix, windows, or all (default: unix)
  --prod                 Production build (minification, strip debug symbols)
  --all-stages           Build both dev and prod stages

Environment Variables (required for npm --prod):
  TELEMETRY_SERVICE_API_KEY   PostHog telemetry API key
  ERROR_SERVICE_API_KEY       Error tracking API key

Examples:
  npm run build:vscode                    # VS Code dev build
  npm run build:cli:windows:prod          # CLI Windows production build
  npm run build:npm                       # npm package dev build
  npm run build:npm:prod                  # npm package prod build (requires env vars)
  npm run build:all-surfaces:all-platforms:all-stages  # Everything
`)
			process.exit(0)
		}
	}

	// Validate surface
	if (!["vscode", "jetbrains", "cli", "npm", "all"].includes(result.surface)) {
		logError(`Invalid surface: ${result.surface}. Must be one of: vscode, jetbrains, cli, npm, all`)
		process.exit(1)
	}

	// Validate platform
	if (!["unix", "windows", "all"].includes(result.platform)) {
		logError(`Invalid platform: ${result.platform}. Must be one of: unix, windows, all`)
		process.exit(1)
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

/**
 * Get git commit hash
 */
function getGitCommit(): string {
	return runCapture("git rev-parse --short HEAD") || "unknown"
}

/**
 * Read package.json version
 */
function getPackageVersion(packagePath: string): string {
	const fullPath = path.join(ROOT_DIR, packagePath)
	const pkg = JSON.parse(fs.readFileSync(fullPath, "utf8")) as { version: string }
	return pkg.version
}

/**
 * Build Go ldflags string
 */
function buildLdflags(prod: boolean): string {
	const version = getPackageVersion("package.json")
	const cliVersion = getPackageVersion("cli/package.json")
	const commit = getGitCommit()
	const date = new Date().toISOString()
	const builtBy = process.env.USER || process.env.USERNAME || "unknown"

	let ldflags =
		`-X 'github.com/cline/cli/pkg/cli/global.Version=${version}' ` +
		`-X 'github.com/cline/cli/pkg/cli/global.CliVersion=${cliVersion}' ` +
		`-X 'github.com/cline/cli/pkg/cli/global.Commit=${commit}' ` +
		`-X 'github.com/cline/cli/pkg/cli/global.Date=${date}' ` +
		`-X 'github.com/cline/cli/pkg/cli/global.BuiltBy=${builtBy}'`

	if (prod) {
		ldflags += " -s -w" // Strip debug symbols and DWARF
	}

	return ldflags
}

// Track what has been built to avoid duplicate work
const buildState: BuildState = {
	protos: false,
	protosGo: false,
	webview: false,
}

/**
 * Build protobuf definitions
 */
async function buildProtos(): Promise<void> {
	if (buildState.protos) {
		logSuccess("Protos already built, skipping")
		return
	}

	logStep("PROTOS", "Building protobuf definitions")
	run("npm run protos")
	buildState.protos = true
	logSuccess("Protos built")
}

/**
 * Build Go protobuf definitions
 */
async function buildProtosGo(): Promise<void> {
	if (buildState.protosGo) {
		logSuccess("Go protos already built, skipping")
		return
	}

	logStep("PROTOS-GO", "Building Go protobuf definitions")
	run("npm run protos-go")
	buildState.protosGo = true
	logSuccess("Go protos built")
}

/**
 * Build webview UI
 */
async function buildWebview(): Promise<void> {
	if (buildState.webview) {
		logSuccess("Webview already built, skipping")
		return
	}

	logStep("WEBVIEW", "Building webview UI")
	run("npm run build:webview")
	buildState.webview = true
	logSuccess("Webview built")
}

/**
 * Build VS Code extension
 */
async function buildVscode(prod: boolean): Promise<void> {
	const stage = prod ? "prod" : "dev"
	logStep("VSCODE", `Building VS Code extension (${stage})`)

	await buildProtos()
	await buildWebview()

	// Run esbuild
	const productionFlag = prod ? " --production" : ""
	run(`node esbuild.mjs${productionFlag}`)

	logSuccess(`VS Code extension built (${stage})`)
}

/**
 * Build JetBrains standalone package
 */
async function buildJetbrains(prod: boolean): Promise<void> {
	const stage = prod ? "prod" : "dev"
	logStep("JETBRAINS", `Building JetBrains standalone package (${stage})`)

	await buildProtos()
	await buildProtosGo()
	await buildWebview()

	// Prepare dist-standalone directory
	const distDir = path.join(ROOT_DIR, "dist-standalone")
	const extensionDir = path.join(distDir, "extension")

	fs.mkdirSync(extensionDir, { recursive: true })
	fs.copyFileSync(path.join(ROOT_DIR, "package.json"), path.join(extensionDir, "package.json"))

	// Run esbuild with standalone flag
	const productionFlag = prod ? " --production" : ""
	run(`node esbuild.mjs --standalone${productionFlag}`)

	// Run package-standalone.mjs (always builds for all platforms)
	run("node scripts/package-standalone.mjs")

	logSuccess(`JetBrains standalone package built (${stage})`)
}

/**
 * Build CLI binaries for specified platforms
 */
async function buildCli(platformGroups: PlatformGroup[], prod: boolean): Promise<void> {
	const stage = prod ? "prod" : "dev"

	// Expand platform groups to individual targets
	const targets: CliTarget[] = []
	for (const group of platformGroups) {
		if (group === "all") {
			targets.push(...CLI_PLATFORMS.unix, ...CLI_PLATFORMS.windows)
		} else if (CLI_PLATFORMS[group]) {
			targets.push(...CLI_PLATFORMS[group])
		}
	}

	// Deduplicate targets
	const uniqueTargets = [...new Map(targets.map((t) => [`${t.GOOS}-${t.GOARCH}`, t])).values()]

	logStep("CLI", `Building CLI binaries (${stage}) for ${uniqueTargets.length} platform(s)`)

	await buildProtos()
	await buildProtosGo()

	// Prepare directories
	const cliDir = path.join(ROOT_DIR, "cli")
	const cliBinDir = path.join(cliDir, "bin")
	const distBinDir = path.join(ROOT_DIR, "dist-standalone", "bin")

	fs.mkdirSync(cliBinDir, { recursive: true })
	fs.mkdirSync(distBinDir, { recursive: true })

	// Also ensure dist-standalone/extension exists for package.json
	const extensionDir = path.join(ROOT_DIR, "dist-standalone", "extension")
	fs.mkdirSync(extensionDir, { recursive: true })
	fs.copyFileSync(path.join(ROOT_DIR, "package.json"), path.join(extensionDir, "package.json"))

	const ldflags = buildLdflags(prod)

	// Build for each target
	for (const { GOOS, GOARCH } of uniqueTargets) {
		const ext = GOOS === "windows" ? ".exe" : ""
		const platformSuffix = `${GOOS}-${GOARCH === "amd64" ? "x64" : GOARCH}`

		log(`  Building for ${platformSuffix}...`, colors.blue)

		const env: NodeJS.ProcessEnv = {
			...process.env,
			GOOS,
			GOARCH,
			GO111MODULE: "on",
		}

		// Build cline binary
		const clineOutput = path.join(cliBinDir, `cline-${platformSuffix}${ext}`)
		run(`go build -ldflags "${ldflags}" -o "${clineOutput}" ./cmd/cline`, {
			cwd: cliDir,
			env,
			silent: true,
		})
		logSuccess(`cline-${platformSuffix}${ext} built`)

		// Build cline-host binary
		const hostOutput = path.join(cliBinDir, `cline-host-${platformSuffix}${ext}`)
		run(`go build -ldflags "${ldflags}" -o "${hostOutput}" ./cmd/cline-host`, {
			cwd: cliDir,
			env,
			silent: true,
		})
		logSuccess(`cline-host-${platformSuffix}${ext} built`)

		// Copy to dist-standalone/bin
		fs.copyFileSync(clineOutput, path.join(distBinDir, `cline-${platformSuffix}${ext}`))
		fs.copyFileSync(hostOutput, path.join(distBinDir, `cline-host-${platformSuffix}${ext}`))
	}

	// If building for current platform, also create generic binaries
	const currentOS = process.platform === "win32" ? "windows" : process.platform
	const currentTarget = uniqueTargets.find((t) => t.GOOS === currentOS && t.GOARCH === process.arch)

	if (currentTarget) {
		const ext = currentOS === "windows" ? ".exe" : ""
		const platformSuffix = `${currentOS}-${process.arch}`

		// Copy to generic names in cli/bin and dist-standalone/bin
		fs.copyFileSync(path.join(cliBinDir, `cline-${platformSuffix}${ext}`), path.join(cliBinDir, `cline${ext}`))
		fs.copyFileSync(path.join(cliBinDir, `cline-host-${platformSuffix}${ext}`), path.join(cliBinDir, `cline-host${ext}`))
		fs.copyFileSync(path.join(distBinDir, `cline-${platformSuffix}${ext}`), path.join(distBinDir, `cline${ext}`))
		fs.copyFileSync(path.join(distBinDir, `cline-host-${platformSuffix}${ext}`), path.join(distBinDir, `cline-host${ext}`))

		logSuccess(`Generic binaries created for current platform (${platformSuffix})`)
	}

	logSuccess(`CLI binaries built (${stage})`)
}

/**
 * Validate telemetry environment variables are set
 */
function validateTelemetryEnvVars(): void {
	logStep("ENV", "Validating telemetry environment variables")

	const requiredVars = ["TELEMETRY_SERVICE_API_KEY", "ERROR_SERVICE_API_KEY"]
	const optionalVars = ["CLINE_ENVIRONMENT", "POSTHOG_TELEMETRY_ENABLED"]
	const missingVars: string[] = []

	for (const varName of requiredVars) {
		const value = process.env[varName]
		if (!value) {
			missingVars.push(varName)
			logError(`${varName} is not set`)
		} else {
			// Show first 10 chars for verification (don't expose full key)
			logSuccess(`${varName} is set (${value.substring(0, 10)}...)`)
		}
	}

	for (const varName of optionalVars) {
		const value = process.env[varName]
		if (!value) {
			logWarning(`${varName} is not set (optional)`)
		} else {
			logSuccess(`${varName} is set: ${value}`)
		}
	}

	if (missingVars.length > 0) {
		log("\n", colors.reset)
		logError("Missing required environment variables:")
		log("", colors.reset)
		log('  export TELEMETRY_SERVICE_API_KEY="your_posthog_api_key"', colors.yellow)
		log('  export ERROR_SERVICE_API_KEY="your_error_tracking_api_key"', colors.yellow)
		log("", colors.reset)
		throw new Error(`Missing required environment variables: ${missingVars.join(", ")}`)
	}

	logSuccess("Environment variables validated")
}

/**
 * Clean dist-standalone directory
 */
function cleanDistStandalone(): void {
	logStep("CLEAN", "Cleaning dist-standalone directory")

	const distDir = path.join(ROOT_DIR, "dist-standalone")

	if (fs.existsSync(distDir)) {
		fs.rmSync(distDir, { recursive: true, force: true })
		logSuccess("Removed dist-standalone directory")
	} else {
		logSuccess("dist-standalone directory does not exist, nothing to clean")
	}
}

/**
 * Verify telemetry keys were injected into compiled output
 */
function verifyTelemetryInjection(): void {
	logStep("VERIFY", "Verifying telemetry keys were injected")

	const clineCorePath = path.join(ROOT_DIR, "dist-standalone", "cline-core.js")

	if (!fs.existsSync(clineCorePath)) {
		throw new Error(`Compiled file not found: ${clineCorePath}`)
	}

	const content = fs.readFileSync(clineCorePath, "utf8")

	// Check if process.env references still exist (bad - means they weren't replaced)
	if (content.includes("process.env.TELEMETRY_SERVICE_API_KEY")) {
		logError("Keys were NOT injected! Found 'process.env.TELEMETRY_SERVICE_API_KEY' in compiled code")
		logError("This means the environment variables were not replaced during build")
		throw new Error("Telemetry keys were not injected into compiled code")
	}

	// Check if PostHog endpoint is present (good - means config is there)
	if (content.includes("data.cline.bot")) {
		logSuccess("Telemetry keys successfully injected into compiled code")
	} else {
		logWarning("Could not verify PostHog config in compiled code")
	}
}

/**
 * Print npm build summary
 */
function printNpmBuildSummary(): void {
	const distDir = path.join(ROOT_DIR, "dist-standalone")
	let version = "unknown"

	try {
		const pkgPath = path.join(distDir, "package.json")
		if (fs.existsSync(pkgPath)) {
			const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version: string }
			version = pkg.version
		}
	} catch {
		// Ignore errors reading version
	}

	log("\n", colors.reset)
	logSeparator()
	log("NPM Package Build Summary", colors.green)
	logSeparator()
	log("")
	log(`  Package location: ${colors.cyan}dist-standalone/${colors.reset}`, colors.reset)
	log(`  Package version:  ${colors.cyan}${version}${colors.reset}`, colors.reset)
	log("")
	log("  Next steps:", colors.bright)
	log(`    1. Test locally:  ${colors.yellow}cd dist-standalone && npm link${colors.reset}`, colors.reset)
	log(`    2. Verify:        ${colors.yellow}cline version${colors.reset}`, colors.reset)
	log(`    3. Publish:       ${colors.yellow}cd dist-standalone && npm publish${colors.reset}`, colors.reset)
	log("")
	log(
		`  ${colors.yellow}Note: Check PostHog dashboard after running cline commands to verify telemetry${colors.reset}`,
		colors.reset,
	)
	logSeparator()
}

/**
 * Build npm package (CLI + standalone for npm distribution)
 */
async function buildNpm(prod: boolean): Promise<void> {
	const stage = prod ? "prod" : "dev"
	logStep("NPM", `Building npm package (${stage})`)

	// Step 1: Validate telemetry env vars (prod only)
	if (prod) {
		validateTelemetryEnvVars()
	}

	// Step 2: Clean dist-standalone directory
	cleanDistStandalone()

	// Step 3: Build shared dependencies
	await buildProtos()
	await buildProtosGo()
	await buildWebview()

	// Step 4: Build CLI for all platforms
	await buildCli(["all"], prod)

	// Step 5: Build standalone with npm target
	logStep("STANDALONE", "Building standalone package for npm")
	const productionFlag = prod ? " --production" : ""
	run(`node esbuild.mjs --standalone${productionFlag}`)
	run("node scripts/package-standalone.mjs --target=npm")

	// Step 6: Verify telemetry injection (prod only)
	if (prod) {
		verifyTelemetryInjection()
	}

	// Step 7: Print summary
	printNpmBuildSummary()

	logSuccess(`npm package built (${stage})`)
}

/**
 * Build all surfaces with specified options
 */
async function buildAll(surface: Surface, platform: PlatformGroup, prod: boolean): Promise<void> {
	const stage = prod ? "prod" : "dev"

	logSeparator()
	log(`Building: surface=${surface}, platform=${platform}, stage=${stage}`, colors.bright)
	logSeparator()

	if (surface === "all") {
		// Build vscode and jetbrains in parallel, then cli
		// We need to be careful with shared resources (protos, webview)
		// So we build shared dependencies first, then parallelize

		logStep("SHARED", "Building shared dependencies")
		await buildProtos()
		await buildProtosGo()
		await buildWebview()

		// Now we can build vscode and jetbrains in parallel
		logStep("PARALLEL", "Building VS Code and JetBrains in parallel")

		const vscodePromise = (async () => {
			const productionFlag = prod ? " --production" : ""
			run(`node esbuild.mjs${productionFlag}`)
			logSuccess(`VS Code extension built (${stage})`)
		})()

		const jetbrainsPromise = (async () => {
			// Prepare dist-standalone directory
			const distDir = path.join(ROOT_DIR, "dist-standalone")
			const extensionDir = path.join(distDir, "extension")
			fs.mkdirSync(extensionDir, { recursive: true })
			fs.copyFileSync(path.join(ROOT_DIR, "package.json"), path.join(extensionDir, "package.json"))

			const productionFlag = prod ? " --production" : ""
			run(`node esbuild.mjs --standalone${productionFlag}`)
			run("node scripts/package-standalone.mjs")
			logSuccess(`JetBrains standalone package built (${stage})`)
		})()

		await Promise.all([vscodePromise, jetbrainsPromise])

		// Build CLI (includes both unix and windows for "all" surface)
		await buildCli(["unix", "windows"], prod)
	} else if (surface === "vscode") {
		await buildVscode(prod)
	} else if (surface === "jetbrains") {
		await buildJetbrains(prod)
	} else if (surface === "cli") {
		const platforms: PlatformGroup[] = platform === "all" ? ["all"] : [platform]
		await buildCli(platforms, prod)
	} else if (surface === "npm") {
		await buildNpm(prod)
	}
}

/**
 * Reset build state for new stage
 */
function resetBuildState(): void {
	buildState.protos = false
	buildState.protosGo = false
	buildState.webview = false
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
	const args = parseArgs()

	logSeparator()
	log("Cline Build Orchestrator", colors.bright)
	logSeparator()

	const startTime = Date.now()

	try {
		if (args.allStages) {
			// Build both dev and prod
			log("\nBuilding all stages (dev + prod)...", colors.cyan)

			// Dev build
			await buildAll(args.surface, args.platform, false)

			// Reset build state for prod build
			resetBuildState()

			// Prod build
			await buildAll(args.surface, args.platform, true)
		} else {
			await buildAll(args.surface, args.platform, args.prod)
		}

		const duration = ((Date.now() - startTime) / 1000).toFixed(2)
		logSeparator()
		log(`Build completed successfully in ${duration}s`, colors.green)
		logSeparator()
	} catch (error) {
		const duration = ((Date.now() - startTime) / 1000).toFixed(2)
		logSeparator()
		logError(`Build failed after ${duration}s`)
		logError((error as Error).message)
		logSeparator()
		process.exit(1)
	}
}

main()
