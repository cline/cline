import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	defaultShellFor,
	ensureLoginShellPath,
	extractMarkedPath,
	loginShellFor,
	mergePaths,
	resolveLoginShellPath,
	shellInvocationArgs,
} from "./shell-path";

const MARKER_START = "__CLINE_SIDECAR_PATH_START__";
const MARKER_END = "__CLINE_SIDECAR_PATH_END__";

let tempDirs: string[] = [];

/**
 * Fake login shell: a /bin/sh script invoked as `fake-shell -i -l -c <cmd>`,
 * so the command to run arrives as $4. The default body mimics a login shell
 * whose profile prepends Homebrew before running the command.
 */
function writeFakeShell(
	script = 'PATH="/opt/homebrew/bin:/usr/bin"; eval "$4"',
	name = "fake-shell",
): string {
	const dir = mkdtempSync(join(tmpdir(), "cline-shell-path-"));
	tempDirs.push(dir);
	const shellPath = join(dir, name);
	writeFileSync(shellPath, `#!/bin/sh\n${script}\n`);
	chmodSync(shellPath, 0o755);
	return shellPath;
}

afterEach(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tempDirs = [];
});

describe("extractMarkedPath", () => {
	it("extracts the PATH between markers", () => {
		expect(
			extractMarkedPath(
				`${MARKER_START}/opt/homebrew/bin:/usr/bin${MARKER_END}`,
			),
		).toBe("/opt/homebrew/bin:/usr/bin");
	});

	it("ignores shell profile noise around the markers", () => {
		const output = `Welcome!\nsome banner\n${MARKER_START}/usr/local/bin${MARKER_END}\ntrailing noise`;
		expect(extractMarkedPath(output)).toBe("/usr/local/bin");
	});

	it("returns undefined when markers are missing or empty", () => {
		expect(extractMarkedPath("no markers here")).toBeUndefined();
		expect(extractMarkedPath(`${MARKER_START}${MARKER_END}`)).toBeUndefined();
		expect(extractMarkedPath(`${MARKER_START}/usr/bin`)).toBeUndefined();
	});
});

describe("mergePaths", () => {
	it("puts shell entries first and keeps current-only entries", () => {
		expect(
			mergePaths(
				"/opt/homebrew/bin:/usr/bin:/bin",
				"/usr/bin:/bin:/custom/bin",
			),
		).toBe("/opt/homebrew/bin:/usr/bin:/bin:/custom/bin");
	});

	it("drops duplicate and empty entries", () => {
		expect(mergePaths("/a::/b:/a", "/b:/c:")).toBe("/a:/b:/c");
	});
});

describe("defaultShellFor", () => {
	it("uses zsh on macOS and bash elsewhere", () => {
		expect(defaultShellFor("darwin")).toBe("/bin/zsh");
		expect(defaultShellFor("linux")).toBe("/bin/bash");
	});
});

describe("loginShellFor", () => {
	it("returns the passwd-database shell when one exists", () => {
		// The test runner's uid has a passwd entry, so $SHELL must lose.
		const shell = loginShellFor(process.platform, {
			SHELL: "/env/should-not-win",
		});
		expect(shell.startsWith("/")).toBe(true);
		expect(shell).not.toBe("/env/should-not-win");
	});
});

describe("shellInvocationArgs", () => {
	it("uses separate login+interactive flags for posix-style shells", () => {
		expect(shellInvocationArgs("/bin/zsh", "cmd")).toEqual([
			"-i",
			"-l",
			"-c",
			"cmd",
		]);
		expect(shellInvocationArgs("/opt/homebrew/bin/fish", "cmd")).toEqual([
			"-i",
			"-l",
			"-c",
			"cmd",
		]);
	});

	it("uses only -c for csh-family shells (-l must be the sole flag there)", () => {
		expect(shellInvocationArgs("/bin/tcsh", "cmd")).toEqual(["-c", "cmd"]);
		expect(shellInvocationArgs("/bin/csh", "cmd")).toEqual(["-c", "cmd"]);
	});
});

describe("resolveLoginShellPath", () => {
	it("captures PATH from the shell", async () => {
		const shell = writeFakeShell();
		await expect(resolveLoginShellPath(shell)).resolves.toBe(
			"/opt/homebrew/bin:/usr/bin",
		);
	});

	it("reads PATH from the environment, not the shell's own expansion", async () => {
		// Mimics fish: its "$PATH" expansion would space-join the entries,
		// but the printf runs inside /bin/sh, which reads the exported
		// colon-delimited PATH env var — so the shell's expansion rules
		// never apply. This fake shell never evals the command text; it
		// only exports PATH and runs the command via sh, like fish would.
		const shell = writeFakeShell(
			'PATH="/opt/homebrew/bin:/usr/bin"; export PATH; /bin/sh -c "$4"',
		);
		await expect(resolveLoginShellPath(shell)).resolves.toBe(
			"/opt/homebrew/bin:/usr/bin",
		);
	});

	it("resolves undefined when the shell prints garbage", async () => {
		const shell = writeFakeShell('echo "no markers"');
		await expect(resolveLoginShellPath(shell)).resolves.toBeUndefined();
	});

	it("resolves undefined when the shell is missing", async () => {
		await expect(
			resolveLoginShellPath("/nonexistent/shell"),
		).resolves.toBeUndefined();
	});

	it("times out hung shells without rejecting", async () => {
		const shell = writeFakeShell("sleep 60");
		await expect(resolveLoginShellPath(shell, 200)).resolves.toBeUndefined();
	});

	it("invokes csh-family shells without login/interactive flags", async () => {
		// A csh stand-in that rejects any first flag other than -c.
		const shell = writeFakeShell(
			'[ "$1" = "-c" ] || exit 64; PATH="/opt/homebrew/bin:/usr/bin"; eval "$2"',
			"tcsh",
		);
		await expect(resolveLoginShellPath(shell)).resolves.toBe(
			"/opt/homebrew/bin:/usr/bin",
		);
	});
});

describe("ensureLoginShellPath", () => {
	it("merges the login shell PATH into env.PATH", async () => {
		const shell = writeFakeShell();
		const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
		const result = await ensureLoginShellPath({
			platform: "darwin",
			env,
			userShell: shell,
		});
		expect(result).toEqual({
			status: "applied",
			pathEntries: 3,
			shell,
		});
		expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin:/bin");
	});

	it("falls back to the default shell when $SHELL can't resolve", async () => {
		const fallbackShell = writeFakeShell();
		const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
		const result = await ensureLoginShellPath({
			platform: "darwin",
			env,
			userShell: "/nonexistent/shell",
			fallbackShell,
		});
		expect(result.status).toBe("applied");
		expect(result).toMatchObject({ shell: fallbackShell });
		expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin");
	});

	it("leaves PATH untouched when every shell fails", async () => {
		const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
		const result = await ensureLoginShellPath({
			platform: "darwin",
			env,
			userShell: "/nonexistent/shell",
			fallbackShell: "/nonexistent/other-shell",
		});
		expect(result).toEqual({ status: "failed", shell: "/nonexistent/shell" });
		expect(env.PATH).toBe("/usr/bin");
	});

	it("skips on windows", async () => {
		const env: NodeJS.ProcessEnv = { PATH: "C:\\Windows" };
		const result = await ensureLoginShellPath({ platform: "win32", env });
		expect(result).toEqual({ status: "skipped", reason: "windows" });
	});

	it("skips when the escape hatch is set", async () => {
		const env: NodeJS.ProcessEnv = {
			PATH: "/usr/bin",
			CLINE_SIDECAR_SKIP_SHELL_PATH: "1",
		};
		const result = await ensureLoginShellPath({ platform: "darwin", env });
		expect(result.status).toBe("skipped");
		expect(env.PATH).toBe("/usr/bin");
	});

	it("never exposes the resolved PATH in its result", async () => {
		const shell = writeFakeShell();
		const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
		const result = await ensureLoginShellPath({
			platform: "darwin",
			env,
			userShell: shell,
		});
		expect(JSON.stringify(result)).not.toContain("/opt/homebrew/bin");
	});

	it("resolves against a real shell end to end", async () => {
		const env: NodeJS.ProcessEnv = { PATH: "/bin" };
		const result = await ensureLoginShellPath({
			platform: "linux",
			env,
			userShell: "/bin/sh",
		});
		expect(result.status).toBe("applied");
		expect(env.PATH).toContain("/bin");
	});
});
