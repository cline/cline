import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const NAME = "NoDefaultCurrentDirectoryInExePath";

// The module latches the inherited value on first use; a fresh copy per test
// keeps the cases independent.
async function loadFresh() {
	vi.resetModules();
	return import("./windows-exe-path");
}

describe("disableCurrentDirectoryExecutableSearch", () => {
	it("defines the Windows opt-out variable", async () => {
		const { disableCurrentDirectoryExecutableSearch } = await loadFresh();
		const env: Record<string, string | undefined> = {};
		disableCurrentDirectoryExecutableSearch({ env, platform: "win32" });
		expect(env[NAME]).toBe("1");
	});

	it("leaves other platforms alone", async () => {
		const { disableCurrentDirectoryExecutableSearch } = await loadFresh();
		for (const platform of ["darwin", "linux"] as const) {
			const env: Record<string, string | undefined> = {};
			disableCurrentDirectoryExecutableSearch({ env, platform });
			expect(env).toEqual({});
		}
	});

	// Runs a bare `cmd` with a zero-byte cmd.exe planted in the working
	// directory. libuv picks the planted file first unless the opt-out is set,
	// and the spawn then fails on the invalid executable.
	it.runIf(process.platform === "win32")(
		"keeps a cmd.exe planted in the working directory from shadowing the real one",
		async () => {
			const { disableCurrentDirectoryExecutableSearch } = await loadFresh();
			const cwd = await mkdtemp(join(tmpdir(), "cline-planted-exe-"));
			const previous = process.env[NAME];
			try {
				await writeFile(join(cwd, "cmd.exe"), "");
				delete process.env[NAME];
				expect(await runsRealCmd(cwd)).toBe(false);

				disableCurrentDirectoryExecutableSearch();
				expect(await runsRealCmd(cwd)).toBe(true);
			} finally {
				if (previous === undefined) {
					delete process.env[NAME];
				} else {
					process.env[NAME] = previous;
				}
				await rm(cwd, { recursive: true, force: true });
			}
		},
	);
});

describe("withInheritedExecutableSearch", () => {
	it("returns the environment untouched when the process was never hardened", async () => {
		const { withInheritedExecutableSearch } = await loadFresh();
		const env = { [NAME]: "user", PATH: "C:\\bin" };
		expect(withInheritedExecutableSearch(env)).toBe(env);
	});

	it("drops the variable from children when this process did not inherit it", async () => {
		const {
			disableCurrentDirectoryExecutableSearch,
			withInheritedExecutableSearch,
		} = await loadFresh();
		const env: Record<string, string | undefined> = { PATH: "C:\\bin" };
		disableCurrentDirectoryExecutableSearch({ env, platform: "win32" });

		const child = withInheritedExecutableSearch({ ...env, EXTRA: "x" });
		expect(child).toEqual({ PATH: "C:\\bin", EXTRA: "x" });
		// The hardened parent environment is left alone.
		expect(env[NAME]).toBe("1");
	});

	it("keeps the user's own value when the variable was already set", async () => {
		const {
			disableCurrentDirectoryExecutableSearch,
			withInheritedExecutableSearch,
		} = await loadFresh();
		const env: Record<string, string | undefined> = { [NAME]: "user" };
		disableCurrentDirectoryExecutableSearch({ env, platform: "win32" });
		// A second call, as when the daemon entry runs after the CLI entry,
		// must not mistake our own "1" for the inherited value.
		disableCurrentDirectoryExecutableSearch({ env, platform: "win32" });

		expect(withInheritedExecutableSearch(env)).toEqual({ [NAME]: "user" });
	});
});

function runsRealCmd(cwd: string): Promise<boolean> {
	return new Promise((resolve) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn("cmd", ["/d", "/c", "echo ok"], {
				cwd,
				stdio: ["ignore", "pipe", "ignore"],
				windowsHide: true,
			});
		} catch {
			resolve(false);
			return;
		}
		let stdout = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.on("error", () => resolve(false));
		child.on("close", (code) => resolve(code === 0 && stdout.trim() === "ok"));
	});
}
