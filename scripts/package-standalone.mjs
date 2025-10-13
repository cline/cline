#!/usr/bin/env node

import archiver from "archiver"
import { execSync } from "child_process"
import fs from "fs"
import { cp } from "fs/promises"
import { glob } from "glob"
import minimatch from "minimatch"
import os from "os"
import path from "path"
import { rmrf } from "./file-utils.mjs"

const BUILD_DIR = "dist-standalone"
const BINARIES_DIR = `${BUILD_DIR}/binaries`
const RUNTIME_DEPS_DIR = "standalone/runtime-files"
const NODE_BINARIES_DIR = `${BUILD_DIR}/node-binaries`
const RIPGREP_BINARIES_DIR = `${BUILD_DIR}/ripgrep-binaries`
const CLI_BINARIES_DIR = "cli/bin"
const IS_DEBUG_BUILD = process.env.IS_DEBUG_BUILD === "true"

// This should match the node version packaged with the JetBrains plugin.
const TARGET_NODE_VERSION = "22.15.0"
const TARGET_PLATFORMS = [
	{ platform: "win32", arch: "x64", targetDir: "win-x64" },
	{ platform: "darwin", arch: "x64", targetDir: "darwin-x64" },
	{ platform: "darwin", arch: "arm64", targetDir: "darwin-arm64" },
	{ platform: "linux", arch: "x64", targetDir: "linux-x64" },
]
const SUPPORTED_BINARY_MODULES = ["better-sqlite3"]

const UNIVERSAL_BUILD = !process.argv.includes("-s")
const IS_VERBOSE = process.argv.includes("-v") || process.argv.includes("--verbose")

// Parse --target flag (e.g., --target=cli)
// Default behavior is JetBrains build (no binaries)
// Use --target=cli for standalone CLI build (with binaries)
const targetArg = process.argv.find((arg) => arg.startsWith("--target="))
const BUILD_TARGET = targetArg ? targetArg.split("=")[1] : "jetbrains"
const IS_CLI_BUILD = BUILD_TARGET === "cli"

// Detect current platform
function getCurrentPlatform() {
	const platform = os.platform()
	const arch = os.arch()

	if (platform === "darwin") {
		return arch === "arm64" ? "darwin-arm64" : "darwin-x64"
	} else if (platform === "linux") {
		return "linux-x64"
	} else if (platform === "win32") {
		return "win-x64"
	}
	throw new Error(`Unsupported platform: ${platform}-${arch}`)
}

async function main() {
	console.log(`🚀 Building Cline ${IS_CLI_BUILD ? "Standalone CLI" : "JetBrains"} Package\n`)

	// Step 1: Install Node.js dependencies
	await installNodeDependencies()

	// Step 2: Copy Node.js binary (only for CLI builds)
	// Step 3: Copy CLI binaries (only for CLI builds)
	// Step 4: Copy ripgrep binary (only for CLI builds)
	// Step 5: Create VERSION file (only for CLI builds)
	if (IS_CLI_BUILD) {
		await copyNodeBinary()
		await copyCliBinaries()
		await copyRipgrepBinary()
		await createVersionFile()
	}

	// Step 6: Package platform-specific binary modules
	if (UNIVERSAL_BUILD) {
		console.log("\nBuilding universal package for all platforms...")
		await packageAllBinaryDeps()
	} else {
		console.log(`\nBuilding package for ${os.platform()}-${os.arch()}...`)
	}

	// Step 7: Create final package
	console.log("\n📦 Creating final package...")
	await zipDistribution()

	console.log("\n✅ Build complete!")
}

async function installNodeDependencies() {
	// Clean modules from any previous builds
	await rmrf(path.join(BUILD_DIR, "node_modules"))
	await rmrf(path.join(BINARIES_DIR))

	await cpr(RUNTIME_DEPS_DIR, BUILD_DIR)

	console.log("Running npm install in distribution directory...")
	execSync("npm install", { stdio: "inherit", cwd: BUILD_DIR })

	// Move the vscode directory into node_modules.
	// It can't be installed using npm because it will create a symlink which cannot be unzipped correctly on windows.
	fs.renameSync(`${BUILD_DIR}/vscode`, `${BUILD_DIR}/node_modules/vscode`)
}

/**
 * Copy Node.js binary for the current platform
 */
async function copyNodeBinary() {
	const currentPlatform = getCurrentPlatform()
	const nodeBinarySource = path.join(NODE_BINARIES_DIR, currentPlatform, "bin", "node")
	const nodeBinaryDest = path.join(BUILD_DIR, "bin", "node")

	console.log(`Copying Node.js binary for ${currentPlatform}...`)

	// Check if Node.js binaries exist
	if (!fs.existsSync(nodeBinarySource)) {
		console.error(`Error: Node.js binary not found at ${nodeBinarySource}`)
		console.error(`Please run: npm run download-node`)
		process.exit(1)
	}

	// Create bin directory
	fs.mkdirSync(path.join(BUILD_DIR, "bin"), { recursive: true })

	// Copy Node.js binary
	await cpr(nodeBinarySource, nodeBinaryDest)

	// Make it executable
	fs.chmodSync(nodeBinaryDest, 0o755)

	console.log(`✓ Node.js binary copied to ${nodeBinaryDest}`)
}

/**
 * Copy CLI binaries (cline and cline-host)
 * The Go binary is named 'cline' and includes service management
 */
async function copyCliBinaries() {
	console.log("Copying CLI binaries...")

	const binaries = [
		{ source: "cline", dest: "cline" },
		{ source: "cline-host", dest: "cline-host" },
	]
	const binDir = path.join(BUILD_DIR, "bin")

	// Create bin directory
	fs.mkdirSync(binDir, { recursive: true })

	for (const { source, dest } of binaries) {
		const sourcePath = path.join(CLI_BINARIES_DIR, source)
		const destPath = path.join(binDir, dest)

		// Check if binary exists
		if (!fs.existsSync(sourcePath)) {
			console.error(`Error: CLI binary not found at ${sourcePath}`)
			console.error(`Please run: npm run compile-cli`)
			process.exit(1)
		}

		// Copy binary
		await cpr(sourcePath, destPath)

		// Make it executable
		fs.chmodSync(destPath, 0o755)

		console.log(`✓ ${source} copied to ${destPath}`)
	}
}

/**
 * Copy ripgrep binary for the current platform
 * Ripgrep is needed by cline-core for file searching
 */
async function copyRipgrepBinary() {
	const currentPlatform = getCurrentPlatform()
	const binaryName = currentPlatform.startsWith("win") ? "rg.exe" : "rg"
	const ripgrepBinarySource = path.join(RIPGREP_BINARIES_DIR, currentPlatform, binaryName)
	const ripgrepBinaryDest = path.join(BUILD_DIR, binaryName)

	console.log(`Copying ripgrep binary for ${currentPlatform}...`)

	// Check if ripgrep binaries exist
	if (!fs.existsSync(ripgrepBinarySource)) {
		console.error(`Error: Ripgrep binary not found at ${ripgrepBinarySource}`)
		console.error(`Please run: npm run download-ripgrep`)
		process.exit(1)
	}

	// Copy ripgrep binary to the root of dist-standalone (where cline-core.js is)
	await cpr(ripgrepBinarySource, ripgrepBinaryDest)

	// Make it executable (Unix only)
	if (!currentPlatform.startsWith("win")) {
		fs.chmodSync(ripgrepBinaryDest, 0o755)
	}

	console.log(`✓ Ripgrep binary copied to ${ripgrepBinaryDest}`)
}

/**
 * Create a VERSION file with build metadata
 */
async function createVersionFile() {
	const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"))
	const version = packageJson.version
	const platform = getCurrentPlatform()
	const buildDate = new Date().toISOString()

	const versionInfo = {
		version,
		platform,
		buildDate,
		nodeVersion: TARGET_NODE_VERSION,
	}

	const versionPath = path.join(BUILD_DIR, "VERSION.txt")
	fs.writeFileSync(versionPath, JSON.stringify(versionInfo, null, 2))

	console.log(`✓ VERSION file created: ${version} (${platform})`)
}

/**
 * Downloads prebuilt binaries for each platform for the modules that include binaries. It uses `npx prebuild-install`
 * to download the binary.
 *
 * The modules are downloaded to dist-standalone/binaries/{os}-{platform}/.
 * When cline-core is installed, the installer should use the correct module for the current platform.
 */
async function packageAllBinaryDeps() {
	// Check for native .node modules.
	const allNativeModules = await glob("**/*.node", { cwd: path.join(BUILD_DIR, "node_modules"), nodir: true })
	const isAllowed = (path) => SUPPORTED_BINARY_MODULES.some((allowed) => path.includes(allowed))
	const blocked = allNativeModules.filter((x) => !isAllowed(x))

	if (blocked.length > 0) {
		console.error(`Error: Native node modules cannot be included in the standalone distribution:\n\n${blocked.join("\n")}`)
		console.error(
			"\nThese modules must support prebuilt-install and be added to the supported list in scripts/package-standalone.mjs",
		)
		process.exit(1)
	}

	for (const module of SUPPORTED_BINARY_MODULES) {
		console.log(`Installing binaries for ${module}...`)
		const src = path.join(BUILD_DIR, "node_modules", module)
		if (!fs.existsSync(src)) {
			console.warn(`Warning: Trying to install binaries for the module '${module}', but it is not being used by cline.`)
			continue
		}

		for (const { platform, arch, targetDir } of TARGET_PLATFORMS) {
			const binaryDir = `${BINARIES_DIR}/${targetDir}/node_modules`
			fs.mkdirSync(binaryDir, { recursive: true })

			// Copy the module from the build dir
			const dest = path.join(binaryDir, module)
			await cpr(src, dest)

			// Download the binary libs
			const v = IS_VERBOSE ? "--verbose" : ""
			const cmd = `npx prebuild-install --platform=${platform} --arch=${arch} --target=${TARGET_NODE_VERSION} ${v}`
			log_verbose(`${module}: ${cmd}`)
			execSync(cmd, { cwd: dest, stdio: "inherit" })
			log_verbose("")
		}
		// Remove the original module with the host platform binaries installed directly into node_modules.
		log_verbose(`Cleaning up host version of ${module}`)
		await rmrf(src)
		log_verbose("")
	}
}

async function zipDistribution() {
	// Use different filename for CLI builds
	// Default (JetBrains) = standalone.zip, CLI = standalone-cli.zip
	const zipFilename = IS_CLI_BUILD ? "standalone-cli.zip" : "standalone.zip"
	const zipPath = path.join(BUILD_DIR, zipFilename)
	const output = fs.createWriteStream(zipPath)
	const startTime = Date.now()
	const archive = archiver("zip", { zlib: { level: 6 } })

	output.on("close", () => {
		const endTime = Date.now()
		const duration = (endTime - startTime) / 1000
		console.log(`Created ${zipPath} (${(archive.pointer() / 1024 / 1024).toFixed(1)} MB) in ${duration.toFixed(2)} seconds`)
	})
	archive.on("warning", (err) => {
		console.warn(`Warning: ${err}`)
	})
	archive.on("error", (err) => {
		throw err
	})

	archive.pipe(output)

	// Build ignore lists for build directory and extension directory
	const ignorePatterns = ["standalone.zip", "standalone-cli.zip"]
	const extensionIgnores = ["dist/**"]

	// For JetBrains (default) builds, exclude binaries from both directories
	if (!IS_CLI_BUILD) {
		// JetBrains provides their own Node.js, so exclude all binaries
		ignorePatterns.push(
			"bin/**", // Exclude entire bin directory
			"node-binaries/**", // Exclude all platform-specific Node.js binaries
		)
		extensionIgnores.push(
			"cli/bin/**", // Exclude CLI binaries from extension
			"node-binaries/**", // Exclude node-binaries from extension
		)
		console.log("JetBrains build: Excluding Node.js and CLI binaries (JetBrains provides its own Node.js)")
	}

	// Add all the files from the standalone build dir.
	archive.glob("**/*", {
		cwd: BUILD_DIR,
		ignore: ignorePatterns,
	})

	// Exclude the same files as the VCE vscode extension packager.
	const isIgnored = createIsIgnored(extensionIgnores)

	// Add the whole cline directory under "extension", except the for the ignored files.
	archive.directory(process.cwd(), "extension", (entry) => {
		if (isIgnored(entry.name)) {
			//log_verbose("Ignoring", entry.name)
			return false
		}
		return entry
	})

	console.log("Zipping package...")
	await archive.finalize()
}

/**
 * This is based on https://github.com/microsoft/vscode-vsce/blob/fafad8a63e9cf31179f918eb7a4eeb376834c904/src/package.ts#L1695
 * because the .vscodeignore format is not compatible with the `ignore` npm module.
 */
function createIsIgnored(standaloneIgnores) {
	const MinimatchOptions = { dot: true }
	const defaultIgnore = [
		".vscodeignore",
		"package-lock.json",
		"npm-debug.log",
		"yarn.lock",
		"yarn-error.log",
		"npm-shrinkwrap.json",
		".editorconfig",
		".npmrc",
		".yarnrc",
		".gitattributes",
		"*.todo",
		"tslint.yaml",
		".eslintrc*",
		".babelrc*",
		".prettierrc*",
		"biome.json*",
		".cz-config.js",
		".commitlintrc*",
		"webpack.config.js",
		"ISSUE_TEMPLATE.md",
		"CONTRIBUTING.md",
		"PULL_REQUEST_TEMPLATE.md",
		"CODE_OF_CONDUCT.md",
		".github",
		".travis.yml",
		"appveyor.yml",
		"**/.git",
		"**/.git/**",
		"**/*.vsix",
		"**/.DS_Store",
		"**/*.vsixmanifest",
		"**/.vscode-test/**",
		"**/.vscode-test-web/**",
	]

	const rawIgnore = fs.readFileSync(".vscodeignore", "utf8")

	// Parse raw ignore by splitting output into lines and filtering out empty lines and comments
	const parsedIgnore = rawIgnore
		.split(/[\n\r]/)
		.map((s) => s.trim())
		.filter((s) => !!s)
		.filter((i) => !/^\s*#/.test(i))

	// Add '/**' to possible folder names
	const expandedIgnore = [
		...parsedIgnore,
		...parsedIgnore.filter((i) => !/(^|\/)[^/]*\*[^/]*$/.test(i)).map((i) => (/\/$/.test(i) ? `${i}**` : `${i}/**`)),
	]

	// Combine with default ignore list
	// Also ignore the dist directory- the build directory for the extension.
	let allIgnore = [...defaultIgnore, ...expandedIgnore, ...standaloneIgnores]

	// Map files need to be included in the debug build. Remove .map ignores when IS_DEBUG_BUILD is set
	if (IS_DEBUG_BUILD) {
		allIgnore = allIgnore.filter((pattern) => !pattern.endsWith(".map"))
		console.log("Debug build: Including .map files in package")
	}

	// Split into ignore and negate list
	const [ignore, negate] = allIgnore.reduce(
		(r, e) => (!/^\s*!/.test(e) ? [[...r[0], e], r[1]] : [r[0], [...r[1], e]]),
		[[], []],
	)

	function isIgnored(f) {
		return (
			ignore.some((i) => minimatch(f, i, MinimatchOptions)) &&
			!negate.some((i) => minimatch(f, i.substr(1), MinimatchOptions))
		)
	}
	return isIgnored
}

/* cp -r */
async function cpr(source, dest) {
	log_verbose(`Copying ${source} -> ${dest}`)
	await cp(source, dest, {
		recursive: true,
		preserveTimestamps: true,
		dereference: false, // preserve symlinks instead of following them
	})
}

function log_verbose(...args) {
	if (IS_VERBOSE) {
		console.log(...args)
	}
}

await main()
