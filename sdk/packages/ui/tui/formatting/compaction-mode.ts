export type CliCompactionMode = "agentic" | "basic" | "off";

/**
 * Structural view of the compaction section of a session config. Hosts pass
 * their own richer config objects; only these fields are read or written.
 */
export interface CompactionModeSettings {
	enabled?: boolean;
	strategy?: Extract<CliCompactionMode, "agentic" | "basic">;
}

export const CLI_COMPACTION_MODES = ["basic", "agentic", "off"] as const;

export const DEFAULT_CLI_COMPACTION_MODE: Extract<
	CliCompactionMode,
	"agentic" | "basic"
> = "agentic";

const CLI_COMPACTION_MODE_ALIASES: Record<string, CliCompactionMode> = {
	agentic: "agentic",
	basic: "basic",
	off: "off",
};

const CLI_COMPACTION_MODE_LABELS = {
	agentic: "LLM",
	basic: "Truncation",
	off: "Off",
} as const satisfies Record<CliCompactionMode, string>;

export const CLI_COMPACTION_MODE_OPTION_DESCRIPTION =
	"Context compaction mode: agentic|basic|off (default: agentic)";

export const CLI_COMPACTION_MODE_EXPECTED_TEXT = '"agentic", "basic", or "off"';

export function parseCliCompactionMode(
	value: string,
): CliCompactionMode | undefined {
	return CLI_COMPACTION_MODE_ALIASES[value.trim().toLowerCase()];
}

export function buildCliCompactionConfig(
	mode?: CliCompactionMode,
): CompactionModeSettings {
	if (mode === undefined) {
		return { enabled: true };
	}
	if (mode === "off") {
		return { enabled: false };
	}
	return { enabled: true, strategy: mode };
}

export function getCliCompactionMode(config: {
	compaction?: CompactionModeSettings;
}): CliCompactionMode {
	if (config.compaction?.enabled === false) {
		return "off";
	}
	return config.compaction?.strategy ?? DEFAULT_CLI_COMPACTION_MODE;
}

export function applyCliCompactionMode(
	config: { compaction?: CompactionModeSettings },
	mode: CliCompactionMode | undefined,
): void {
	if (mode === undefined) {
		return;
	}
	if (mode === "off") {
		const { strategy: _strategy, ...rest } = config.compaction ?? {};
		config.compaction = {
			...rest,
			enabled: false,
		};
		return;
	}

	config.compaction = {
		...config.compaction,
		enabled: true,
		strategy: mode,
	};
}

export function getNextCliCompactionMode(
	mode: CliCompactionMode,
): CliCompactionMode {
	const currentIndex = CLI_COMPACTION_MODES.indexOf(mode);
	const safeIndex = currentIndex >= 0 ? currentIndex : 0;
	return CLI_COMPACTION_MODES[(safeIndex + 1) % CLI_COMPACTION_MODES.length];
}

export function formatCliCompactionMode(mode: CliCompactionMode): string {
	return CLI_COMPACTION_MODE_LABELS[mode];
}
