import archiver from "archiver"
import { execSync } from "child_process"
import fs from "fs"
import { cp } from "fs/promises"
import { glob } from "glob"
import ignore from "ignore"
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
	// Use the same ignore file that vscode uses when packaging the extension.
	const vscodeignore = ignore().add(fs.readFileSync(".vscodeignore", "utf8"))

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

	// Add the whole cline directory under "extension"
	archive.directory(process.cwd(), "extension", (entry) => {
		if (entry.name.startsWith(".git")) {
			return false
		}
		if (entry.name.endsWith(".DS_Store")) {
			return false
		}
		if (entry.name === "dist" || entry.name.startsWith("dist" + path.sep)) {
			// Don't include the vscode extension build dir.
			return false
		}
		if (vscodeignore.ignores(entry.name)) {
			// Exclude entries also ignored by the vscode packager.
			return false
		}
		return entry
	})

	console.log("Zipping package...")
	await archive.finalize()
}

/* cp -r */
async function cpr(source, dest) {
	await cp(source, dest, {
		recursive: true,
		preserveTimestamps: true,
		dereference: false, // preserve symlinks instead of following them
	})
}

await main()
