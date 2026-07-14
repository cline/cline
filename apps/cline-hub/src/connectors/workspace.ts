import { spawnSync } from "node:child_process";

export function resolveWorkspaceRoot(cwd: string): string {
	const result = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
		encoding: "utf8",
	});
	if (result.status === 0) {
		const value = result.stdout.trim();
		if (value) {
			return value;
		}
	}
	return cwd;
}
