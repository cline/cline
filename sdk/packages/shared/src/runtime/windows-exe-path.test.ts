import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	disableCurrentDirectoryExecutableSearch,
	NO_DEFAULT_CURRENT_DIRECTORY_IN_EXE_PATH_ENV,
} from "./windows-exe-path";

describe("disableCurrentDirectoryExecutableSearch", () => {
	it("defines the Windows opt-out variable", () => {
		const env: Record<string, string | undefined> = {};
		disableCurrentDirectoryExecutableSearch({ env, platform: "win32" });
		expect(env[NO_DEFAULT_CURRENT_DIRECTORY_IN_EXE_PATH_ENV]).toBe("1");
	});

	it("leaves other platforms alone", () => {
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
			const cwd = await mkdtemp(join(tmpdir(), "cline-planted-exe-"));
			const previous =
				process.env[NO_DEFAULT_CURRENT_DIRECTORY_IN_EXE_PATH_ENV];
			try {
				await writeFile(join(cwd, "cmd.exe"), "");
				delete process.env[NO_DEFAULT_CURRENT_DIRECTORY_IN_EXE_PATH_ENV];
				expect(await runsRealCmd(cwd)).toBe(false);

				disableCurrentDirectoryExecutableSearch();
				expect(await runsRealCmd(cwd)).toBe(true);
			} finally {
				if (previous === undefined) {
					delete process.env[NO_DEFAULT_CURRENT_DIRECTORY_IN_EXE_PATH_ENV];
				} else {
					process.env[NO_DEFAULT_CURRENT_DIRECTORY_IN_EXE_PATH_ENV] = previous;
				}
				await rm(cwd, { recursive: true, force: true });
			}
		},
	);
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
