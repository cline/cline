import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { machineId } from "node-machine-id";
import * as vscode from "vscode";
import {
	type Bundle,
	COHORT_STATE_KEY,
	parseRolloutAssignment,
	ROLLOUT_FLAG,
} from "./cohort";

/**
 * Same PostHog project + reverse proxy the extension's telemetry uses.
 * The API key is injected at build time by CI (see esbuild.mjs), matching how
 * apps/vscode injects TELEMETRY_SERVICE_API_KEY. Local builds without the key
 * skip all network calls, so the loader defaults everyone to legacy.
 */
const POSTHOG_HOST = "https://data.cline.bot";
const POSTHOG_API_KEY = process.env.TELEMETRY_SERVICE_API_KEY;
const FETCH_TIMEOUT_MS = 10_000;
const FEATURE_FLAG_CALLED_EVENT = "$feature_flag_called";

/**
 * Mirror the distinct-id derivation in apps/vscode
 * (src/services/logging/distinctId.ts) so PostHog evaluates the rollout flag
 * against the same id the bundles report telemetry with — otherwise cohort
 * membership can't be correlated with cohort behavior in dashboards.
 * Falls back to vscode.env.machineId rather than generating + persisting a new
 * id: the loader must never write to the shared ~/.cline state files.
 */
async function getDistinctId(): Promise<string> {
	const generated = await readSharedGlobalStateKey("cline.generatedMachineId");
	if (typeof generated === "string" && generated.length > 0) {
		return generated;
	}
	try {
		const id = await machineId();
		if (id) {
			return id;
		}
	} catch {
		// fall through
	}
	return vscode.env.machineId;
}

/** Read one key from the file-backed global state both bundles share. */
async function readSharedGlobalStateKey(key: string): Promise<unknown> {
	try {
		const clineDir = process.env.CLINE_DIR || path.join(os.homedir(), ".cline");
		const raw = await readFile(
			path.join(clineDir, "data", "globalState.json"),
			"utf8",
		);
		const state = JSON.parse(raw);
		return state?.[key];
	} catch {
		return undefined;
	}
}

async function postJson(
	url: string,
	body: object,
): Promise<Response | undefined> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		return await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: controller.signal,
		});
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

async function fetchAssignment(
	distinctId: string,
): Promise<Bundle | undefined> {
	if (!POSTHOG_API_KEY) {
		return undefined;
	}
	const response = await postJson(`${POSTHOG_HOST}/decide?v=3`, {
		api_key: POSTHOG_API_KEY,
		distinct_id: distinctId,
	});
	if (!response?.ok) {
		return undefined;
	}
	try {
		const decideResponse = await response.json();
		const assignment = parseRolloutAssignment(decideResponse);
		if (!assignment) {
			return undefined;
		}

		// Mirror FeatureFlagsService/PostHog SDK exposure tracking for this
		// loader-owned flag evaluation. This event is intentionally not gated by
		// telemetry opt-out: feature-flag evaluation remains enabled so PostHog can
		// correctly attribute rollout cohorts, while loader_decision below still
		// respects user/host telemetry settings.
		void reportFeatureFlagCalled(
			distinctId,
			getRolloutFlagResponse(decideResponse),
		).catch(() => {});

		return assignment;
	} catch {
		return undefined;
	}
}

function getRolloutFlagResponse(response: unknown): unknown {
	const flags = (
		response as { featureFlags?: Record<string, unknown> } | undefined
	)?.featureFlags;
	return flags && typeof flags === "object" ? flags[ROLLOUT_FLAG] : undefined;
}

async function reportFeatureFlagCalled(
	distinctId: string,
	flagResponse: unknown,
): Promise<void> {
	if (!POSTHOG_API_KEY) {
		return;
	}
	await postJson(`${POSTHOG_HOST}/capture/`, {
		api_key: POSTHOG_API_KEY,
		event: FEATURE_FLAG_CALLED_EVENT,
		distinct_id: distinctId,
		properties: {
			$feature_flag: ROLLOUT_FLAG,
			$feature_flag_response: flagResponse,
		},
	});
}

/**
 * Background refresh: evaluate the rollout flag and cache exactly what it
 * says for the NEXT window (two-way: dialing the percentage down demotes on
 * the next reload). Never affects the bundle already activated in this
 * window, and failures leave the cached assignment untouched (sticky on
 * transient errors only).
 */
export async function refreshCohort(
	context: vscode.ExtensionContext,
): Promise<void> {
	const distinctId = await getDistinctId();
	const assignment = await fetchAssignment(distinctId);
	if (!assignment) {
		return;
	}
	await context.globalState.update(COHORT_STATE_KEY, assignment);
}

/**
 * The loader's own decision event. Distinct from the AUTHORITATIVE
 * `extension.rollout.bundle_activated` event, which the activated bundle
 * itself captures through its variant-attributed telemetry pipeline (the
 * loader triggers it via the bundle's reportRolloutActivation export — see
 * src/extension.ts). This event carries the loader-side metadata that event
 * can't (override source, launch cadence, loader version) and is the only
 * signal left when BOTH bundles fail to activate.
 */
export const LOADER_DECISION_EVENT = "extension.rollout.loader_decision";

/**
 * Report the loader's bundle decision (and whether it was a crash fallback).
 * Feature-flag evaluation is always allowed (matching the extension's
 * FeatureFlagsService), but event capture respects the user's telemetry
 * opt-out and VS Code's global telemetry setting.
 */
export async function reportLoaderDecision(
	context: vscode.ExtensionContext,
	bundle: Bundle,
	options: {
		fallback: boolean;
		/** Bundle the loader originally decided on; differs from `bundle` on fallback. */
		attemptedBundle?: Bundle;
		/** Both bundles threw — nothing activated, and no bundle telemetry exists. */
		doubleFailure?: boolean;
		errorMessage?: string;
		/** Time since the previous loader activation on this machine, if known. */
		msSinceLastActivation?: number;
		/** Whether an env var or user setting forced this bundle. */
		override?: "env" | "setting";
	},
): Promise<void> {
	if (!POSTHOG_API_KEY) {
		return;
	}
	const telemetrySetting = await readSharedGlobalStateKey("telemetrySetting");
	if (telemetrySetting === "disabled" || !vscode.env.isTelemetryEnabled) {
		return;
	}
	const distinctId = await getDistinctId();
	await postJson(`${POSTHOG_HOST}/capture/`, {
		api_key: POSTHOG_API_KEY,
		event: LOADER_DECISION_EVENT,
		distinct_id: distinctId,
		properties: {
			bundle,
			attempted_bundle: options.attemptedBundle ?? bundle,
			fallback: options.fallback,
			double_failure: options.doubleFailure,
			error_message: options.errorMessage,
			// Launch-cadence distribution: how long promotions take to reach real
			// windows tells us how fast the rollout percentage can safely be dialed.
			ms_since_last_activation: options.msSinceLastActivation,
			override: options.override,
			loader_version: context.extension.packageJSON?.version,
			// Separates nightly traffic from the (future) stable combined VSIX.
			extension_name: context.extension.packageJSON?.name,
			vscode_version: vscode.version,
		},
	});
}
