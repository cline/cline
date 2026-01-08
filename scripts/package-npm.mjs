#!/usr/bin/env node

/**
 * NPM Package Builder for Cline CLI
 *
 * This script builds the Cline CLI NPM package (dist-standalone/).
 * It is completely independent from package-standalone.mjs (JetBrains build).
 *
 * Usage: node scripts/package-npm.mjs
 *
 * Prerequisites:
 *   - npm run protos && npm run protos-go
 *   - npm run compile-cli
 *   - npm run compile-cli-all-platforms
 *   - npm run download-ripgrep
 */

import { execSync } from "child_process"
import fs from "fs"
import { cp } from "fs/promises"
import path from "path"

const BUILD_DIR = "dist-standalone"
const RUNTIME_DEPS_DIR = "standalone/runtime-files"
const RIPGREP_BINARIES_DIR = `${BUILD_DIR}/ripgrep-binaries`
const CLI_BINARIES_DIR = "cli/bin"
const IS_VERBOSE = process.argv.includes("-v") || process.argv.includes("--verbose")

async function main() {
	console.log("🚀 Building Cline NPM Package\n")

	await installNodeDependencies()
	await copyCliBinaries()
	await copyRipgrepBinaries()
	await copyProtoDescriptors()
	await createNpmPackageFiles()
	await createFakeNodeModules()
	await createNpmIgnoreFile()
	await createPostinstallScript()

	console.log("\n✅ Build complete!")
	console.log(`\n📦 NPM package ready in ${BUILD_DIR}/`)
	console.log(`To publish: cd ${BUILD_DIR} && npm publish`)
}

/**
 * Install node dependencies in the build directory
 */
async function installNodeDependencies() {
	// Clean modules from any previous builds
	await rmrf(path.join(BUILD_DIR, "node_modules"))

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
			console.error(`Please run: npm run compile-cli-all-platforms`)
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
			console.error(`Please run: npm run compile-cli-all-platforms`)
			process.exit(1)
		}

		await cpr(hostSource, hostDest)
		fs.chmodSync(hostDest, 0o755)
		console.log(`✓ cline-host-${platformSuffix} copied`)
	}

	console.log(`✓ All CLI binaries copied to ${binDir}`)
}

/**
 * Copy ripgrep binaries for ALL platforms
 * Ripgrep is needed by cline-core for file searching
 * The postinstall script will select the correct binary for the user's platform
 */
async function copyRipgrepBinaries() {
	console.log("Copying ripgrep binaries for all platforms...")

	const platforms = [
		{ dir: "darwin-arm64", binary: "rg" },
		{ dir: "darwin-x64", binary: "rg" },
		{ dir: "linux-x64", binary: "rg" },
		{ dir: "linux-arm64", binary: "rg" },
		// { dir: "win-x64", binary: "rg.exe" },  // Windows not supported yet
	]

	const ripgrepDir = path.join(BUILD_DIR, "ripgrep")

	// Create ripgrep directory
	fs.mkdirSync(ripgrepDir, { recursive: true })

	// Check if ripgrep binaries exist, download if missing
	const firstPlatform = platforms[0]
	const firstBinaryPath = path.join(RIPGREP_BINARIES_DIR, firstPlatform.dir, firstPlatform.binary)
	if (!fs.existsSync(firstBinaryPath)) {
		console.log(`Ripgrep binaries not found, downloading...`)
		try {
			execSync("npm run download-ripgrep", { stdio: "inherit" })
		} catch (error) {
			console.error(`Error downloading ripgrep: ${error.message}`)
			console.error(`Please run: npm run download-ripgrep`)
			process.exit(1)
		}
	}

	// Copy all platform-specific binaries
	for (const { dir, binary } of platforms) {
		const source = path.join(RIPGREP_BINARIES_DIR, dir, binary)
		const dest = path.join(ripgrepDir, `rg-${dir}`)

		if (!fs.existsSync(source)) {
			console.error(`Error: Ripgrep binary not found at ${source}`)
			console.error(`Please run: npm run download-ripgrep`)
			process.exit(1)
		}

		await cpr(source, dest)
		fs.chmodSync(dest, 0o755)
		console.log(`✓ rg-${dir} copied`)
	}

	console.log(`✓ All ripgrep binaries copied to ${ripgrepDir}`)
}

/**
 * Verify proto descriptors exist in the build directory
 * The proto/descriptor_set.pb file is generated by build-proto.mjs to dist-standalone/proto/
 * We do NOT copy from proto/ source because that would overwrite the freshly generated descriptor
 */
async function copyProtoDescriptors() {
	console.log("Verifying proto descriptors...")

	const protoDest = path.join(BUILD_DIR, "proto")
	const descriptorPath = path.join(protoDest, "descriptor_set.pb")

	// Check if descriptor_set.pb exists in the build directory
	// It should have been generated by `npm run protos` which runs build-proto.mjs
	if (!fs.existsSync(descriptorPath)) {
		console.error(`Error: proto/descriptor_set.pb not found at ${descriptorPath}`)
		console.error(`Please run: npm run protos`)
		console.error(`Note: build-proto.mjs generates the descriptor to dist-standalone/proto/`)
		process.exit(1)
	}

	// Verify the descriptor is recent (not stale)
	const stats = fs.statSync(descriptorPath)
	const ageMinutes = (Date.now() - stats.mtimeMs) / 1000 / 60
	if (ageMinutes > 60) {
		console.warn(`Warning: descriptor_set.pb is ${Math.round(ageMinutes)} minutes old`)
		console.warn(`Consider running: npm run protos`)
	}

	console.log(`✓ Proto descriptors verified at ${protoDest}`)
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

	// Map Node.js arch names to Go arch names (for CLI binaries)
	let goArch = arch;
	if (arch === 'x64') {
		goArch = 'amd64';
	}

	// Map for ripgrep binaries (uses different naming)
	let rgArch = arch;
	if (arch === 'arm64') {
		rgArch = 'arm64';
	} else if (arch === 'x64') {
		rgArch = 'x64';
	}

	return { platform, arch, goArch, rgArch };
}

// Setup platform-specific binaries
function setupBinaries() {
	const { platform, goArch, rgArch } = getPlatformInfo();
	const cliPlatformSuffix = \`\${platform}-\${goArch}\`;
	const rgPlatformSuffix = \`\${platform}-\${rgArch}\`;
	
	console.log(\`Setting up Cline CLI for \${cliPlatformSuffix}...\`);

	// Setup CLI binaries
	const binDir = path.join(__dirname, 'bin');
	
	// Check if platform-specific binaries exist
	const clineSource = path.join(binDir, \`cline-\${cliPlatformSuffix}\`);
	const clineHostSource = path.join(binDir, \`cline-host-\${cliPlatformSuffix}\`);
	
	if (!fs.existsSync(clineSource)) {
		console.error(\`Error: Binary not found for platform \${cliPlatformSuffix}\`);
		console.error(\`Expected: \${clineSource}\`);
		console.error(\`Supported platforms: darwin-arm64, darwin-amd64, linux-amd64, linux-arm64\`);
		process.exit(1);
	}
	
	if (!fs.existsSync(clineHostSource)) {
		console.error(\`Error: Binary not found for platform \${cliPlatformSuffix}\`);
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
		console.log('✓ Copied platform-specific CLI binaries');
	} else {
		// Unix: create symlinks
		fs.symlinkSync(path.basename(clineSource), clineTarget);
		fs.symlinkSync(path.basename(clineHostSource), clineHostTarget);
		console.log('✓ Created symlinks to platform-specific CLI binaries');
		
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

	// Setup ripgrep binary
	console.log(\`Setting up ripgrep for \${rgPlatformSuffix}...\`);
	
	const ripgrepDir = path.join(__dirname, 'ripgrep');
	const rgSource = path.join(ripgrepDir, \`rg-\${rgPlatformSuffix}\`);
	const rgTarget = path.join(__dirname, 'rg');
	
	if (!fs.existsSync(rgSource)) {
		console.error(\`Error: ripgrep binary not found for platform \${rgPlatformSuffix}\`);
		console.error(\`Expected: \${rgSource}\`);
		console.error(\`Supported platforms: darwin-arm64, darwin-x64, linux-x64, linux-arm64\`);
		process.exit(1);
	}
	
	// Remove existing rg if it exists
	if (fs.existsSync(rgTarget)) {
		try {
			fs.unlinkSync(rgTarget);
		} catch (e) {
			console.warn(\`Warning: Could not remove existing ripgrep: \${e.message}\`);
		}
	}
	
	// Copy ripgrep binary to root (where cline-core expects it)
	fs.copyFileSync(rgSource, rgTarget);
	
	// Make ripgrep executable (Unix only)
	if (platform !== 'win32') {
		try {
			fs.chmodSync(rgTarget, 0o755);
		} catch (error) {
			console.warn(\`Warning: Could not set ripgrep executable permissions: \${error.message}\`);
		}
	}
	console.log('✓ Copied platform-specific ripgrep binary');

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

/* cp -r */
async function cpr(source, dest) {
	log_verbose(`Copying ${source} -> ${dest}`)
	await cp(source, dest, {
		recursive: true,
		preserveTimestamps: true,
		dereference: false, // preserve symlinks instead of following them
	})
}

/* rm -rf */
async function rmrf(dir) {
	if (fs.existsSync(dir)) {
		log_verbose(`Removing ${dir}`)
		fs.rmSync(dir, { recursive: true, force: true })
	}
}

function log_verbose(...args) {
	if (IS_VERBOSE) {
		console.log(...args)
	}
}

await main()
