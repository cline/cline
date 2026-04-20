import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)
const { pack } = require("@vscode/vsce/out/package")

const cwd = process.cwd()

function parseArgs(argv) {
	let out

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === "--out" || arg === "-o") {
			out = argv[i + 1]
			i++
		}
	}

	return {
		out: out ?? "dist/cline.vsix",
	}
}

function run(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			stdio: "inherit",
			shell: false,
			...options,
		})

		child.on("error", reject)
		child.on("exit", (code) => {
			if (code === 0) {
				resolve()
			} else {
				reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`))
			}
		})
	})
}

async function main() {
	const { out } = parseArgs(process.argv.slice(2))
	const packagePath = path.resolve(cwd, out)

	await fs.mkdir(path.dirname(packagePath), { recursive: true })

	console.log("[package:vsix] Generating protobuf outputs...")
	await run("npm", ["run", "protos"])

	console.log("[package:vsix] Building webview bundle...")
	await run("npx", ["vite", "build"], { cwd: path.join(cwd, "webview-ui") })

	console.log("[package:vsix] Building extension bundle...")
	await run("node", ["esbuild.mjs", "--production"])

	console.log("[package:vsix] Packing VSIX...")
	const result = await pack({
		cwd,
		packagePath,
		useYarn: false,
		dependencies: false,
		allowPackageSecrets: ["sendgrid"],
	})

	console.log(`[package:vsix] VSIX created at ${result.packagePath}`)
	console.log(`[package:vsix] Packaged ${result.files.length} files`)
}

main().catch((error) => {
	console.error("[package:vsix] Failed:", error)
	process.exit(1)
})
