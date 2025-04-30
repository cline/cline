// run-tests.js
const { execSync } = require("child_process")

if (process.platform === "win32") {
	execSync("npm-run-all test:*", { stdio: "inherit" })
} else {
	execSync("npm-run-all -p test:*", { stdio: "inherit" })
}
