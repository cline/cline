import type { CoreSessionConfig } from "../types/config";

export function resolveWorkspacePath(config: CoreSessionConfig): string {
	return config.workspaceRoot ?? config.cwd;
}
