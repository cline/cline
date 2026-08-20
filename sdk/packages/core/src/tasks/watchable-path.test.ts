import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { toWatchablePath } from "./watchable-path";

describe("toWatchablePath", () => {
	const root = mkdtempSync(join(tmpdir(), "cline-watchable-path-"));

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("returns the path unchanged on POSIX even when it is a symlink", () => {
		const link = join(root, "link");
		symlinkSync(root, link, "dir");
		expect(toWatchablePath(link, "linux")).toBe(link);
		expect(toWatchablePath(link, "darwin")).toBe(link);
	});

	it("resolves the native real path on win32 so 8.3 short-name components cannot crash fs.watch", () => {
		expect(toWatchablePath(root, "win32")).toBe(realpathSync.native(root));
	});

	it("falls back to the original path on win32 when resolution fails", () => {
		const missing = join(root, "does-not-exist");
		expect(toWatchablePath(missing, "win32")).toBe(missing);
	});

	it("never returns a short-name component for an existing directory on Windows", () => {
		// Runs meaningfully only on Windows CI, where tmpdir contains RUNNER~1.
		if (process.platform !== "win32") return;
		expect(toWatchablePath(root)).not.toMatch(/~\d/);
	});
});
