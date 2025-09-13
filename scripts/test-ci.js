#!/usr/bin/env node
const { execSync } = require("child_process")
const process = require("process")

try {
	if (process.platform === "linux") {
		console.log("Detected Linux environment.")

		execSync("which xvfb-run", { stdio: "ignore" })

		console.log("xvfb-run is installed. Running tests with xvfb-run...")
		execSync("xvfb-run -a npm run test:coverage", { stdio: "inherit" })
	} else {
		console.log("Non-Linux environment detected. Running tests normally.")
		execSync("npm run test:integration", { stdio: "inherit" })
	}
} catch (error) {
	if (process.platform === "linux") {
		console.error(
			`Error: xvfb-run is not installed.\n` +
				`Please install it using the following command:\n` +
				`  Debian/Ubuntu: sudo apt install xvfb\n` +
				`  RHEL/CentOS: sudo yum install xvfb\n` +
				`  Arch Linux: sudo pacman -S xvfb`,
		)
	} else {
		console.error("Error running tests:", error.message)
	}
	process.exit(1)
}
