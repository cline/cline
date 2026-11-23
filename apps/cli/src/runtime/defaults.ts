/**
 * Default loop detection thresholds for the CLI.
 * The agent core leaves loop detection off by default;
 * the CLI enables it with these settings.
 */
export const CLI_DEFAULT_LOOP_DETECTION = {
	softThreshold: 3,
	hardThreshold: 5,
} as const;

/**
 * Consecutive mistakes a run tolerates before it stops or asks how to
 * continue, when `--retries` is not given. `--help` reports this value.
 */
export const CLI_DEFAULT_MAX_CONSECUTIVE_MISTAKES = 3;

/**
 * Default checkpoint configuration for the CLI.
 * Core leaves checkpoints disabled by default (opt-in);
 * the CLI enables them so every run gets a restorable git snapshot.
 */
export const CLI_DEFAULT_CHECKPOINT_CONFIG = {
	enabled: true,
} as const;
