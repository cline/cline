import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { machineId } from "node-machine-id";
import * as vscode from "vscode";
import {
	type Bundle,
	COHORT_STATE_KEY,
	KILLSWITCH_STATE_KEY,
	nextCachedBundle,
	parseRolloutFlags,
	type RolloutFlags,
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

async function fetchFlags(
	distinctId: string,
): Promise<RolloutFlags | undefined> {
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
		return parseRolloutFlags(await response.json());
	} catch {
		return undefined;
	}
}

/**
 * Background refresh: evaluate the rollout flags and cache the assignment for
 * the NEXT window. Never affects the bundle already activated in this window,
 * and failures leave the cached assignment untouched (sticky by default).
 */
export async function refreshCohort(
	context: vscode.ExtensionContext,
	loaderVersion: string,
): Promise<void> {
	const distinctId = await getDistinctId();
	const flags = await fetchFlags(distinctId);
	if (!flags) {
		return;
	}
	const cached = context.globalState.get<string>(COHORT_STATE_KEY);
	await context.globalState.update(
		COHORT_STATE_KEY,
		nextCachedBundle(cached, flags, loaderVersion),
	);
	await context.globalState.update(
		KILLSWITCH_STATE_KEY,
		flags.killedUpToVersion,
	);
}

/**
 * Report which bundle actually activated (and whether it was a crash
 * fallback). Feature-flag evaluation is always allowed (matching the
 * extension's FeatureFlagsService), but event capture respects the user's
 * telemetry opt-out and VS Code's global telemetry setting.
 */
export async function reportActivation(
	context: vscode.ExtensionContext,
	bundle: Bundle,
	options: {
		fallback: boolean;
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
		event: "extension.rollout.bundle_activated",
		distinct_id: distinctId,
		properties: {
			bundle,
			fallback: options.fallback,
			error_message: options.errorMessage,
			// Launch-cadence distribution: how long promotions take to reach real
			// windows tells us how fast the rollout percentage can safely be dialed.
			ms_since_last_activation: options.msSinceLastActivation,
			override: options.override,
			loader_version: context.extension.packageJSON?.version,
			vscode_version: vscode.version,
		},
	});
}
