export type DrivecodeDemoCliBootstrap = {
	/** `CLINE_DEMO_STATUS_PLANS=1` — use demo status adapter */
	useDemoStatusAdapter: boolean;
	/** `CLINE_DEMO_STATUS_LENS` — initial Status lens when opening Status */
	statusInitialLens?: "board" | "dependency-map";
	/** `CLINE_DEMO_OPEN_STATUS=1` — auto-open the Status dialog */
	autoOpenStatus: boolean;
	/** `CLINE_DEMO_DRIVE=1` — start with Drive already active */
	driveActiveOnStart: boolean;
};

/**
 * Read CLI demo flags from env at the composition-root edge only.
 * Product views must not call this; adapters must not read env inside `load()`.
 */
export function readDrivecodeDemoCliBootstrap(
	env: NodeJS.ProcessEnv = process.env,
): DrivecodeDemoCliBootstrap {
	const lens = env.CLINE_DEMO_STATUS_LENS?.trim();
	return {
		useDemoStatusAdapter: env.CLINE_DEMO_STATUS_PLANS === "1",
		statusInitialLens:
			lens === "board" || lens === "dependency-map" ? lens : undefined,
		autoOpenStatus: env.CLINE_DEMO_OPEN_STATUS === "1",
		driveActiveOnStart: env.CLINE_DEMO_DRIVE === "1",
	};
}
