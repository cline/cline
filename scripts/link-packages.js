#!/usr/bin/env node

const { spawn, execSync } = require("child_process")
const path = require("path")
const fs = require("fs")

// Package configuration - Add new packages here as needed.
const config = {
	packages: [
		{
			name: "@roo-code/cloud",
			sourcePath: "../Roo-Code-Cloud/packages/sdk",
			targetPath: "src/node_modules/@roo-code/cloud",
			npmPath: "npm",
			watchCommand: "pnpm build:development:watch",
		},
	],
}

const args = process.argv.slice(2)
const packageName = args.find((arg) => !arg.startsWith("--"))
const watch = !args.includes("--no-watch")
const unlink = args.includes("--unlink")

const packages = packageName ? config.packages.filter((p) => p.name === packageName) : config.packages

if (!packages.length) {
	console.error(`Package '${packageName}' not found`)
	process.exit(1)
}

packages.forEach(unlink ? unlinkPackage : linkPackage)

// After unlinking, restore npm packages with a single pnpm install.
if (unlink && packages.length > 0) {
	const srcPath = path.resolve(__dirname, "..", "src")
	console.log("\nRestoring npm packages...")

	try {
		execSync("pnpm install", { cwd: srcPath, stdio: "inherit" })
		console.log("Successfully restored npm packages")
	} catch (error) {
		console.error(`Failed to restore packages: ${error.message}`)
		console.log("You may need to run 'pnpm install' manually in the src directory")
	}
}

if (!unlink && watch) {
	const watchers = packages.filter((pkg) => pkg.watchCommand).map(startWatch)

	if (watchers.length) {
		process.on("SIGINT", () => {
			console.log("\nStopping...")
			watchers.forEach((w) => w.kill())
			process.exit(0)
		})
		console.log("\nWatching for changes. Press Ctrl+C to stop.\n")
	}
}

function generateNpmPackageJson(sourcePath, npmPath) {
	const npmDir = path.join(sourcePath, npmPath)
	const npmPackagePath = path.join(npmDir, "package.json")
	const npmMetadataPath = path.join(npmDir, "package.metadata.json")
	const monorepoPackagePath = path.join(sourcePath, "package.json")

	if (fs.existsSync(npmPackagePath)) {
		console.log(`  ✓ npm/package.json already exists`)
		return
	}

	if (!fs.existsSync(npmMetadataPath)) {
		console.log(`  ⚠ No package.metadata.json found, skipping npm package.json generation`)
		return
	}

	try {
		console.log(`  📦 Generating npm/package.json...`)
		const monorepoPackage = JSON.parse(fs.readFileSync(monorepoPackagePath, "utf8"))
		const npmMetadata = JSON.parse(fs.readFileSync(npmMetadataPath, "utf8"))

		const npmPackage = {
			...npmMetadata,
			type: "module",
			dependencies: monorepoPackage.dependencies || {},
			main: "./dist/index.cjs",
			module: "./dist/index.js",
			types: "./dist/index.d.ts",
			exports: {
				".": {
					types: "./dist/index.d.ts",
					import: "./dist/index.js",
					require: {
						types: "./dist/index.d.cts",
						default: "./dist/index.cjs",
					},
				},
			},
			files: ["dist"],
		}

		fs.writeFileSync(npmPackagePath, JSON.stringify(npmPackage, null, 2) + "\n")
		console.log(`  ✓ Generated npm/package.json for ${npmPackage.name}`)
	} catch (error) {
		console.error(`  ✗ Failed to generate npm/package.json: ${error.message}`)
	}
}

function linkPackage(pkg) {
	const sourcePath = path.resolve(__dirname, "..", pkg.sourcePath)
	const targetPath = path.resolve(__dirname, "..", pkg.targetPath)

	if (!fs.existsSync(sourcePath)) {
		console.error(`Source not found: ${sourcePath}`)
		process.exit(1)
	}

	// Install dependencies if needed.
	if (!fs.existsSync(path.join(sourcePath, "node_modules"))) {
		console.log(`Installing dependencies for ${pkg.name}...`)

		try {
			execSync("pnpm install", { cwd: sourcePath, stdio: "inherit" })
		} catch (e) {
			execSync("pnpm install --no-frozen-lockfile", { cwd: sourcePath, stdio: "inherit" })
		}
	}

	// If npmPath is specified, check if we need to generate package.json.
	if (pkg.npmPath) {
		generateNpmPackageJson(sourcePath, pkg.npmPath)
	}

	// Create symlink.
	fs.rmSync(targetPath, { recursive: true, force: true })
	fs.mkdirSync(path.dirname(targetPath), { recursive: true })
	const linkSource = pkg.npmPath ? path.join(sourcePath, pkg.npmPath) : sourcePath
	fs.symlinkSync(linkSource, targetPath, "dir")
	console.log(`Linked ${pkg.name}`)
}

function unlinkPackage(pkg) {
	const targetPath = path.resolve(__dirname, "..", pkg.targetPath)
	if (fs.existsSync(targetPath)) {
		fs.rmSync(targetPath, { recursive: true, force: true })
		console.log(`Unlinked ${pkg.name}`)
	}
}

function startWatch(pkg) {
	console.log(`Watching ${pkg.name}...`)
	const [cmd, ...args] = pkg.watchCommand.split(" ")
	return spawn(cmd, args, {
		cwd: path.resolve(__dirname, "..", pkg.sourcePath),
		stdio: "inherit",
		shell: true,
	})
}
