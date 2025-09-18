#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

const args = process.argv.slice(2)
const env = { ...process.env }

function resolveLocalBinary() {
	const { platform, arch } = process
	const candidates = [`${platform}-${arch}`]

	if (platform === "darwin" && arch === "arm64") {
		candidates.push("darwin-x64")
	}

	if (platform === "win32" && arch === "arm64") {
		candidates.push("win32-x64")
	}

	for (const suffix of candidates) {
		try {
			return require.resolve(`@biomejs/cli-${suffix}/biome`)
		} catch {
			// continue searching
		}
	}

	return null
}

function run(command, commandArgs) {
	const result = spawnSync(command, commandArgs, {
		stdio: "inherit",
		env,
	})

	if (result.error) {
		if (result.error.code === "ENOENT") {
			console.error(`Unable to execute '${command}': command not found.`)
		} else {
			console.error(result.error.message)
		}
		process.exit(1)
	}

	process.exitCode = result.status ?? 1
}

const localBinary = resolveLocalBinary()

if (localBinary) {
	run(localBinary, args)
	process.exit()
}

let biomeVersion = null

try {
	biomeVersion = require("@biomejs/biome/package.json").version
} catch {
	// keep biomeVersion as null
}

const cliSpecifier = biomeVersion ? `@biomejs/cli@${biomeVersion}` : "@biomejs/cli"

console.warn(
	`Biome binary for ${process.platform}/${process.arch} not found in local node_modules. Falling back to 'npx ${cliSpecifier}'.`,
)

run("npx", ["--yes", cliSpecifier, ...args])
