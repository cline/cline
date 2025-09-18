#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"

const require = createRequire(import.meta.url)

const args = process.argv.slice(2)
const env = { ...process.env }

const BUF_PKG_NAME = "@bufbuild/buf"

const unixlikePackages = Object.freeze({
	"darwin arm64": "@bufbuild/buf-darwin-arm64",
	"darwin x64": "@bufbuild/buf-darwin-x64",
	"linux arm64": "@bufbuild/buf-linux-aarch64",
	"linux arm": "@bufbuild/buf-linux-armv7",
	"linux x64": "@bufbuild/buf-linux-x64",
})

const windowsPackages = Object.freeze({
	"win32 arm64": "@bufbuild/buf-win32-arm64",
	"win32 x64": "@bufbuild/buf-win32-x64",
})

function getPrimaryPackage(platform, arch) {
	if (platform === "win32") {
		return windowsPackages[`${platform} ${arch}`]
	}

	if (platform === "linux" && arch === "arm") {
		return unixlikePackages[`${platform} arm`]
	}

	return unixlikePackages[`${platform} ${arch}`]
}

function getFallbackPackages(platform, arch) {
	if (platform === "darwin" && arch === "arm64") {
		return [unixlikePackages["darwin x64"]]
	}

	if (platform === "win32" && arch === "arm64") {
		return [windowsPackages["win32 x64"]]
	}

	return []
}

function getBufRootDir() {
	return path.dirname(require.resolve(`${BUF_PKG_NAME}/package.json`))
}

function downloadedBinaryPath(pkg, binName) {
	return path.join(getBufRootDir(), `downloaded-${pkg.replace("/", "-")}-${binName}`)
}

function resolveBinary(pkg, binName) {
	if (!pkg) {
		return null
	}

	const subpath = pkg.startsWith("@bufbuild/buf-win32") ? `bin/${binName}.exe` : `bin/${binName}`

	try {
		return require.resolve(`${pkg}/${subpath}`)
	} catch {
		const downloaded = downloadedBinaryPath(pkg, binName)
		if (fs.existsSync(downloaded)) {
			return downloaded
		}
		return null
	}
}

function run(command, commandArgs, options = {}) {
	const result = spawnSync(command, commandArgs, {
		stdio: "inherit",
		env,
		...options,
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
	return result.status ?? 1
}

function ensureBinary(pkg, binName) {
	const binPath = resolveBinary(pkg, binName)
	if (binPath) {
		return binPath
	}

	const installScript = require.resolve(`${BUF_PKG_NAME}/install.js`)

	const installResult = spawnSync(process.execPath, [installScript], {
		stdio: "inherit",
		env,
	})

	if (installResult.error || installResult.status) {
		if (installResult.error) {
			console.error(installResult.error.message)
		}
		if (typeof installResult.status === "number" && installResult.status !== 0) {
			console.error(`Buf install script exited with code ${installResult.status}.`)
		}
	}

	return resolveBinary(pkg, binName)
}

function findBufBinary() {
	const platform = process.platform
	const arch = os.arch()
	const binName = platform === "win32" ? "buf.exe" : "buf"

	const primaryPackage = getPrimaryPackage(platform, arch)
	const fallbackPackages = getFallbackPackages(platform, arch)

	const primaryBinary = ensureBinary(primaryPackage, binName)
	if (primaryBinary) {
		return primaryBinary
	}

	for (const fallbackPackage of fallbackPackages) {
		const fallbackBinary = ensureBinary(fallbackPackage, binName)
		if (fallbackBinary) {
			return fallbackBinary
		}
	}

	return null
}

const binaryPath = findBufBinary()

if (binaryPath) {
	run(binaryPath, args)
	process.exit()
}

let bufVersion = null

try {
	bufVersion = require(`${BUF_PKG_NAME}/package.json`).version
} catch {
	// keep version null
}

const cliSpecifier = bufVersion ? `@bufbuild/buf@${bufVersion}` : "@bufbuild/buf"

console.warn(
	`Buf binary for ${process.platform}/${os.arch()} not found in local node_modules. Falling back to 'npx ${cliSpecifier}'.`,
)

run("npx", ["--yes", cliSpecifier, ...args])
