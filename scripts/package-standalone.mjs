import fs from "fs"
import path from "path"
import { glob } from "glob"
import archiver from "archiver"
import { cp } from "fs/promises"

const BUILD_DIR = "dist-standalone"
const SOURCE_DIR = "standalone/runtime-files"

await cp(SOURCE_DIR, BUILD_DIR, { recursive: true })

// Check for native .node modules.
const nativeModules = await glob("**/*.node", { cwd: BUILD_DIR, nodir: true })
if (nativeModules.length > 0) {
	console.error("Native node modules cannot be included in the standalone distribution:\n", nativeModules.join("\n"))
	process.exit(1)
}

// Zip the build directory (excluding any pre-existing output zip).
const zipPath = path.join(BUILD_DIR, "standalone.zip")
const output = fs.createWriteStream(zipPath)
const archive = archiver("zip", { zlib: { level: 9 } })

output.on("close", () => {
	console.log(`Created ${zipPath} (${archive.pointer()} bytes)`)
})

archive.on("error", (err) => {
	throw err
})

archive.pipe(output)
archive.glob("**/*", {
	cwd: BUILD_DIR,
	ignore: ["standalone.zip"],
})
await archive.finalize()
