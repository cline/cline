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
const RUNTIME_DEPS_DIR = "standalone/runtime-files"

// This should match the node version packaged with the JetBrains plugin.
const TARGET_NODE_VERSION = "22.15.0"
const TARGET_PLATFORMS = [
	{ platform: "win32", arch: "x64" },
	{ platform: "darwin", arch: "x64" },
	{ platform: "darwin", arch: "arm64" },
	{ platform: "linux", arch: "x64" },
	{ platform: "linux", arch: "arm64" },
]
const SUPPORTED_BINARY_MODULES = ["better-sqlite3"] //, "keytar"]

const UNIVERSAL_BUILD = !process.argv.includes("-s")
const IS_VERBOSE = process.argv.includes("-v") || process.argv.includes("--verbose")

async function main() {
	await installNodeDependencies()
	if (UNIVERSAL_BUILD) {
		console.log("Building universal package for all platforms...")
		await packageAllBinaryDeps()
		await removeHostBinaryModules()
	} else {
		console.log(`Building package for ${os.platform()}-${os.arch()}...`)
	}
	await zipDistribution()
}

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
 * Downloads prebuilt binaries for each platform for the modules that include binaries. It uses `npx prebuild-install`
 * to download the binary.
 *
 * The modules are downloaded to dist-standalone/binaries/{os}-{platform}/.
 * When cline-core is installed, the installer should use the correct module for the current platform.
 */
async function packageAllBinaryDeps() {
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

	for (const { platform, arch } of TARGET_PLATFORMS) {
		console.log(`Installing packages for ${platform}-${arch}...`)
		const binaryDir = `${BUILD_DIR}/binaries/${platform}-${arch}/node_modules`
		fs.mkdirSync(binaryDir, { recursive: true })

		for (const module of SUPPORTED_BINARY_MODULES) {
			const src = path.join(BUILD_DIR, "node_modules", module)
			const dest = path.join(binaryDir, module)
			await cpr(src, dest)

			const v = IS_VERBOSE ? "--verbose" : ""
			const cmd = `npx prebuild-install --platform=${platform} --arch=${arch} --target=${TARGET_NODE_VERSION} ${v}`
			log_verbose(`${module}: ${cmd}`)
			execSync(cmd, { cwd: dest, stdio: "inherit" })
			log_verbose("")
		}
	}
}

/**
 * Remove modules with binary dependencies that were installed directly into node_modules.
 * For universal builds, cline-core needs to use the module from the appropriate binary directory.
 */
async function removeHostBinaryModules() {
	for (const module of SUPPORTED_BINARY_MODULES) {
		console.log(`Cleaning up host version of ${module}`)
		rmrf(path.join(BUILD_DIR, "node_modules", module))
	}
}

async function zipDistribution() {
	// Zip the build directory (excluding any pre-existing output zip).
	const zipPath = path.join(BUILD_DIR, "standalone.zip")
	const output = fs.createWriteStream(zipPath)
	const archive = archiver("zip", { zlib: { level: 3 } })

	output.on("close", () => {
		console.log(`Created ${zipPath} (${(archive.pointer() / 1024 / 1024).toFixed(1)} MB)`)
	})
	archive.on("warning", (err) => {
		console.warn(`Warning: ${err}`)
	})
	archive.on("error", (err) => {
		throw err
	})

	archive.pipe(output)
	// Add all the files from the standalone build dir.
	archive.glob("**/*", {
		cwd: BUILD_DIR,
		ignore: ["standalone.zip"],
	})

	// Exclude the same files as the VCE vscode extension packager.
	// Also ignore the dist directory, the build directory for the extension.
	const isIgnored = createIsIgnored(["dist/**"])

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
	if (process.env.IS_DEBUG_BUILD == "true") {
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
