import { defineConfig } from "@vscode/test-cli"
import { createHash } from "crypto"
import os from "os"
import path from "path"

const vscodeTestVersion = process.env.VSCODE_TEST_VERSION ?? "stable"
const extensionDevelopmentPath = path.resolve("./")

// VS Code puts its IPC socket (e.g. `1.14-main.sock`) in the user data dir, and
// macOS caps unix socket paths at 103 chars. The default `.vscode-test/user-data`
// overflows that from deep checkouts such as worktrees (`listen EINVAL`), so on
// macOS use a short dir in the temp folder, keyed by checkout so concurrent runs
// from different worktrees don't hand off to each other's instance.
const launchArgs = ["--disable-extensions"]
if (process.platform === "darwin") {
	const checkoutHash = createHash("sha256").update(extensionDevelopmentPath).digest("hex").slice(0, 8)
	launchArgs.push(`--user-data-dir=${path.join(os.tmpdir(), `cline-vscode-test-${checkoutHash}`)}`)
}

export default defineConfig({
	files: [
		"out/src/{core,test,utils,shared,integrations,hosts,services}/**/*.test.js",
		"src/{core,test,utils,shared,integrations,hosts,services}/**/*.test.js",
		// The bun unit suite (src/**/__tests__/* and src/test/services/**) runs under
		// `bun test` (run-bun-unit-tests.ts) and imports `bun:test`, which this
		// Node-based runner cannot load. Exclude it here.
		"!out/src/**/__tests__/**/*.test.js",
		"!out/src/test/services/**/*.test.js",
		"!src/**/__tests__/**/*.test.js",
		"!src/test/services/**/*.test.js",
	],
	mocha: {
		ui: "bdd",
		timeout: 20000, // Maximum time (in ms) that a test can run before failing
		/** Set up alias path resolution during tests
		 * @See {@link file://./test-setup.js}
		 */
		require: ["./test-setup.js"],
	},
	workspaceFolder: "test-workspace",
	version: vscodeTestVersion,
	extensionDevelopmentPath,
	launchArgs,
})
