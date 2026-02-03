#!/usr/bin/env node

import { execSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const CLI_DIR = join(__dirname, "..")
const FORMULA_PATH = join(CLI_DIR, "cline.rb")

interface PackageJson {
	version: string
}

async function getLocalVersion(): Promise<string> {
	const packageJson = JSON.parse(await readFile(join(CLI_DIR, "package.json"), "utf-8")) as PackageJson
	return packageJson.version
}

async function packAndGetSHA256(version: string): Promise<string> {
	console.log("Packing local package...")
	execSync("npm run package", { cwd: CLI_DIR, stdio: "inherit" })

	const tarballPath = join(CLI_DIR, "dist", `cline-cli-${version}.tgz`)
	console.log(`Computing SHA256 for ${tarballPath}...`)

	const buffer = await readFile(tarballPath)
	const sha256 = createHash("sha256").update(buffer).digest("hex")

	// Clean up the tarball
	await unlink(tarballPath)

	return sha256
}

async function updateFormula(version: string, sha256: string) {
	console.log("Updating Homebrew formula...")

	let formula = await readFile(FORMULA_PATH, "utf-8")

	const tarballUrl = `https://registry.npmjs.org/cline/-/cline-${version}.tgz`

	// Update URL - matches pattern like: url "https://registry.npmjs.org/cline/-/cline-1.0.10.tgz"
	formula = formula.replace(/url "https:\/\/registry\.npmjs\.org\/cline\/-\/cline-[\d.]+\.tgz"/, `url "${tarballUrl}"`)

	// Update SHA256
	formula = formula.replace(/sha256 "[a-f0-9]+"/, `sha256 "${sha256}"`)

	await writeFile(FORMULA_PATH, formula, "utf-8")
}

async function main() {
	try {
		const version = await getLocalVersion()
		console.log(`\nLocal version: ${version}`)

		const sha256 = await packAndGetSHA256(version)
		console.log(`SHA256: ${sha256}`)

		const tarballUrl = `https://registry.npmjs.org/cline/-/cline-${version}.tgz`
		console.log(`Tarball URL: ${tarballUrl}`)

		await updateFormula(version, sha256)

		console.log("\n✓ Homebrew formula updated successfully!")
		console.log("\nNext steps:")
		console.log("1. Review the changes in cline.rb")
		console.log("2. Test locally: brew install --build-from-source ./cline.rb")
		console.log("3. Commit and push to your homebrew tap repository")
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		console.error(`\n✗ Error: ${errorMessage}\n`)
		process.exit(1)
	}
}

main()
