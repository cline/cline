#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)

const args = process.argv.slice(2)
const env = { ...process.env }

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const esbuildPackageName = "esbuild"

let installAttempted = false

function getEsbuildRoot() {
	return path.dirname(require.resolve(`${esbuildPackageName}/package.json`))
}

function resolveBinaryForSuffix(suffix) {
	const isWindows = suffix.startsWith("win32")
	const subpath = isWindows ? "esbuild.exe" : "bin/esbuild"
	const pkgName = `@esbuild/${suffix}`

	try {
		return require.resolve(`${pkgName}/${subpath}`)
	} catch {
		const libDir = path.join(getEsbuildRoot(), "lib")
		const downloadedName = isWindows
			? `downloaded-${pkgName.replace("/", "-")}-esbuild.exe`
			: `downloaded-${pkgName.replace("/", "-")}-esbuild`
		const downloadedPath = path.join(libDir, downloadedName)
		if (fs.existsSync(downloadedPath)) {
			return downloadedPath
		}
	}

	return null
}

function runInstallScript() {
	const installScript = require.resolve("esbuild/install.js")
	installAttempted = true

	return spawnSync(process.execPath, [installScript], {
		stdio: "inherit",
		env,
	})
}

function ensureBinaryForSuffix(suffix) {
	let binaryPath = resolveBinaryForSuffix(suffix)

	if (binaryPath) {
		return binaryPath
	}

	if (!installAttempted) {
		const result = runInstallScript()
		binaryPath = resolveBinaryForSuffix(suffix)
		if (binaryPath) {
			return binaryPath
		}

		if (result.error) {
			console.error(result.error.message)
		}

		if (typeof result.status === "number" && result.status !== 0) {
			console.error(`esbuild install script exited with code ${result.status}.`)
		}
	}

	return null
}

const primarySuffix = `${process.platform}-${os.arch()}`

const fallbackSuffixes = {
	"darwin-arm64": ["darwin-x64"],
	"win32-arm64": ["win32-x64"],
}

let binaryPath = ensureBinaryForSuffix(primarySuffix)

if (!binaryPath) {
	for (const fallback of fallbackSuffixes[primarySuffix] ?? []) {
		const resolved = ensureBinaryForSuffix(fallback)
		if (resolved) {
			binaryPath = resolved
			break
		}
	}
}

if (!binaryPath) {
	console.error(
		`Unable to locate an esbuild binary for ${primarySuffix}. Try reinstalling dependencies without Rosetta or run "npm install" again.`,
	)
	process.exit(1)
}

env.ESBUILD_BINARY_PATH = binaryPath

const esbuildScript = path.resolve(__dirname, "..", "esbuild.mjs")

const result = spawnSync(process.execPath, [esbuildScript, ...args], {
	stdio: "inherit",
	env,
})

if (result.error) {
	if (result.error.code === "ENOENT") {
		console.error("Failed to execute Node.js while running esbuild script.")
	} else {
		console.error(result.error.message)
	}
	process.exit(1)
}

process.exit(result.status ?? 1)
