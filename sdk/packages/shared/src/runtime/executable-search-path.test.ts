import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { excludeCurrentDirectoryFromExecutableSearch } from "./executable-search-path";

const VARIABLE = "NoDefaultCurrentDirectoryInExePath";
const onWindows = process.platform === "win32";

describe("excludeCurrentDirectoryFromExecutableSearch", () => {
	const original = process.env[VARIABLE];

	afterEach(() => {
		if (original === undefined) {
			delete process.env[VARIABLE];
		} else {
			process.env[VARIABLE] = original;
		}
	});

	it.skipIf(onWindows)("leaves the environment untouched off Windows", () => {
		delete process.env[VARIABLE];

		excludeCurrentDirectoryFromExecutableSearch();

		expect(process.env[VARIABLE]).toBeUndefined();
	});

	it.runIf(onWindows)(
		"publishes a non-empty value to the process environment block",
		() => {
			delete process.env[VARIABLE];

			excludeCurrentDirectoryFromExecutableSearch();

			// NeedCurrentDirectoryForExePath reads the variable into a
			// one-character buffer and reads "no characters" as "not defined", so
			// an empty value would leave the working-directory search enabled.
			expect(process.env[VARIABLE]).toBeTruthy();

			// The lookup runs inside the OS, against the environment block rather
			// than this JavaScript view of it. A child that inherits the block
			// unmodified sees the variable only if the write reached that far.
			const comspec = process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe";
			const inherited = spawnSync(comspec, ["/d", "/c", `echo %${VARIABLE}%`], {
				encoding: "utf8",
				windowsHide: true,
			});
			expect(inherited.stdout.trim()).toBe("1");
		},
	);

	// A repository is untrusted input, and Cline spawns `rg`, `git` and the
	// user's shell by bare name with that repository as the working directory.
	// Bun 1.3 resolves bare names through PATH only, so this passes there
	// whether or not the call is made; under Node — and Bun 1.4, which adopted
	// the same working-directory search — removing the call fails it.
	it.runIf(onWindows)(
		"does not run an executable planted in the working directory",
		() => {
			const root = mkdtempSync(join(tmpdir(), "cline-exe-search-"));
			try {
				const workspace = join(root, "workspace");
				const binDir = join(root, "bin");
				mkdirSync(workspace);
				mkdirSync(binDir);

				// ".exe" is one of the extensions the lookup appends to a bare name.
				// An empty file is not a loadable image, so selecting it is visible
				// as a failure to execute rather than as different output.
				writeFileSync(join(workspace, "rg.exe"), "");
				const comspec = process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe";
				copyFileSync(comspec, join(binDir, "rg.exe"));

				excludeCurrentDirectoryFromExecutableSearch();

				const result = spawnSync("rg", ["/d", "/c", "exit 7"], {
					cwd: workspace,
					env: { ...process.env, PATH: `${binDir};${process.env.PATH ?? ""}` },
					windowsHide: true,
				});

				expect(result.error).toBeUndefined();
				expect(result.status).toBe(7);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		},
	);
});
