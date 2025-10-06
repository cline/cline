#!/usr/bin/env node
/**
 * Minimal migration script for E2E testing.
 * This runs only the migration logic without starting the full server.
 */

import { initializeContext, runLegacySecretsMigrationIfNeeded } from "../../../standalone/vscode-context"

async function main() {
	const clineDir = process.env.CLINE_DIR
	if (!clineDir) {
		console.error("CLINE_DIR environment variable not set")
		process.exit(1)
	}

	try {
		// Initialize context (sets up storage backends)
		initializeContext(clineDir)

		// Run migration
		await runLegacySecretsMigrationIfNeeded()

		console.log("MIGRATION_DONE")
		process.exit(0)
	} catch (error) {
		console.error("MIGRATION_FAILED", error)
		process.exit(1)
	}
}

main()
