import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
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
// That hazard needs TWO holders of the same token family. The second holder
// is born when the next bundle first activates on this machine and its
// credential migration copies the legacy blob into providers.json (or the
// user signs in on next directly). So a legacy window stands down only when
// BOTH are true:
//
//   1. the loader's cached cohort assignment says this machine's next window
//      reload activates the next bundle, and
//   2. next demonstrably holds Cline-account credentials on this machine
//      (providers.json has a cline entry with a refresh token).
//
// Until (2), the user may be sitting in their one and only window after the
// cohort flag flipped mid-session — that window is the SOLE owner of the
// token family, its rotations are harmless, and they keep the blob fresh for
// the eventual migration. It must keep working untouched, indefinitely.
//
// Once both hold, the straggler stands down: it never refreshes/rotates
// again, keeps working until its current access token naturally expires, and
// then presents a clear "reload this window to continue on the new version"
// message.
//
// Critically, standing down NEVER clears the stored credential blob — the
// next bundle's migration reads it, and a demotion back to legacy must find
// it intact.
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
	/** The next bundle holds Cline-account credentials on this machine (see nextBundleOwnsClineAccount). */
	nextOwnsClineAccount: boolean
}

function asBundle(value: unknown): "next" | "legacy" | undefined {
	return value === "next" || value === "legacy" ? value : undefined
}

/**
 * Whether a legacy window should stand down its Cline-account auth. Mirrors
 * the loader's decideBundle() precedence, then additionally requires that the
 * next bundle has actually taken co-ownership of the Cline account: "the next
 * window reload on this machine activates next AND next already holds the
 * credentials". Overrides and the crash pin keep this window fully
 * functional — the user (or the loader's safety net) explicitly chose legacy
 * in those cases.
 */
export function decideStanddown(inputs: StanddownInputs): boolean {
	const forced = asBundle(inputs.envOverride) ?? asBundle(inputs.settingOverride)
	if (forced) {
		return false // forced legacy keeps working; forced next never activates this bundle
	}
	if (inputs.previousFailure) {
		return false
	}
	return inputs.cached === "next" && inputs.nextOwnsClineAccount
}

/**
 * Where the next (SDK) bundle keeps its data. Mirrors the SDK's
 * resolveDataDirFromEnv() on main (apps/vscode/src/shared/storage/
 * storage-context.ts) — keep in sync: CLINE_DATA_DIR > CLINE_DIR/data >
 * ~/.cline/data.
 */
function resolveNextDataDir(): string {
	const envDataDir = process.env.CLINE_DATA_DIR?.trim()
	if (envDataDir) {
		return envDataDir
	}
	const clineDir = process.env.CLINE_DIR?.trim() || path.join(os.homedir(), ".cline")
	return path.join(clineDir, "data")
}

/**
 * True when the next bundle demonstrably co-owns the Cline account on this
 * machine: its providers.json has a cline entry holding a refresh token —
 * written either by its credential migration on first activation (which
 * copies this legacy blob) or by a sign-in performed on next (including the
 * CLI, which shares the same store and also rotates).
 *
 * A cline entry WITHOUT auth (e.g. the CLI configured a model but never
 * signed in) does not count: whoever holds no refresh token cannot rotate,
 * so this window rotating strands nobody.
 *
 * Deliberately fail-open: no file, unreadable, or malformed → false, auth
 * keeps working.
 */
export function nextBundleOwnsClineAccount(): boolean {
	try {
		const file = path.join(resolveNextDataDir(), "settings", "providers.json")
		const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
			providers?: Record<string, { settings?: { auth?: { refreshToken?: unknown } } }>
		}
		const refreshToken = parsed?.providers?.cline?.settings?.auth?.refreshToken
		return typeof refreshToken === "string" && refreshToken.length > 0
	} catch {
		return false
	}
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
		nextOwnsClineAccount: nextBundleOwnsClineAccount(),
	}
}

/**
 * True when this window is a legacy straggler on a machine assigned to the
 * next cohort AND the next bundle already holds the Cline credentials.
 * Re-reads the loader's memento and providers.json on every call, so both a
 * demotion (flag dialed back down) and next releasing the credentials
 * re-enable auth without a reload — and a next window activating alongside
 * this one engages the stand-down without a reload.
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
