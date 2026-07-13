import { createRequire } from "node:module";
import path from "node:path";
import * as vscode from "vscode";
import {
	BUNDLE_OVERRIDE_ENV,
	type Bundle,
	COHORT_STATE_KEY,
	decideBundle,
	FAILED_VERSION_STATE_KEY,
	KILLSWITCH_STATE_KEY,
} from "./cohort";
import { refreshCohort, reportActivation } from "./rollout";
import { scopedContext } from "./scoped-context";

/**
 * Cline rollout loader.
 *
 * The VSIX ships two complete, independently built extension bundles:
 *   next/    — the SDK-based extension (built from main's apps/vscode)
 *   legacy/  — the pre-SDK extension (built from the legacy-extension branch)
 *
 * This entrypoint picks exactly one per window — from state cached by the
 * previous window's background flag refresh, never from a blocking network
 * call — activates it with a context whose install-root paths point into its
 * subdirectory, and delegates everything else to it. If the next bundle throws
 * during activation, the loader disposes whatever it half-registered, pins
 * this VSIX version back to legacy, and activates legacy instead.
 */

// Resolved at runtime relative to the installed VSIX root; must stay opaque to
// esbuild so the bundles aren't inlined into the loader.
const requireFromVsixRoot = createRequire(__filename);

interface BundleModule {
	activate(context: vscode.ExtensionContext): Promise<unknown> | unknown;
	deactivate?(): Promise<void> | void;
}

let activeBundle: { module: BundleModule; name: Bundle } | undefined;

export async function activate(context: vscode.ExtensionContext) {
	const loaderVersion: string =
		context.extension.packageJSON?.version ?? "unknown";
	const bundle = decideBundle({
		override: process.env[BUNDLE_OVERRIDE_ENV],
		cached: context.globalState.get<string>(COHORT_STATE_KEY),
		killswitch: context.globalState.get<boolean>(KILLSWITCH_STATE_KEY) === true,
		previousFailure:
			context.globalState.get<string>(FAILED_VERSION_STATE_KEY) ===
			loaderVersion,
	});

	return activateBundle(context, bundle, loaderVersion, true);
}

async function activateBundle(
	context: vscode.ExtensionContext,
	bundle: Bundle,
	loaderVersion: string,
	refreshAssignmentOnSuccess: boolean,
): Promise<unknown> {
	// Menus/keybindings gated per cohort in package.json key off this.
	await vscode.commands.executeCommand(
		"setContext",
		"cline.sdkBundle",
		bundle === "next",
	);

	const subscriptionsBefore = context.subscriptions.length;
	try {
		const module = requireFromVsixRoot(
			path.join(__dirname, bundle, "dist", "extension.js"),
		) as BundleModule;
		const api = await module.activate(scopedContext(context, bundle));
		activeBundle = { module, name: bundle };
		// Cache the next window's assignment only after the originally selected
		// bundle activates. A crash fallback must not start a refresh that could
		// promote the cohort back to next after the handler pins it to legacy.
		if (refreshAssignmentOnSuccess) {
			void refreshCohort(context).catch(() => {});
		}
		void reportActivation(context, bundle, { fallback: false }).catch(() => {});
		return api;
	} catch (error) {
		if (bundle === "legacy") {
			// Nothing left to fall back to; let VS Code surface the failure.
			throw error;
		}
		console.error(
			"[cline-rollout] next bundle failed to activate, falling back to legacy:",
			error,
		);
		disposeSubscriptionsAddedAfter(context, subscriptionsBefore);
		// Pin this VSIX version to legacy so we don't crash-loop every window.
		// A new release (new version string) gets to try next again.
		await context.globalState.update(FAILED_VERSION_STATE_KEY, loaderVersion);
		await context.globalState.update(COHORT_STATE_KEY, "legacy");
		void reportActivation(context, "legacy", {
			fallback: true,
			errorMessage:
				error instanceof Error
					? `${error.message}\n${error.stack ?? ""}`.slice(0, 2000)
					: String(error),
		}).catch(() => {});
		return activateBundle(context, "legacy", loaderVersion, false);
	}
}

/** Dispose anything a failed activation managed to register before it threw. */
function disposeSubscriptionsAddedAfter(
	context: vscode.ExtensionContext,
	startIndex: number,
) {
	const added = context.subscriptions.splice(startIndex);
	for (const disposable of added) {
		try {
			disposable.dispose();
		} catch {
			// best effort — a broken disposable must not block the fallback
		}
	}
}

export async function deactivate() {
	return activeBundle?.module.deactivate?.();
}
