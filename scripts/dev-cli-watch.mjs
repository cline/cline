#!/usr/bin/env node

import { execSync, spawn } from "child_process"
import chokidar from "chokidar"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, "..")

// ANSI color codes
const colors = {
	reset: "\x1b[0m",
	bright: "\x1b[1m",
	dim: "\x1b[2m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	red: "\x1b[31m",
	cyan: "\x1b[36m",
}

let isBuilding = false
let debounceTimer = null
let esbuildProcess = null
let initialBuildDone = false

console.log(`${colors.bright}${colors.cyan}🚀 Cline CLI Dev Watch Mode (Fast Incremental)${colors.reset}`)
console.log(`${colors.dim}Starting initial build...${colors.reset}\n`)

// Function to kill all CLI instances
function killAllInstances() {
	try {
		execSync("./cli/bin/cline instance kill --all", {
			cwd: projectRoot,
			stdio: "pipe",
		})
	} catch (error) {
		// Ignore errors - instances might not be running
	}
}

// Function to start a new CLI instance
function startNewInstance() {
	try {
		console.log(`${colors.blue}▶️  Starting new CLI instance...${colors.reset}`)
		const result = execSync("./cli/bin/cline instance new", {
			cwd: projectRoot,
			stdio: "pipe",
			encoding: "utf-8",
		})
		console.log(`${colors.green}✓ CLI instance started${colors.reset}`)
		console.log(`${colors.dim}${result.trim()}${colors.reset}\n`)
	} catch (error) {
		console.error(`${colors.red}✗ Failed to start instance: ${error.message}${colors.reset}\n`)
	}
}

// Function to rebuild Go CLI
async function rebuildGo() {
	if (isBuilding) {
		return
	}

	isBuilding = true
	const startTime = Date.now()

	try {
		console.log(`${colors.cyan}🔨 Rebuilding Go CLI...${colors.reset}`)
		killAllInstances()

		// Just rebuild Go binaries (skip proto generation)
		execSync("cd cli && GO111MODULE=on go build -o bin/cline ./cmd/cline", {
			cwd: projectRoot,
			stdio: "inherit",
			shell: true,
		})
		execSync("cd cli && GO111MODULE=on go build -o bin/cline-host ./cmd/cline-host", {
			cwd: projectRoot,
			stdio: "inherit",
			shell: true,
		})

		startNewInstance()

		const duration = ((Date.now() - startTime) / 1000).toFixed(2)
		console.log(`${colors.green}✓ Go rebuild complete in ${duration}s${colors.reset}`)
		console.log(`${colors.dim}Watching for changes...${colors.reset}\n`)
	} catch (error) {
		console.error(`${colors.red}✗ Go build failed: ${error.message}${colors.reset}\n`)
	} finally {
		isBuilding = false
	}
}

// Function to regenerate protos and rebuild everything
async function rebuildProtos() {
	if (isBuilding) {
		return
	}

	isBuilding = true
	const startTime = Date.now()

	try {
		console.log(`${colors.cyan}🔨 Regenerating protos...${colors.reset}`)
		killAllInstances()

		// Regenerate protos
		execSync("npm run protos", { cwd: projectRoot, stdio: "inherit" })
		execSync("npm run protos-go", { cwd: projectRoot, stdio: "inherit" })

		// esbuild will auto-rebuild TS due to changed generated files
		// Rebuild Go CLI
		execSync("cd cli && GO111MODULE=on go build -o bin/cline ./cmd/cline", {
			cwd: projectRoot,
			stdio: "inherit",
			shell: true,
		})
		execSync("cd cli && GO111MODULE=on go build -o bin/cline-host ./cmd/cline-host", {
			cwd: projectRoot,
			stdio: "inherit",
			shell: true,
		})

		startNewInstance()

		const duration = ((Date.now() - startTime) / 1000).toFixed(2)
		console.log(`${colors.green}✓ Proto rebuild complete in ${duration}s${colors.reset}`)
		console.log(`${colors.dim}Watching for changes...${colors.reset}\n`)
	} catch (error) {
		console.error(`${colors.red}✗ Proto build failed: ${error.message}${colors.reset}\n`)
	} finally {
		isBuilding = false
	}
}

// Debounced rebuild trigger
function triggerGoRebuild(filepath) {
	if (debounceTimer) {
		clearTimeout(debounceTimer)
	}

	debounceTimer = setTimeout(() => {
		const relativePath = path.relative(projectRoot, filepath)
		console.log(`${colors.dim}Go file changed: ${relativePath}${colors.reset}`)
		rebuildGo()
	}, 300)
}

function triggerProtoRebuild(filepath) {
	if (debounceTimer) {
		clearTimeout(debounceTimer)
	}

	debounceTimer = setTimeout(() => {
		const relativePath = path.relative(projectRoot, filepath)
		console.log(`${colors.dim}Proto file changed: ${relativePath}${colors.reset}`)
		rebuildProtos()
	}, 300)
}

// Initial build
async function initialBuild() {
	try {
		// Run protos first
		console.log(`${colors.blue}📦 Generating protos...${colors.reset}`)
		execSync("npm run protos", { cwd: projectRoot, stdio: "inherit" })
		execSync("npm run protos-go", { cwd: projectRoot, stdio: "inherit" })

		// Build standalone (skip check-types and lint for speed)
		console.log(`${colors.blue}📦 Building standalone...${colors.reset}`)
		execSync("node esbuild.mjs --standalone", { cwd: projectRoot, stdio: "inherit" })

		// Build Go CLI
		console.log(`${colors.blue}🔧 Building Go CLI...${colors.reset}`)
		execSync("cd cli && GO111MODULE=on go build -o bin/cline ./cmd/cline", {
			cwd: projectRoot,
			stdio: "inherit",
			shell: true,
		})
		execSync("cd cli && GO111MODULE=on go build -o bin/cline-host ./cmd/cline-host", {
			cwd: projectRoot,
			stdio: "inherit",
			shell: true,
		})

		// Start CLI instance
		startNewInstance()

		console.log(`${colors.green}${colors.bright}✓ Initial build complete!${colors.reset}`)
		console.log(`${colors.cyan}Now watching for changes with fast incremental rebuilds...${colors.reset}\n`)

		initialBuildDone = true

		// Start esbuild in watch mode for TypeScript (incremental rebuilds)
		console.log(`${colors.dim}Starting esbuild watch mode...${colors.reset}`)
		esbuildProcess = spawn("node", ["esbuild.mjs", "--watch", "--standalone"], {
			cwd: projectRoot,
			stdio: ["inherit", "pipe", "inherit"], // Pipe stdout to parse it
		})

		// Parse esbuild output to detect when rebuild completes
		esbuildProcess.stdout.on("data", (data) => {
			const output = data.toString()
			// Forward esbuild output to console
			process.stdout.write(output)

			// Detect when esbuild finishes a rebuild
			if (output.includes("[watch] build finished") && initialBuildDone && !isBuilding) {
				console.log(`${colors.cyan}📦 TypeScript rebuilt by esbuild${colors.reset}`)
				killAllInstances()
				startNewInstance()
			}
		})

		esbuildProcess.on("error", (error) => {
			console.error(`${colors.red}esbuild error: ${error.message}${colors.reset}`)
		})
	} catch (error) {
		console.error(`${colors.red}✗ Initial build failed: ${error.message}${colors.reset}`)
		process.exit(1)
	}
}

// Watch Proto files (chokidar v4 - no glob support, watch directory and filter)
const protoWatcher = chokidar.watch("proto", {
	ignored: (filepath, stats) => {
		// Ignore if it's a file but not a .proto file
		return stats?.isFile() && !filepath.endsWith(".proto")
	},
	persistent: true,
	ignoreInitial: true,
	cwd: projectRoot,
	awaitWriteFinish: {
		stabilityThreshold: 100,
		pollInterval: 50,
	},
})

protoWatcher
	.on("change", (filepath) => {
		if (initialBuildDone) {
			console.log(`${colors.dim}[DEBUG] Proto change event: ${filepath}${colors.reset}`)
			triggerProtoRebuild(path.join(projectRoot, filepath))
		}
	})
	.on("add", (filepath) => {
		if (initialBuildDone) {
			console.log(`${colors.dim}[DEBUG] Proto add event: ${filepath}${colors.reset}`)
			triggerProtoRebuild(path.join(projectRoot, filepath))
		}
	})

// Watch Go files (chokidar v4 - no glob support, watch directory and filter)
const goWatcher = chokidar.watch("cli", {
	ignored: (filepath, stats) => {
		// Ignore node_modules and non-.go files
		if (filepath.includes("node_modules")) return true
		return stats?.isFile() && !filepath.endsWith(".go")
	},
	persistent: true,
	ignoreInitial: true,
	cwd: projectRoot,
	awaitWriteFinish: {
		stabilityThreshold: 100,
		pollInterval: 50,
	},
})

goWatcher
	.on("change", (filepath) => {
		if (initialBuildDone) {
			console.log(`${colors.dim}[DEBUG] Go change event: ${filepath}${colors.reset}`)
			triggerGoRebuild(path.join(projectRoot, filepath))
		}
	})
	.on("add", (filepath) => {
		if (initialBuildDone) {
			console.log(`${colors.dim}[DEBUG] Go add event: ${filepath}${colors.reset}`)
			triggerGoRebuild(path.join(projectRoot, filepath))
		}
	})

// Handle shutdown gracefully
process.on("SIGINT", () => {
	console.log(`\n${colors.yellow}Shutting down...${colors.reset}`)
	if (esbuildProcess) {
		esbuildProcess.kill()
	}
	killAllInstances()
	process.exit(0)
})

process.on("SIGTERM", () => {
	console.log(`\n${colors.yellow}Shutting down...${colors.reset}`)
	if (esbuildProcess) {
		esbuildProcess.kill()
	}
	killAllInstances()
	process.exit(0)
})

// Start
initialBuild()
