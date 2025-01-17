// Mock default shell based on platform
const os = require("os")

let defaultShell
if (os.platform() === "win32") {
	defaultShell = "cmd.exe"
} else {
	defaultShell = "/bin/bash"
}

module.exports = defaultShell
module.exports.default = defaultShell
