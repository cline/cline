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

// Parse --target flag (e.g., --target=npm)
// Default behavior is JetBrains build (no binaries)
// Use --target=npm for npm package build (CLI binaries but no Node.js)
const targetArg = process.argv.find((arg) => arg.startsWith("--target="))
const BUILD_TARGET = targetArg ? targetArg.split("=")[1] : "jetbrains"
const IS_NPM_BUILD = BUILD_TARGET === "npm"

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
	const buildType = IS_NPM_BUILD ? "NPM Package" : "JetBrains"
	console.log(`🚀 Building Cline ${buildType} Package\n`)

	await installNodeDependencies()

	if (IS_NPM_BUILD) {
		await copyCliBinaries()
		await copyRipgrepBinary()
		await copyProtoDescriptors()
		await createNpmPackageFiles()
		await createFakeNodeModules()
		await createNpmIgnoreFile()
		await createPostinstallScript()
	}

	if (UNIVERSAL_BUILD && !IS_NPM_BUILD) {
		console.log("\nBuilding universal package for all platforms...")
		await packageAllBinaryDeps()
	} else if (IS_NPM_BUILD) {
		console.log("\nNPM build: Keeping native modules in node_modules for npm to handle...")
	} else {
		console.log(`\nBuilding package for ${os.platform()}-${os.arch()}...`)
	}

	if (!IS_NPM_BUILD) {
		console.log("\n📦 Creating final package...")
		await zipDistribution()
	}

	console.log("\n✅ Build complete!")
	if (IS_NPM_BUILD) {
		console.log(`\n📦 NPM package ready in ${BUILD_DIR}/`)
		console.log(`To publish: cd ${BUILD_DIR} && npm publish`)
	}
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
 * Copy CLI binaries (cline and cline-host) for all platforms
 * The Go binaries are cross-compiled for darwin/linux arm64/amd64
 */
async function copyCliBinaries() {
	console.log("Copying CLI binaries for all platforms...")

	const platforms = [
		{ os: "darwin", arch: "arm64" },
		{ os: "darwin", arch: "amd64" },
		{ os: "linux", arch: "amd64" },
		{ os: "linux", arch: "arm64" },
	]

	const binDir = path.join(BUILD_DIR, "bin")

	// Create bin directory
	fs.mkdirSync(binDir, { recursive: true })

	// Copy all platform-specific binaries
	for (const { os, arch } of platforms) {
		const platformSuffix = `${os}-${arch}`

		// Copy cline binary
		const clineSource = path.join(CLI_BINARIES_DIR, `cline-${platformSuffix}`)
		const clineDest = path.join(binDir, `cline-${platformSuffix}`)

		if (!fs.existsSync(clineSource)) {
			console.error(`Error: CLI binary not found at ${clineSource}`)
			console.error(`Please run: npm run compile-cli`)
			process.exit(1)
		}

		await cpr(clineSource, clineDest)
		fs.chmodSync(clineDest, 0o755)
		console.log(`✓ cline-${platformSuffix} copied`)

		// Copy cline-host binary
		const hostSource = path.join(CLI_BINARIES_DIR, `cline-host-${platformSuffix}`)
		const hostDest = path.join(binDir, `cline-host-${platformSuffix}`)

		if (!fs.existsSync(hostSource)) {
			console.error(`Error: CLI binary not found at ${hostSource}`)
			console.error(`Please run: npm run compile-cli`)
			process.exit(1)
		}

		await cpr(hostSource, hostDest)
		fs.chmodSync(hostDest, 0o755)
		console.log(`✓ cline-host-${platformSuffix} copied`)
	}

	console.log(`✓ All platform binaries copied to ${binDir}`)
}

/**
 * Copy proto descriptors directory
 * The proto/descriptor_set.pb file is needed by cline-core for gRPC reflection
 */
async function copyProtoDescriptors() {
	console.log("Copying proto descriptors...")

	const protoSource = "proto"
	const protoDest = path.join(BUILD_DIR, "proto")

	// Check if proto directory exists
	if (!fs.existsSync(protoSource)) {
		console.error(`Error: proto directory not found at ${protoSource}`)
		console.error(`Please ensure the proto files have been generated`)
		process.exit(1)
	}

	// Check if descriptor_set.pb exists
	const descriptorPath = path.join(protoSource, "descriptor_set.pb")
	if (!fs.existsSync(descriptorPath)) {
		console.error(`Error: proto/descriptor_set.pb not found at ${descriptorPath}`)
		console.error(`Please run: npm run protos`)
		process.exit(1)
	}

	// Copy the entire proto directory
	await cpr(protoSource, protoDest)

	console.log(`✓ Proto descriptors copied to ${protoDest}`)
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

	// Check if ripgrep binaries exist, download if missing
	if (!fs.existsSync(ripgrepBinarySource)) {
		console.log(`Ripgrep binary not found, downloading...`)
		try {
			execSync("npm run download-ripgrep", { stdio: "inherit" })
		} catch (error) {
			console.error(`Error downloading ripgrep: ${error.message}`)
			console.error(`Please run: npm run download-ripgrep`)
			process.exit(1)
		}

		// Check again after download
		if (!fs.existsSync(ripgrepBinarySource)) {
			console.error(`Error: Ripgrep binary still not found at ${ripgrepBinarySource}`)
			console.error(`Download may have failed. Please run: npm run download-ripgrep`)
			process.exit(1)
		}
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
 * Copy NPM package files (package.json, README.md, and man page) from cli/ directory
 */
async function createNpmPackageFiles() {
	console.log("Copying NPM package files...")

	// Copy package.json from cli/ directory
	const packageJsonSource = path.join("cli", "package.json")
	const packageJsonDest = path.join(BUILD_DIR, "package.json")

	if (!fs.existsSync(packageJsonSource)) {
		console.error(`Error: NPM package.json not found at ${packageJsonSource}`)
		process.exit(1)
	}

	await cpr(packageJsonSource, packageJsonDest)
	console.log(`✓ package.json copied from ${packageJsonSource}`)

	// Copy README.md from cli/ directory
	const readmeSource = path.join("cli", "README.md")
	const readmeDest = path.join(BUILD_DIR, "README.md")

	if (!fs.existsSync(readmeSource)) {
		console.error(`Error: NPM README.md not found at ${readmeSource}`)
		process.exit(1)
	}

	await cpr(readmeSource, readmeDest)
	console.log(`✓ README.md copied from ${readmeSource}`)

	// Copy man page from cli/man/ directory
	const manPageSource = path.join("cli", "man", "cline.1")
	const manDir = path.join(BUILD_DIR, "man")
	const manPageDest = path.join(manDir, "cline.1")

	if (!fs.existsSync(manPageSource)) {
		console.error(`Error: Man page not found at ${manPageSource}`)
		process.exit(1)
	}

	// Create man directory if it doesn't exist
	fs.mkdirSync(manDir, { recursive: true })

	await cpr(manPageSource, manPageDest)
	console.log(`✓ Man page copied from ${manPageSource}`)
}

/**
 * Create fake_node_modules directory with vscode stub
 * This directory will be added to NODE_PATH so Node.js can find the vscode module
 * without npm interfering with the real node_modules directory
 */
async function createFakeNodeModules() {
	console.log("Creating fake_node_modules with vscode stub...")

	const vscodeSource = path.join(BUILD_DIR, "node_modules", "vscode")
	const fakeNodeModulesDir = path.join(BUILD_DIR, "fake_node_modules")
	const vscodeDest = path.join(fakeNodeModulesDir, "vscode")

	if (!fs.existsSync(vscodeSource)) {
		console.error(`Error: vscode stub module not found at ${vscodeSource}`)
		process.exit(1)
	}

	// Create fake_node_modules directory
	fs.mkdirSync(fakeNodeModulesDir, { recursive: true })

	// Copy vscode stub into fake_node_modules
	await cpr(vscodeSource, vscodeDest)

	console.log(`✓ fake_node_modules/vscode created at ${vscodeDest}`)
}

/**
 * Create .npmignore file to ensure necessary files are included
 */
async function createNpmIgnoreFile() {
	console.log("Creating .npmignore file...")

	// Create .npmignore that excludes build artifacts
	// Note: proto/ directory is NOT excluded because proto/descriptor_set.pb is needed at runtime
	const npmignoreContent = `# Exclude build artifacts and unnecessary files
binaries/
ripgrep-binaries/
standalone.zip
cline-core.js.map
package-lock.json
tree-sitter*.wasm
node_modules/vscode
`

	const npmignorePath = path.join(BUILD_DIR, ".npmignore")
	fs.writeFileSync(npmignorePath, npmignoreContent)

	console.log(`✓ .npmignore created`)
}

/**
 * Create postinstall script for NPM package
 * This script selects the correct platform-specific binary and creates symlinks
 */
async function createPostinstallScript() {
	console.log("Creating postinstall script...")

	const postinstallScript = `#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

// Detect current platform and architecture
function getPlatformInfo() {
	const platform = os.platform();
	const arch = os.arch();

	// Map Node.js arch names to Go arch names
	let goArch = arch;
	if (arch === 'x64') {
		goArch = 'amd64';
	}

	let goPlatform = platform;
	
	return { platform: goPlatform, arch: goArch };
}

// Setup platform-specific binaries
function setupBinaries() {
	const { platform, arch } = getPlatformInfo();
	const platformSuffix = \`\${platform}-\${arch}\`;
	
	console.log(\`Setting up Cline CLI for \${platformSuffix}...\`);

	const binDir = path.join(__dirname, 'bin');
	
	// Check if platform-specific binaries exist
	const clineSource = path.join(binDir, \`cline-\${platformSuffix}\`);
	const clineHostSource = path.join(binDir, \`cline-host-\${platformSuffix}\`);
	
	if (!fs.existsSync(clineSource)) {
		console.error(\`Error: Binary not found for platform \${platformSuffix}\`);
		console.error(\`Expected: \${clineSource}\`);
		console.error(\`Supported platforms: darwin-arm64, darwin-amd64, linux-amd64, linux-arm64\`);
		process.exit(1);
	}
	
	if (!fs.existsSync(clineHostSource)) {
		console.error(\`Error: Binary not found for platform \${platformSuffix}\`);
		console.error(\`Expected: \${clineHostSource}\`);
		process.exit(1);
	}

	// Create symlinks or copies to the generic names
	const clineTarget = path.join(binDir, 'cline');
	const clineHostTarget = path.join(binDir, 'cline-host');
	
	// Remove existing files if they exist
	[clineTarget, clineHostTarget].forEach(target => {
		if (fs.existsSync(target)) {
			try {
				fs.unlinkSync(target);
			} catch (e) {
				console.warn(\`Warning: Could not remove existing file \${target}: \${e.message}\`);
			}
		}
	});
	
	// On Unix, create symlinks; on Windows, copy files
	if (platform === 'win32') {
		// Windows: copy files
		fs.copyFileSync(clineSource, clineTarget);
		fs.copyFileSync(clineHostSource, clineHostTarget);
		console.log('✓ Copied platform-specific binaries');
	} else {
		// Unix: create symlinks
		fs.symlinkSync(path.basename(clineSource), clineTarget);
		fs.symlinkSync(path.basename(clineHostSource), clineHostTarget);
		console.log('✓ Created symlinks to platform-specific binaries');
		
		// Make binaries executable
		try {
			fs.chmodSync(clineSource, 0o755);
			fs.chmodSync(clineHostSource, 0o755);
			fs.chmodSync(clineTarget, 0o755);
			fs.chmodSync(clineHostTarget, 0o755);
		} catch (error) {
			console.warn(\`Warning: Could not set executable permissions: \${error.message}\`);
		}
	}

	// Check ripgrep binary
	const rgBinary = platform === 'win32' ? 'rg.exe' : 'rg';
	const rgPath = path.join(__dirname, rgBinary);
	
	if (!fs.existsSync(rgPath)) {
		console.error(\`Error: ripgrep binary not found at \${rgPath}\`);
		process.exit(1);
	}

	// Make ripgrep executable (Unix only)
	if (platform !== 'win32') {
		try {
			fs.chmodSync(rgPath, 0o755);
		} catch (error) {
			console.warn(\`Warning: Could not set ripgrep executable permissions: \${error.message}\`);
		}
	}

	console.log('✓ Cline CLI installation complete');
	console.log('');
	console.log('Usage:');
	console.log('  cline        - Start Cline CLI');
	console.log('  cline-host   - Start Cline host service');
	console.log('');
	console.log('Documentation: https://docs.cline.bot');
}

try {
	setupBinaries();
} catch (error) {
	console.error(\`Installation failed: \${error.message}\`);
	console.error('Please report this issue at: https://github.com/cline/cline/issues');
	process.exit(1);
}
`

	const postinstallPath = path.join(BUILD_DIR, "postinstall.js")
	fs.writeFileSync(postinstallPath, postinstallScript)
	fs.chmodSync(postinstallPath, 0o755)

	console.log(`✓ postinstall.js created`)
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
	// Default JetBrains build
	const zipFilename = "standalone.zip"
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

	// For JetBrains builds, exclude binaries from both directories
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
