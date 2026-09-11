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
 * Default checkpoint configuration for the CLI.
 * Core leaves checkpoints disabled by default (opt-in);
 * the CLI enables them so every run gets a restorable git snapshot.
 */
export const CLI_DEFAULT_CHECKPOINT_CONFIG = {
	enabled: true,
} as const;

/**
 * Default iteration cap for the CLI.
 * The agent core leaves maxIterations unset (unbounded) by default;
 * the CLI bounds it so a provider that keeps returning tool calls
 * cannot drive an endless request loop on a non-interactive run.
 */
export const CLI_DEFAULT_MAX_ITERATIONS = 100;
