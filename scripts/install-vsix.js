const { execSync } = require("child_process")
const fs = require("fs")
const readline = require("readline")

// detect "yes" flags
const autoYes = process.argv.includes("-y")

// detect editor command from args or default to "code"
const editorArg = process.argv.find((arg) => arg.startsWith("--editor="))
const defaultEditor = editorArg ? editorArg.split("=")[1] : "code"

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
})

const askQuestion = (question) => {
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			resolve(answer)
		})
	})
}

async function main() {
	try {
		const packageJson = JSON.parse(fs.readFileSync("./src/package.json", "utf-8"))
		const name = packageJson.name
		const version = packageJson.version
		const vsixFileName = `./bin/${name}-${version}.vsix`
		const publisher = packageJson.publisher
		const extensionId = `${publisher}.${name}`

		console.log("\n🚀 Roo Code VSIX Installer")
		console.log("========================")
		console.log("\nThis script will:")
		console.log("1. Uninstall any existing version of the Roo Code extension")
		console.log("2. Install the newly built VSIX package")
		console.log(`\nExtension: ${extensionId}`)
		console.log(`VSIX file: ${vsixFileName}`)

		// Ask for editor command if not provided
		let editorCommand = defaultEditor
		if (!editorArg && !autoYes) {
			const editorAnswer = await askQuestion(
				"\nWhich editor command to use? (code/cursor/code-insiders) [default: code]: ",
			)
			if (editorAnswer.trim()) {
				editorCommand = editorAnswer.trim()
			}
		}

		// skip prompt if auto-yes
		const answer = autoYes ? "y" : await askQuestion("\nDo you wish to continue? (y/n): ")

		if (answer.toLowerCase() !== "y") {
			console.log("Installation cancelled.")
			rl.close()
			process.exit(0)
		}

		console.log(`\nProceeding with installation using '${editorCommand}' command...`)

		try {
			execSync(`${editorCommand} --uninstall-extension ${extensionId}`, { stdio: "inherit" })
		} catch (e) {
			console.log("Extension not installed, skipping uninstall step")
		}

		if (!fs.existsSync(vsixFileName)) {
			console.error(`\n❌ VSIX file not found: ${vsixFileName}`)
			console.error("Make sure the build completed successfully")
			rl.close()
			process.exit(1)
		}

		execSync(`${editorCommand} --install-extension ${vsixFileName}`, { stdio: "inherit" })

		console.log(`\n✅ Successfully installed extension from ${vsixFileName}`)
		console.log("\n⚠️  IMPORTANT: You need to restart VS Code for the changes to take effect.")
		console.log("   Please close and reopen VS Code to use the updated extension.\n")

		rl.close()
	} catch (error) {
		console.error("\n❌ Failed to install extension:", error.message)
		rl.close()
		process.exit(1)
	}
}

main()
