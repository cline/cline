import type {
	PluginInitializationFailure,
	PluginInitializationWarning,
} from "../extensions/plugin/plugin-load-report";

/**
 * What the most recent local session bootstrap learned while loading plugins.
 *
 * Plugin loading executes arbitrary plugin code, so only the session bootstrap
 * is allowed to do it. Hosts that want to report plugin health — a settings
 * page, an installed-plugin list — read this report instead of loading plugins
 * a second time, which would duplicate `setup()` side effects and can disagree
 * with the session whenever the two resolve the sandbox runtime differently.
 */
export interface PluginLoadReport {
	/** Plugin entry paths the session tried to load, after the disabled filter. */
	pluginPaths: string[];
	failures: PluginInitializationFailure[];
	warnings: PluginInitializationWarning[];
	/** Epoch milliseconds of the load this report describes. */
	recordedAt: number;
	workspacePath?: string;
	providerId?: string;
	modelId?: string;
}

let latestReport: PluginLoadReport | undefined;

export function recordPluginLoadReport(
	report: Omit<PluginLoadReport, "recordedAt">,
): void {
	latestReport = { ...report, recordedAt: Date.now() };
}

/**
 * The last report recorded in this process, or undefined when no session has
 * loaded plugins yet. Callers must treat undefined as "not validated yet"
 * rather than "healthy".
 */
export function getLatestPluginLoadReport(): PluginLoadReport | undefined {
	return latestReport;
}

export function clearPluginLoadReport(): void {
	latestReport = undefined;
}
