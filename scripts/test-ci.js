#!/usr/bin/env node
const { execSync } = require("child_process")
const process = require("process")

try {
	if (process.platform === "linux") {
		execSync("which xvfb-run", { stdio: "ignore" })

		execSync("xvfb-run -a npm run test:coverage", { stdio: "inherit" })
	} else {
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
