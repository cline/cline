#!/usr/bin/env node

/**
 * Download Node.js binaries for all target platforms
 * This script downloads official Node.js binaries from nodejs.org
 * and extracts them to dist-standalone/node-binaries/
 */

import fs from "fs"
import https from "https"
import path from "path"
import { pipeline } from "stream/promises"
import tar from "tar"
import { createGunzip } from "zlib"

const NODE_VERSION = "22.15.0"
const OUTPUT_DIR = "dist-standalone/node-binaries"

// Platform configurations
const PLATFORMS = [
	{
		name: "darwin-x64",
		nodeArch: "darwin-x64",
		url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-x64.tar.gz`,
	},
	{
		name: "darwin-arm64",
		nodeArch: "darwin-arm64",
		url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
	},
	{
		name: "linux-x64",
		nodeArch: "linux-x64",
		url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz`,
	},
]

/**
 * Download a file from a URL
 */
async function downloadFile(url, destPath) {
	return new Promise((resolve, reject) => {
		console.log(`  Downloading: ${url}`)
		const file = fs.createWriteStream(destPath)

		https
			.get(url, (response) => {
				if (response.statusCode === 302 || response.statusCode === 301) {
					// Handle redirect
					return downloadFile(response.headers.location, destPath).then(resolve).catch(reject)
				}

				if (response.statusCode !== 200) {
					reject(new Error(`Failed to download: ${response.statusCode} ${response.statusMessage}`))
					return
				}

				response.pipe(file)

				file.on("finish", () => {
					file.close()
					resolve()
				})
			})
			.on("error", (err) => {
				fs.unlink(destPath, () => {}) // Delete the file on error
				reject(err)
			})

		file.on("error", (err) => {
			fs.unlink(destPath, () => {}) // Delete the file on error
			reject(err)
		})
	})
}

/**
 * Extract a tar.gz file
 */
async function extractTarGz(tarPath, destDir) {
	console.log(`  Extracting to: ${destDir}`)

	return pipeline(
		fs.createReadStream(tarPath),
		createGunzip(),
		tar.extract({
			cwd: destDir,
			strip: 1, // Remove the top-level directory from the archive
		}),
	)
}

/**
 * Download and extract Node.js for a specific platform
 */
async function downloadNodeForPlatform(platform) {
	console.log(`\n📦 Processing ${platform.name}...`)

	const platformDir = path.join(OUTPUT_DIR, platform.name)
	const tarPath = path.join(OUTPUT_DIR, `node-${platform.name}.tar.gz`)

	// Create output directory
	fs.mkdirSync(platformDir, { recursive: true })

	try {
		// Download
		await downloadFile(platform.url, tarPath)
		console.log(`  ✓ Downloaded`)

		// Extract
		await extractTarGz(tarPath, platformDir)
		console.log(`  ✓ Extracted`)

		// Verify the binary exists
		const binaryPath = path.join(platformDir, "bin", "node")
		if (!fs.existsSync(binaryPath)) {
			throw new Error(`Binary not found at ${binaryPath}`)
		}

		// Make binary executable
		fs.chmodSync(binaryPath, 0o755)
		console.log(`  ✓ Binary ready: ${binaryPath}`)

		// Clean up tar file
		fs.unlinkSync(tarPath)
		console.log(`  ✓ Cleaned up`)

		return true
	} catch (error) {
		console.error(`  ✗ Failed: ${error.message}`)
		throw error
	}
}

/**
 * Main function
 */
async function main() {
	console.log("🚀 Node.js Binary Downloader")
	console.log(`   Version: ${NODE_VERSION}`)
	console.log(`   Output: ${OUTPUT_DIR}`)

	// Create output directory
	fs.mkdirSync(OUTPUT_DIR, { recursive: true })

	// Download for all platforms
	const results = []
	for (const platform of PLATFORMS) {
		try {
			await downloadNodeForPlatform(platform)
			results.push({ platform: platform.name, success: true })
		} catch (error) {
			results.push({ platform: platform.name, success: false, error: error.message })
		}
	}

	// Print summary
	console.log("\n" + "=".repeat(50))
	console.log("📊 Summary:")
	console.log("=".repeat(50))

	let successCount = 0
	for (const result of results) {
		const status = result.success ? "✅" : "❌"
		console.log(`${status} ${result.platform}`)
		if (result.success) {
			successCount++
		} else {
			console.log(`   Error: ${result.error}`)
		}
	}

	console.log("=".repeat(50))
	console.log(`✓ ${successCount}/${PLATFORMS.length} platforms successful`)

	if (successCount < PLATFORMS.length) {
		process.exit(1)
	}

	console.log("\n✅ All Node.js binaries downloaded successfully!")
}

// Run the script
main().catch((error) => {
	console.error("\n❌ Fatal error:", error)
	process.exit(1)
})
