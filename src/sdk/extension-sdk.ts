/**
 * SDK Extension Entry Point
 *
 * Alternate entry point that uses the SDK adapter layer instead of
 * the classic Controller/Task/WebviewProvider stack.
 *
 * Activated by:
 *   CLINE_SDK=1 node esbuild.mjs  (build-time)
 *   or by setting `cline.useSdk: true` (runtime)
 *
 * This entry point:
 * 1. Reads legacy state from ~/.cline/data/
 * 2. Runs provider migration (one-time, idempotent)
 * 3. Creates an SdkController
 * 4. Exposes the gRPC handler for webview communication
 * 5. Provides the same activation/deactivation lifecycle as the
 *    classic extension.ts
 *
 * The webview is the SAME webview — it doesn't know the difference.
 * All communication goes through the gRPC compat layer.
 */

import { LegacyStateReader } from "./legacy-state-reader"
import { runProviderMigration } from "./provider-migration"
import { SdkController, type SdkControllerOptions } from "./SdkController"
import { buildExtensionState } from "./state-builder"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SdkExtensionContext {
	/** The SdkController instance */
	controller: SdkController

	/** The legacy state reader */
	legacyState: LegacyStateReader

	/** Whether provider migration was run */
	migrationResult?: { migrated: boolean; provider?: string }
}

export interface SdkExtensionOptions {
	/** Override data directory (default: ~/.cline/data) */
	dataDir?: string

	/** Extension version string */
	version?: string

	/** Working directory */
	cwd?: string

	/** Skip provider migration */
	skipMigration?: boolean

	/** Additional SdkController options */
	controllerOptions?: Partial<SdkControllerOptions>
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

/**
 * Activate the SDK-powered extension.
 *
 * This is the SDK equivalent of the classic `activate()` function
 * in extension.ts. It can be called from:
 * - A VSCode extension host (replacing the classic activation)
 * - A standalone Node.js process (for headless/CLI usage)
 * - Tests
 */
export async function activateSdkExtension(
	options: SdkExtensionOptions = {},
): Promise<SdkExtensionContext> {
	const version = options.version ?? "0.0.0"

	// 1. Read legacy state
	const legacyState = new LegacyStateReader({
		dataDir: options.dataDir,
	})

	// 2. Run provider migration (idempotent)
	let migrationResult: { migrated: boolean; provider?: string } | undefined
	if (!options.skipMigration) {
		try {
			const result = await runProviderMigration({
				legacyState,
			})
			migrationResult = {
				migrated: result.migrated,
				provider: result.sdkProvider,
			}
		} catch {
			// Migration failure is non-fatal — user can still configure manually
		}
	}

	// 3. Read task history from legacy state
	const taskHistory = legacyState.readTaskHistory()

	// 4. Read API configuration from legacy state
	const globalState = legacyState.readGlobalState()
	const apiConfiguration = globalState.apiConfiguration as
		| SdkControllerOptions["apiConfiguration"]
		| undefined

	// 5. Create SdkController
	const controller = new SdkController({
		version,
		apiConfiguration,
		mode: (globalState.mode as "act" | "plan") ?? "act",
		cwd: options.cwd ?? process.cwd(),
		taskHistory,
		legacyState,
		...options.controllerOptions,
	})

	return {
		controller,
		legacyState,
		migrationResult,
	}
}

/**
 * Deactivate the SDK extension.
 * Cleans up resources.
 */
export async function deactivateSdkExtension(
	context: SdkExtensionContext,
): Promise<void> {
	// Cancel any running task
	try {
		await context.controller.cancelTask()
	} catch {
		// Ignore — task may not be running
	}
}
