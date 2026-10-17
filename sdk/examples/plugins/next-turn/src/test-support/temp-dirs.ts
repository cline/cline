import { afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveClineDir, setClineDir } from "@cline/shared/storage";

/**
 * Temporary directories for one test file, each removed after every test.
 * With `restoreClineDir`, Cline's directory is also put back after every test
 * that called `setClineDir`.
 */
export function useTempDirs(
	prefix: string,
	{ restoreClineDir = false } = {},
): (label?: string) => string {
	const dirs: string[] = [];
	const clineDir = restoreClineDir ? resolveClineDir() : undefined;
	afterEach(() => {
		if (clineDir !== undefined) setClineDir(clineDir);
		for (const dir of dirs.splice(0))
			rmSync(dir, { recursive: true, force: true });
	});
	return (label = "") => {
		const dir = mkdtempSync(join(tmpdir(), `${prefix}${label}`));
		dirs.push(dir);
		return dir;
	};
}
