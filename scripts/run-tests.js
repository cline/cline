// run-tests.js
const { execSync } = require("child_process")

if (process.platform === "win32") {
	execSync("npm-run-all test:* lint:*", { stdio: "inherit" })
} else {
	execSync("npm-run-all -p test:* lint:*", { stdio: "inherit" })
}
