import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	hardenWindowsExecutableLookup,
	NO_DEFAULT_CURRENT_DIRECTORY_IN_EXE_PATH,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	mergeSpawnEnv,
	omitSpawnEnv,
	windowsPowerShellExecutable,
	windowsSystemExecutable,
} from "./spawn-executable";

describe("windowsSystemExecutable", () => {
	it("builds the System32 path from SystemRoot, windir, or the default root", () => {
		expect(
			windowsSystemExecutable("taskkill.exe", { SYSTEMROOT: "D:\\Win" }),
		).toBe("D:\\Win\\System32\\taskkill.exe");
		expect(windowsSystemExecutable("taskkill.exe", { windir: "E:\\W" })).toBe(
			"E:\\W\\System32\\taskkill.exe",
		);
		expect(windowsSystemExecutable("taskkill.exe", {})).toBe(
			"C:\\Windows\\System32\\taskkill.exe",
		);
	});
});

describe("windowsPowerShellExecutable", () => {
	it("points at Windows PowerShell's own directory, not System32 itself", () => {
		expect(windowsPowerShellExecutable({})).toBe(
			"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
		);
		expect(windowsPowerShellExecutable({ SystemRoot: "D:\\Win" })).toBe(
			"D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
		);
	});
});

describe("mergeSpawnEnv", () => {
	it("lets an override replace an inherited variable of any case on Windows", () => {
		expect(
			mergeSpawnEnv(
				{ Path: "C:\\inherited", HOME: "C:\\Users\\a" },
				{ PATH: "C:\\override" },
				"win32",
			),
		).toEqual({ HOME: "C:\\Users\\a", PATH: "C:\\override" });
	});

	it("keeps case-variant names distinct on POSIX and behaves like a spread otherwise", () => {
		expect(
			mergeSpawnEnv({ Path: "/inherited" }, { PATH: "/override" }, "linux"),
		).toEqual({ Path: "/inherited", PATH: "/override" });
		expect(mergeSpawnEnv({ A: "1" }, undefined, "win32")).toEqual({ A: "1" });
		expect(mergeSpawnEnv({ A: "1" }, { A: "2", B: "3" }, "win32")).toEqual({
			A: "2",
			B: "3",
		});
	});
});

describe("omitSpawnEnv", () => {
	it("drops every spelling of the name on Windows and leaves the input alone", () => {
		const env = {
			NoDefaultCurrentDirectoryInExePath: "1",
			NODEFAULTCURRENTDIRECTORYINEXEPATH: "1",
			Path: "C:\\tools",
		};
		expect(
			omitSpawnEnv(env, NO_DEFAULT_CURRENT_DIRECTORY_IN_EXE_PATH, "win32"),
		).toEqual({ Path: "C:\\tools" });
		expect(Object.keys(env)).toHaveLength(3);
	});

	it("matches the exact spelling only on POSIX", () => {
		expect(
			omitSpawnEnv({ Foo: "1", FOO: "2", Bar: "3" }, "FOO", "linux"),
		).toEqual({ Foo: "1", Bar: "3" });
	});
});

describe.runIf(process.platform === "win32")(
	"Windows bare-name lookup once the process is hardened",
	() => {
		const variable = NO_DEFAULT_CURRENT_DIRECTORY_IN_EXE_PATH;

		function probe(name: string, cwd: string) {
			const args =
				name === "powershell" || name === "pwsh"
					? ["-NoProfile", "-NonInteractive", "-Command", "exit 0"]
					: ["--version"];
			return spawnSync(name, args, {
				cwd,
				stdio: "ignore",
				timeout: 15_000,
				windowsHide: true,
			});
		}

		it("never runs a same-named file planted in the working directory", async () => {
			const cwd = await mkdtemp(join(tmpdir(), "cline-planted-"));
			const original = process.env[variable];
			try {
				for (const file of [
					"powershell.exe",
					"pwsh.exe",
					"rg.exe",
					"git.exe",
				]) {
					await writeFile(join(cwd, file), "");
				}

				// Control: with the switch absent libuv picks the planted, empty
				// powershell.exe and the spawn fails before anything runs. This
				// leg is what makes a regression in the hardening visible.
				delete process.env[variable];
				const unprotected = probe("powershell", cwd);
				expect(unprotected.error).toBeDefined();
				expect(unprotected.status).toBeNull();

				expect(hardenWindowsExecutableLookup()).toBe(true);
				expect(process.env[variable]).toBe("1");

				const shell = probe("powershell", cwd);
				expect(shell.error).toBeUndefined();
				expect(shell.status).toBe(0);

				for (const name of ["pwsh", "rg", "git"]) {
					const result = probe(name, cwd);
					// The real program runs when it is installed; otherwise the
					// lookup fails with ENOENT. Either way the planted file was not
					// what libuv found.
					if (result.error) {
						expect((result.error as NodeJS.ErrnoException).code).toBe("ENOENT");
					} else {
						expect(result.status).toBe(0);
					}
				}
			} finally {
				if (original === undefined) {
					delete process.env[variable];
				} else {
					process.env[variable] = original;
				}
				await rm(cwd, { recursive: true, force: true });
			}
		});
	},
);
