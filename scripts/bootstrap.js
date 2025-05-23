#!/usr/bin/env node

const { spawnSync } = require("child_process")

// Check if we're already bootstrapping
if (process.env.BOOTSTRAP_IN_PROGRESS) {
	console.log("Bootstrap already in progress, continuing with normal installation...")
	process.exit(0)
}

// Check if we're running under pnpm
const isPnpm = process.env.npm_execpath && process.env.npm_execpath.includes("pnpm")

// If we're already using pnpm, just exit normally
if (isPnpm) {
	console.log("Already using pnpm, continuing with normal installation...")
	process.exit(0)
}

console.log("Bootstrapping to pnpm...")

try {
	// Check if pnpm is installed
	const pnpmCheck = spawnSync("command", ["-v", "pnpm"], { shell: true })

	let pnpmInstall

	if (pnpmCheck.status === 0) {
		// If pnpm is available, use it directly
		console.log("pnpm found, using it directly...")
		pnpmInstall = spawnSync("pnpm", ["install"], {
			stdio: "inherit",
			shell: true,
			env: {
				...process.env,
				BOOTSTRAP_IN_PROGRESS: "1", // Set environment variable to indicate bootstrapping
			},
		})
	} else {
		// If pnpm is not available, install it temporarily in the project
		console.log("pnpm not found, installing it temporarily...")

		// Create a temporary package.json if it doesn't exist
		const tempPkgJson = spawnSync(
			"node",
			[
				"-e",
				'if(!require("fs").existsSync("package.json")){require("fs").writeFileSync("package.json", JSON.stringify({name:"temp",private:true}))}',
			],
			{ shell: true },
		)

		// Install pnpm locally without saving it as a dependency
		const npmInstall = spawnSync("npm", ["install", "--no-save", "pnpm"], {
			stdio: "inherit",
			shell: true,
		})

		if (npmInstall.status !== 0) {
			console.error("Failed to install pnpm locally")
			process.exit(1)
		}

		// Use the locally installed pnpm
		console.log("Running pnpm install...")
		pnpmInstall = spawnSync("node_modules/.bin/pnpm", ["install"], {
			stdio: "inherit",
			shell: true,
			env: {
				...process.env,
				BOOTSTRAP_IN_PROGRESS: "1", // Set environment variable to indicate bootstrapping
			},
		})
	}

	if (pnpmInstall.status !== 0) {
		console.error("pnpm install failed")
		process.exit(pnpmInstall.status)
	}

	console.log("Bootstrap completed successfully")
	process.exit(0)
} catch (error) {
	console.error("Bootstrap failed:", error)
	process.exit(1)
}
