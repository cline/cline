import * as vscode from "vscode"
import { getExtensionVariant } from "@/services/telemetry/rollout-metadata"
import { Logger } from "@/shared/services/Logger"

// ---------------------------------------------------------------------------
// Rollout auth stand-down
//
// During the combined-VSIX A/B rollout, this (legacy) bundle and the next
// (SDK) bundle keep Cline-account credentials in different stores, and the
// refresh endpoint ROTATES the refresh token: whichever bundle refreshes
// last strands the other with a consumed token and a hard logout.
//
// Once this machine is assigned to the next cohort, any still-open legacy
// window is a straggler that will be replaced by next on its reload. Instead
// of letting it keep rotating the shared refresh token (and eventually
// logging the user out everywhere with a confusing auth error), it stands
// down: it never refreshes/rotates again, keeps working until its current
// access token naturally expires, and then presents a clear "reload this
// window to continue on the new version" message.
//
// Critically, standing down NEVER clears the stored credential blob — the
// next bundle's one-time migration reads it, and a demotion back to legacy
// must find it intact.
// ---------------------------------------------------------------------------

/**
 * Loader-owned state and settings, mirrored from apps/vscode-rollout on main
 * (src/cohort.ts) — keep in sync. The loader shares this extension's
 * globalState, so the memento keys are directly readable here.
 */
export const COHORT_STATE_KEY = "cline.rollout.bundle"
export const FAILED_VERSION_STATE_KEY = "cline.rollout.nextActivationFailedVersion"
export const BUNDLE_OVERRIDE_ENV = "CLINE_BUNDLE_OVERRIDE"
export const SETTING_BUNDLE_OVERRIDE = "bundleOverride"
const NIGHTLY_EXTENSION_NAME = "cline-nightly"

export interface StanddownInputs {
	/** CLINE_BUNDLE_OVERRIDE, if set. Beats everything (mirrors the loader). */
	envOverride: string | undefined
	/** The <prefix>.rollout.bundleOverride user setting ("auto" = no override). */
	settingOverride: string | undefined
	/** The loader's cached cohort assignment ("next" | "legacy" | undefined). */
	cached: string | undefined
	/** The next bundle failed to activate on this VSIX version (loader pinned legacy). */
	previousFailure: boolean
}

function asBundle(value: unknown): "next" | "legacy" | undefined {
	return value === "next" || value === "legacy" ? value : undefined
}

/**
 * Whether a legacy window should stand down its Cline-account auth. Mirrors
 * the loader's decideBundle(): the answer is "the next window reload on this
 * machine will activate the next bundle". Overrides and the crash pin keep
 * this window fully functional — the user (or the loader's safety net)
 * explicitly chose legacy in those cases.
 */
export function decideStanddown(inputs: StanddownInputs): boolean {
	const forced = asBundle(inputs.envOverride) ?? asBundle(inputs.settingOverride)
	if (forced) {
		return false // forced legacy keeps working; forced next never activates this bundle
	}
	if (inputs.previousFailure) {
		return false
	}
	return inputs.cached === "next"
}

let extensionContext: vscode.ExtensionContext | undefined
let notified = false

/** Called once from activate() so the cohort memento can be read later. */
export function initializeRolloutStanddown(context: vscode.ExtensionContext): void {
	extensionContext = context
}

function readInputs(context: vscode.ExtensionContext): StanddownInputs {
	const packageJSON = (context.extension?.packageJSON ?? {}) as {
		name?: string
		version?: string
	}
	const prefix = packageJSON.name === NIGHTLY_EXTENSION_NAME ? "cline-nightly" : "cline"
	return {
		envOverride: process.env[BUNDLE_OVERRIDE_ENV],
		settingOverride: vscode.workspace.getConfiguration(`${prefix}.rollout`).get<string>(SETTING_BUNDLE_OVERRIDE),
		cached: context.globalState.get<string>(COHORT_STATE_KEY),
		previousFailure:
			packageJSON.version !== undefined &&
			context.globalState.get<string>(FAILED_VERSION_STATE_KEY) === packageJSON.version,
	}
}

/**
 * True when this window is a legacy straggler on a machine assigned to the
 * next cohort. Re-reads the loader's memento on every call so a demotion
 * (flag dialed back down) re-enables auth without a reload.
 *
 * Only ever true for bundles built by the combined rollout workflow
 * (CLINE_ROLLOUT_VARIANT="legacy") — standalone/marketplace legacy builds and
 * dev builds never stand down, even if a loader memento is present.
 */
export function shouldStandDownAuth(): boolean {
	if (getExtensionVariant() !== "legacy") {
		return false
	}
	const context = extensionContext
	if (!context) {
		return false
	}
	try {
		return decideStanddown(readInputs(context))
	} catch (error) {
		Logger.error("[RolloutStanddown] Failed to evaluate cohort state:", error)
		return false
	}
}

/**
 * One-time-per-window notice shown when auth actually stands down (token
 * expired and refresh was suppressed, or the user tried to sign in here).
 */
export function notifyRolloutStanddown(): void {
	if (notified) {
		return
	}
	notified = true
	const reload = "Reload Window"
	vscode.window
		.showWarningMessage(
			"You've been signed out in this window because this machine was upgraded to the new version of Cline. " +
				"Reload the window to keep using your account on the new version.",
			reload,
		)
		.then((choice) => {
			if (choice === reload) {
				vscode.commands.executeCommand("workbench.action.reloadWindow")
			}
		})
}

/** Test-only: reset module state between tests. */
export function resetRolloutStanddownForTests(): void {
	extensionContext = undefined
	notified = false
}
