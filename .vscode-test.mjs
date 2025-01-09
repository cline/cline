import { defineConfig } from "@vscode/test-cli"
import * as path from "path"
import * as os from "os"

export default defineConfig({
	files: "out/**/*.test.js",
	mocha: {
		timeout: 20000, // Maximum time (in ms) that a test can run before failing
	},
	// Use a shorter path in the temp directory for user data
	workspaceDir: path.join(os.tmpdir(), "cline-test-workspace"),
	userData: path.join(os.tmpdir(), "cline-test-data"),
})
