import fixPath from "fix-path";

export interface DesktopEnvironmentInitialization {
	pathChanged: boolean;
	error?: string;
}

type FixPath = () => void;

/**
 * Restore the user's shell PATH for GUI-launched Unix desktop processes.
 *
 * macOS and Linux launchers commonly omit PATH entries configured in shell
 * startup files. Windows GUI processes already inherit the user and system
 * PATH from Explorer, and fix-path intentionally has no Windows behavior.
 */
export function initializeDesktopEnvironment(
	platform: NodeJS.Platform = process.platform,
	resolvePath: FixPath = fixPath,
): DesktopEnvironmentInitialization {
	if (platform === "win32") {
		return { pathChanged: false };
	}

	const originalPath = process.env.PATH;
	try {
		resolvePath();
		return { pathChanged: process.env.PATH !== originalPath };
	} catch (error) {
		// Shell startup files are user-controlled and may fail. Preserve the
		// inherited environment so a PATH resolution failure cannot prevent the
		// desktop backend from starting.
		if (originalPath === undefined) {
			delete process.env.PATH;
		} else {
			process.env.PATH = originalPath;
		}
		return {
			pathChanged: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
