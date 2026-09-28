import type { GlobalSettings } from "@cline/core";
import type { CliAgentMode, CliCompactionMode, ParsedArgs } from "./types";

/**
 * Resolves general settings at CLI startup with the precedence
 * explicit CLI flag -> persisted global setting -> built-in default,
 * so choices made in the TUI /settings panel survive restarts (see
 * https://github.com/cline/cline/issues/12158).
 */

export function resolveStartupMode(
	args: Pick<ParsedArgs, "mode" | "modeExplicitlySet">,
	settings: GlobalSettings,
): CliAgentMode {
	if (args.modeExplicitlySet) {
		return args.mode;
	}
	return settings.planActMode ?? args.mode;
}

/**
 * Non-interactive runs (a prompt argument or piped stdin without --tui) that
 * auto-approve tools have no one to approve anything, so an implicit "act"
 * mode is promoted to "yolo". An explicit mode flag (e.g. --act, --plan)
 * always wins.
 */
export function resolveNonInteractiveMode(
	args: Pick<ParsedArgs, "modeExplicitlySet">,
	mode: CliAgentMode,
	options: { interactive: boolean; autoApprove: boolean },
): CliAgentMode {
	if (
		!options.interactive &&
		options.autoApprove &&
		mode === "act" &&
		!args.modeExplicitlySet
	) {
		return "yolo";
	}
	return mode;
}

export function resolveStartupToolAutoApprove(
	args: Pick<ParsedArgs, "autoApproveOverride">,
	settings: GlobalSettings,
	defaultToolAutoApprove: boolean,
): boolean {
	return (
		args.autoApproveOverride ??
		settings.toolAutoApprove ??
		defaultToolAutoApprove
	);
}

/**
 * Returns undefined when neither a flag nor a persisted value exists, so
 * callers fall through to Core's compaction default.
 */
export function resolveStartupCompactionMode(
	args: Pick<ParsedArgs, "compactionMode">,
	settings: GlobalSettings,
): CliCompactionMode | undefined {
	if (args.compactionMode) {
		return args.compactionMode;
	}
	if (settings.compactionEnabled === false) {
		return "off";
	}
	return settings.compactionStrategy;
}
