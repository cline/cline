import fs from "fs"
import path from "path"
import { glob } from "glob"
import archiver from "archiver"
import { cp } from "fs/promises"
import { execSync } from "child_process"

const BUILD_DIR = "dist-standalone"
const SOURCE_DIR = "standalone/runtime-files"

await cp(SOURCE_DIR, BUILD_DIR, { recursive: true })

// Run npm install in the distribution directory
console.log("Running npm install in distribution directory...")
const cwd = process.cwd()
process.chdir(BUILD_DIR)
try {
	execSync("npm install", { stdio: "inherit" })
	// Move the vscode directory into node_modules.
	// It can't be installed using npm because it will create a symlink which is not portable.
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
archive.glob("**/*", {
	cwd: BUILD_DIR,
	ignore: ["standalone.zip"],
})

// Add the whole cline directory under "extension"
archive.directory(process.cwd(), "extension", (entry) => {
	// Skip certain directories
	if (
		entry.name.startsWith(BUILD_DIR + "/") ||
		entry.name.startsWith("node_modules/") || // node_modules nearly 1GB.
		entry.name.startsWith("webview-ui/node_modules/") || // node_modules nearly 1GB.
		entry.name.match(/(^|\/)\./) // exclude dot directories
	) {
		return false
	}
	return entry
})

console.log("Zipping package...")
await archive.finalize()
