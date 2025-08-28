#!/usr/bin/env node

import archiver from "archiver"
import { execSync } from "child_process"
import fs from "fs"
import { cp } from "fs/promises"
import { glob } from "glob"
import minimatch from "minimatch"
import path from "path"

const BUILD_DIR = "dist-standalone"
const RUNTIME_DEPS_DIR = "standalone/runtime-files"

async function main() {
	await installNodeDependencies()
	await zipDistribution()
}

async function installNodeDependencies() {
	await cpr(RUNTIME_DEPS_DIR, BUILD_DIR)

	console.log("Running npm install in distribution directory...")
	const cwd = process.cwd()
	process.chdir(BUILD_DIR)

	try {
		execSync("npm install", { stdio: "inherit" })
		// Move the vscode directory into node_modules.
		// It can't be installed using npm because it will create a symlink which cannot be unzipped correctly on windows.
		fs.renameSync("vscode", path.join("node_modules", "vscode"))
	} catch (error) {
		console.error("Error during setup:", error)
		process.exit(1)
	} finally {
		process.chdir(cwd)
	}

	// Check for native .node modules.
	const nativeModules = await glob("**/*.node", { cwd: BUILD_DIR, nodir: true })
	if (nativeModules.length > 0) {
		console.error("Native node modules cannot be included in the standalone distribution:\n", nativeModules.join("\n"))
		process.exit(1)
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
			log_verbose("Ignoring", entry.name)
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
	if (process.env.IS_DEBUG_BUILD) {
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
	await cp(source, dest, {
		recursive: true,
		preserveTimestamps: true,
		dereference: false, // preserve symlinks instead of following them
	})
}

function log_verbose(...args) {
	if (process.argv.includes("-v") || process.argv.includes("--verbose")) {
		console.log(...args)
	}
}

await main()
