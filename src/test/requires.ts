const Module = require("module")
const originalRequire = Module.prototype.require

/**
 * VSCode is not available during unit tests
 * @see {@link file://./vscode-mock.ts}
 */
Module.prototype.require = function (path: string) {
	if (path === "vscode") {
		return require("./vscode-mock")
	}

	return originalRequire.call(this, path)
}

// Required to have access to String.prototype.toPosix
import "../utils/path"
