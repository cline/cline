#!/usr/bin/env node

/**
 * NPM Package Builder for Cline CLI (TypeScript)
 *
 * This script builds the Cline CLI NPM package (dist-standalone/).
 * It packages the TypeScript CLI from cli-ts/.
 *
 * Usage: node scripts/package-npm.mjs
 *
 * Prerequisites:
 *   - cd cli-ts && npm run build:production
 */

import { execSync } from "child_process"
import fs from "fs"
import { cp } from "fs/promises"
import path from "path"

const BUILD_DIR = "dist-standalone"
const CLI_TS_DIR = "cli-ts"
const IS_VERBOSE = process.argv.includes("-v") || process.argv.includes("--verbose")

async function main() {
	console.log("🚀 Building Cline CLI NPM Package (TypeScript)\n")

	await cleanBuildDir()
	await buildTypeScriptCli()
	await copyCliDist()
	await createNpmPackageJson()
	await copyReadme()
	await createNpmIgnoreFile()

	console.log("\n✅ Build complete!")
	console.log(`\n📦 NPM package ready in ${BUILD_DIR}/`)
	console.log(`To publish: cd ${BUILD_DIR} && npm publish`)
}

/**
 * Clean the build directory
 */
async function cleanBuildDir() {
	console.log("Cleaning build directory...")
	await rmrf(BUILD_DIR)
	fs.mkdirSync(BUILD_DIR, { recursive: true })
	console.log(`✓ ${BUILD_DIR}/ cleaned`)
}

/**
 * Build the TypeScript CLI
 */
async function buildTypeScriptCli() {
	console.log("Building TypeScript CLI...")

	// Install dependencies if needed
	if (!fs.existsSync(path.join(CLI_TS_DIR, "node_modules"))) {
		console.log("Installing cli-ts dependencies...")
		execSync("npm install", { stdio: "inherit", cwd: CLI_TS_DIR })
	}

	// Build production bundle
	execSync("npm run build:production", { stdio: "inherit", cwd: CLI_TS_DIR })
	console.log("✓ TypeScript CLI built")
}

/**
 * Copy the CLI dist folder to build directory
 */
async function copyCliDist() {
	console.log("Copying CLI distribution files...")

	const distSource = path.join(CLI_TS_DIR, "dist")
	const distDest = path.join(BUILD_DIR, "dist")

	if (!fs.existsSync(distSource)) {
		console.error(`Error: CLI dist not found at ${distSource}`)
		console.error(`Please run: cd cli-ts && npm run build:production`)
		process.exit(1)
	}

	await cpr(distSource, distDest)

	// Make the CLI executable
	const cliPath = path.join(distDest, "cli.mjs")
	if (fs.existsSync(cliPath)) {
		fs.chmodSync(cliPath, 0o755)
	}

	console.log(`✓ CLI dist copied to ${distDest}`)
}

/**
 * Create package.json for NPM publication
 * Reads from cli-ts/package.json and modifies for publication
 */
async function createNpmPackageJson() {
	console.log("Creating NPM package.json...")

	const sourcePackageJson = path.join(CLI_TS_DIR, "package.json")

	if (!fs.existsSync(sourcePackageJson)) {
		console.error(`Error: package.json not found at ${sourcePackageJson}`)
		process.exit(1)
	}

	const pkg = JSON.parse(fs.readFileSync(sourcePackageJson, "utf8"))

	// Modify for NPM publication
	const npmPkg = {
		name: "cline", // Change from @cline/cli to cline for NPM
		version: pkg.version,
		description: pkg.description,
		main: pkg.main,
		bin: pkg.bin,
		type: pkg.type,
		engines: pkg.engines,
		keywords: pkg.keywords,
		author: pkg.author,
		license: pkg.license,
		repository: pkg.repository,
		homepage: pkg.homepage,
		bugs: pkg.bugs,
		dependencies: pkg.dependencies,
		os: ["darwin", "linux"],
		cpu: ["x64", "arm64"],
	}

	const destPackageJson = path.join(BUILD_DIR, "package.json")
	fs.writeFileSync(destPackageJson, JSON.stringify(npmPkg, null, "\t"))

	console.log(`✓ package.json created (name: cline, version: ${pkg.version})`)
}

/**
 * Copy README.md from cli-ts/ directory
 */
async function copyReadme() {
	console.log("Copying README...")

	// Try cli-ts README first, fall back to cli/ README
	let readmeSource = path.join(CLI_TS_DIR, "README.md")

	if (!fs.existsSync(readmeSource)) {
		readmeSource = path.join("cli", "README.md")
	}

	if (!fs.existsSync(readmeSource)) {
		console.warn("Warning: No README.md found, skipping")
		return
	}

	const readmeDest = path.join(BUILD_DIR, "README.md")
	await cpr(readmeSource, readmeDest)
	console.log(`✓ README.md copied from ${readmeSource}`)
}

/**
 * Create .npmignore file to exclude unnecessary files
 */
async function createNpmIgnoreFile() {
	console.log("Creating .npmignore file...")

	const npmignoreContent = `# Exclude build artifacts and unnecessary files
*.map
*.ts
!*.d.ts
tsconfig.json
.eslintrc*
.prettierrc*
`

	const npmignorePath = path.join(BUILD_DIR, ".npmignore")
	fs.writeFileSync(npmignorePath, npmignoreContent)

	console.log(`✓ .npmignore created`)
}

/* cp -r */
async function cpr(source, dest) {
	log_verbose(`Copying ${source} -> ${dest}`)
	await cp(source, dest, {
		recursive: true,
		preserveTimestamps: true,
		dereference: false,
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
