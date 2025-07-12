#!/usr/bin/env node

// Complete Cline Standalone + Electron Runner
// This script builds the standalone version and starts the Electron app

const fs = require("fs")
const path = require("path")
const { spawn, exec } = require("child_process")

const SCRIPT_DIR = __dirname
const DIST_DIR = path.join(SCRIPT_DIR, "dist-standalone")
const WEBVIEW_BUILD_DIR = path.join(SCRIPT_DIR, "webview-ui", "build")
const ELECTRON_MAIN = path.join(SCRIPT_DIR, "cline-electron", "main.js")

console.log("🤖 Cline Standalone + Electron Runner")
console.log("======================================")
console.log(`📁 Working directory: ${SCRIPT_DIR}`)
console.log("")

// Check if required files exist
function checkRequiredFiles() {
	console.log("🔍 Checking required files...")

	if (!fs.existsSync(path.join(DIST_DIR, "standalone.js"))) {
		console.log("❌ Standalone not built. Building now...")
		return false
	}

	if (!fs.existsSync(WEBVIEW_BUILD_DIR)) {
		console.log("❌ Webview not built. Building now...")
		return false
	}

	if (!fs.existsSync(ELECTRON_MAIN)) {
		console.log("❌ Electron main file not found")
		process.exit(1)
	}

	console.log("✅ All required files found")
	return true
}

// Build the standalone version
function buildStandalone() {
	return new Promise((resolve, reject) => {
		console.log("🔨 Building standalone version...")

		const buildProcess = spawn("npm", ["run", "compile-standalone"], {
			cwd: SCRIPT_DIR,
			stdio: "inherit",
		})

		buildProcess.on("exit", (code) => {
			if (code === 0) {
				console.log("✅ Standalone build completed")
				resolve()
			} else {
				console.error("❌ Standalone build failed")
				reject(new Error(`Build failed with code ${code}`))
			}
		})
	})
}

// Install Electron if needed
function installElectron() {
	return new Promise((resolve, reject) => {
		console.log("📦 Installing Electron...")

		// Check if electron is already installed
		exec("npx electron --version", (error) => {
			if (!error) {
				console.log("✅ Electron already installed")
				resolve()
				return
			}

			const installProcess = spawn("npm", ["install", "electron@^23.3.13"], {
				cwd: SCRIPT_DIR,
				stdio: "inherit",
			})

			installProcess.on("exit", (code) => {
				if (code === 0) {
					console.log("✅ Electron installed")
					resolve()
				} else {
					console.error("❌ Electron installation failed")
					reject(new Error(`Install failed with code ${code}`))
				}
			})
		})
	})
}

// Start the Electron app
function startElectron() {
	console.log("🚀 Starting Electron app...")
	console.log("💾 Settings dir: ~/.cline/data")
	console.log("🌐 Server: http://127.0.0.1:50051")
	console.log("🔄 Press Ctrl+C to stop")
	console.log("")

	const electronProcess = spawn("npx", ["electron", ELECTRON_MAIN], {
		cwd: SCRIPT_DIR,
		stdio: "inherit",
		env: { ...process.env, NODE_ENV: "development" },
	})

	electronProcess.on("exit", (code) => {
		console.log(`\n🛑 Electron app exited with code ${code}`)
		process.exit(code)
	})

	// Handle Ctrl+C
	process.on("SIGINT", () => {
		console.log("\n🛑 Stopping Electron app...")
		electronProcess.kill("SIGINT")
	})

	process.on("SIGTERM", () => {
		console.log("\n🛑 Stopping Electron app...")
		electronProcess.kill("SIGTERM")
	})
}

// Main execution
async function main() {
	try {
		const filesExist = checkRequiredFiles()

		if (!filesExist) {
			await buildStandalone()
		}

		await installElectron()
		startElectron()
	} catch (error) {
		console.error("❌ Error:", error.message)
		process.exit(1)
	}
}

main()
