import { createRequire } from "node:module";
import path from "node:path";
import * as vscode from "vscode";
import {
	BUNDLE_OVERRIDE_ENV,
	type Bundle,
	bundleContextKey,
	COHORT_STATE_KEY,
	decideBundle,
	decisionOverrideSource,
	FAILED_VERSION_STATE_KEY,
	type IdPrefix,
	idPrefix,
	LAST_ACTIVATION_STATE_KEY,
	SETTING_BUNDLE_OVERRIDE,
	settingSection,
} from "./cohort";
import { refreshCohort, reportLoaderDecision } from "./rollout";
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
	/**
	 * Exported by both bundles' entrypoints (see rollout-metadata.ts on each
	 * branch): captures the AUTHORITATIVE `extension.rollout.bundle_activated`
	 * event through the bundle's own variant-attributed telemetry pipeline.
	 * Optional so the loader keeps working against a bundle built before the
	 * export existed.
	 */
	reportRolloutActivation?(input: {
		attemptedBundle: Bundle;
		actualBundle: Bundle;
		fallback: boolean;
		error?: unknown;
	}): Promise<void>;
}

let activeBundle: { module: BundleModule; name: Bundle } | undefined;

interface ActivationMeta {
	msSinceLastActivation?: number;
	override?: "env" | "setting";
}

/** Set when the original decision crashed and this activation is the fallback. */
interface FallbackFrom {
	attempted: Bundle;
	error: unknown;
}

export async function activate(context: vscode.ExtensionContext) {
	const loaderVersion: string =
		context.extension.packageJSON?.version ?? "unknown";
	const prefix = idPrefix(context.extension.packageJSON?.name);

	// Launch-cadence telemetry: how stale the previous activation is bounds how
	// fast a percentage change can actually reach users' windows.
	const lastActivationAt = context.globalState.get<number>(
		LAST_ACTIVATION_STATE_KEY,
	);
	const now = Date.now();
	void context.globalState.update(LAST_ACTIVATION_STATE_KEY, now);

	const overrides = {
		envOverride: process.env[BUNDLE_OVERRIDE_ENV],
		settingOverride: vscode.workspace
			.getConfiguration(settingSection(prefix))
			.get<string>(SETTING_BUNDLE_OVERRIDE),
	};
	const bundle = decideBundle({
		...overrides,
		cached: context.globalState.get<string>(COHORT_STATE_KEY),
		previousFailure:
			context.globalState.get<string>(FAILED_VERSION_STATE_KEY) ===
			loaderVersion,
	});
	const meta: ActivationMeta = {
		msSinceLastActivation:
			typeof lastActivationAt === "number" && lastActivationAt <= now
				? now - lastActivationAt
				: undefined,
		override: decisionOverrideSource(overrides),
	};

	return activateBundle(context, prefix, bundle, loaderVersion, meta, true);
}

async function activateBundle(
	context: vscode.ExtensionContext,
	prefix: IdPrefix,
	bundle: Bundle,
	loaderVersion: string,
	meta: ActivationMeta,
	refreshAssignmentOnSuccess: boolean,
	fallbackFrom?: FallbackFrom,
): Promise<unknown> {
	// Menus/keybindings gated per cohort in package.json key off this.
	await vscode.commands.executeCommand(
		"setContext",
		bundleContextKey(prefix),
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
		// Authoritative activation event, captured by the bundle's own telemetry
		// (built with CLINE_ROLLOUT_VARIANT). On fallback this runs in the legacy
		// bundle — next's pipeline is the thing that just crashed.
		if (typeof module.reportRolloutActivation === "function") {
			void module
				.reportRolloutActivation({
					attemptedBundle: fallbackFrom?.attempted ?? bundle,
					actualBundle: bundle,
					fallback: fallbackFrom !== undefined,
					error: fallbackFrom?.error,
				})
				.catch(() => {});
		}
		// The loader's own decision event fires once per window: the fallback
		// path already reported (fallback: true) from the catch block below.
		if (!fallbackFrom) {
			void reportLoaderDecision(context, bundle, {
				...meta,
				fallback: false,
			}).catch(() => {});
		}
		showNightlyBundleIndicator(context, prefix, bundle, meta, fallbackFrom);
		return api;
	} catch (error) {
		if (bundle === "legacy") {
			// Nothing left to fall back to; let VS Code surface the failure. When
			// this was already the crash fallback, no bundle telemetry pipeline is
			// alive — the loader's direct event is the only record.
			void reportLoaderDecision(context, "legacy", {
				...meta,
				attemptedBundle: fallbackFrom?.attempted ?? "legacy",
				fallback: fallbackFrom !== undefined,
				doubleFailure: fallbackFrom !== undefined,
				errorMessage: formatActivationError(error),
			}).catch(() => {});
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
		void reportLoaderDecision(context, "legacy", {
			...meta,
			attemptedBundle: "next",
			fallback: true,
			errorMessage: formatActivationError(error),
		}).catch(() => {});
		return activateBundle(
			context,
			prefix,
			"legacy",
			loaderVersion,
			meta,
			false,
			{ attempted: "next", error },
		);
	}
}

function formatActivationError(error: unknown): string {
	return error instanceof Error
		? `${error.message}\n${error.stack ?? ""}`.slice(0, 2000)
		: String(error);
}

/**
 * Nightly-only visible indicator of which bundle this window is running.
 * The stable combined VSIX (and any ordinary build) never shows it: the
 * prefix is derived from the packaged manifest name. Best-effort — the
 * indicator must never take down an otherwise successful activation.
 */
function showNightlyBundleIndicator(
	context: vscode.ExtensionContext,
	prefix: IdPrefix,
	bundle: Bundle,
	meta: ActivationMeta,
	fallbackFrom: FallbackFrom | undefined,
) {
	if (prefix !== "cline-nightly") {
		return;
	}
	try {
		const item = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Right,
			-1000,
		);
		item.text = bundle === "next" ? "Cline: Next" : "Cline: Legacy";
		const detail = fallbackFrom
			? "crash fallback from the next bundle"
			: meta.override
				? `forced by ${meta.override === "env" ? `the ${BUNDLE_OVERRIDE_ENV} env var` : "the bundleOverride setting"}`
				: "rollout assignment";
		item.tooltip = `Cline nightly A/B rollout: running the ${bundle === "next" ? "next (SDK)" : "legacy"} bundle (${detail}).`;
		item.show();
		context.subscriptions.push(item);
	} catch (error) {
		console.warn("[cline-rollout] could not show bundle indicator:", error);
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
