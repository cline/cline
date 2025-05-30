import { runMigrations as runApiConfigMigrations } from "./api-configuration-migration"
import * as vscode from "vscode"

/**
 * Runs all migrations required for the extension
 * This includes migrations for:
 * - API configurations (flat to nested structure)
 * - Any future migrations can be added here
 *
 * @param context VSCode extension context
 * @param forceRun Force migrations to run regardless of schema version (useful for testing)
 * @returns Promise that resolves when all migrations are complete
 */
export async function runAllMigrations(context: vscode.ExtensionContext, forceRun: boolean = false): Promise<void> {
	try {
		console.log("[Migrations] Starting all migrations")

		// Run API configuration migrations
		await runApiConfigMigrations(context, forceRun)

		// Future migrations would be added here

		console.log("[Migrations] All migrations completed successfully")
	} catch (error) {
		console.error("[Migrations] Error running migrations:", error)
		// Don't rethrow to prevent extension activation failure
	}
}
