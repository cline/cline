#!/usr/bin/env node

/**
 * Copy webview assets to Electron app directory
 *
 * This script is needed because the Electron app uses pre-built webview assets
 * from the cline-electron/assets directory. When we make changes to the webview
 * source code and rebuild it, we need to copy the new assets to the Electron
 * app directory so they are used when the app starts.
 *
 * Usage: node scripts/copy-webview-assets.js
 */

const fs = require("fs")
const path = require("path")

const webviewBuildDir = path.join(__dirname, "..", "webview-ui", "build")
const electronAssetsDir = path.join(__dirname, "..", "cline-electron", "assets")

function copyRecursive(src, dest) {
	const stat = fs.statSync(src)
	if (stat.isDirectory()) {
		if (!fs.existsSync(dest)) {
			fs.mkdirSync(dest, { recursive: true })
		}
		const entries = fs.readdirSync(src)
		for (const entry of entries) {
			copyRecursive(path.join(src, entry), path.join(dest, entry))
		}
	} else {
		fs.copyFileSync(src, dest)
	}
}

function main() {
	console.log("Copying webview assets to Electron app directory...")

	// Check if webview build directory exists
	if (!fs.existsSync(webviewBuildDir)) {
		console.error("Error: webview-ui/build directory not found.")
		console.error('Please run "npm run build:webview" first to build the webview assets.')
		process.exit(1)
	}

	// Ensure the electron assets directory exists
	if (!fs.existsSync(electronAssetsDir)) {
		fs.mkdirSync(electronAssetsDir, { recursive: true })
	}

	// Copy files from webview-ui/build/assets to cline-electron/assets
	// The webview build creates assets in a subdirectory, but Electron expects them directly in assets/
	const webviewAssetsDir = path.join(webviewBuildDir, "assets")
	if (fs.existsSync(webviewAssetsDir)) {
		copyRecursive(webviewAssetsDir, electronAssetsDir)
	}

	// Also copy other files from the build root (like index.html, codicon files)
	const buildFiles = fs.readdirSync(webviewBuildDir)
	for (const file of buildFiles) {
		const srcPath = path.join(webviewBuildDir, file)
		const destPath = path.join(electronAssetsDir, file)
		const stat = fs.statSync(srcPath)
		if (stat.isFile()) {
			if (file === "index.html") {
				// Fix asset paths in HTML for Electron (remove ./assets/ prefix since all files are in same directory)
				let htmlContent = fs.readFileSync(srcPath, "utf8")
				htmlContent = htmlContent.replace(/\.\/assets\//g, "./")

				// Add codicon.css link if it exists
				const codiconPath = path.join(electronAssetsDir, "codicon.css")
				if (fs.existsSync(codiconPath)) {
					// Insert codicon.css link before closing </head>
					htmlContent = htmlContent.replace("</head>", '\t\t<link rel="stylesheet" href="./codicon.css">\n\t</head>')
				}

				fs.writeFileSync(destPath, htmlContent, "utf8")
			} else {
				fs.copyFileSync(srcPath, destPath)
			}
		}
	}

	console.log("✓ Successfully copied webview assets to Electron app directory")
	console.log(`  From: ${webviewBuildDir}`)
	console.log(`  To: ${electronAssetsDir}`)
}

main()
