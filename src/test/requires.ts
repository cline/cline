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
	// Avoid pulling in VSCode-integrated checkpoint/editor code during unit tests
	if (path === "@integrations/checkpoints") {
		return {}
	}
	if (path === "@integrations/checkpoints/MultiRootCheckpointManager") {
		return { MultiRootCheckpointManager: class {} }
	}
	// unicorn-magic is a pure-ESM package with no CJS exports. tsx/cjs converts
	// ESM node_modules to CJS, so require('unicorn-magic') fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
	// Provide a stub so the execa dependency chain doesn't break in tests.
	if (path === "unicorn-magic") {
		return {
			toPath: (input: unknown) => (typeof input === "string" ? input : String(input)),
			traversePathUp: (_path: string) => [],
			delay: (_duration: unknown) => Promise.resolve(),
		}
	}

	return originalRequire.call(this, path)
}

// Required to have access to String.prototype.toPosix
import "../utils/path"
