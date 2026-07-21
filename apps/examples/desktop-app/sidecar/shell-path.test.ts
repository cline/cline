import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	defaultShellFor,
	ensureLoginShellPath,
	extractMarkedPath,
	mergePaths,
	resolveLoginShellPath,
} from "./shell-path";

const MARKER_START = "__CLINE_SIDECAR_PATH_START__";
const MARKER_END = "__CLINE_SIDECAR_PATH_END__";

let tempDirs: string[] = [];

function writeFakeShell(script: string): string {
	const dir = mkdtempSync(join(tmpdir(), "cline-shell-path-"));
	tempDirs.push(dir);
	const shellPath = join(dir, "fake-shell");
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

describe("resolveLoginShellPath", () => {
	it("captures PATH from the shell", async () => {
		// The fake shell ignores the -ilc flags and evaluates the command
		// with a controlled PATH, mimicking a login shell whose profile
		// prepends Homebrew.
		const shell = writeFakeShell(
			'PATH="/opt/homebrew/bin:/usr/bin"; eval "$2"',
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
});

describe("ensureLoginShellPath", () => {
	it("merges the login shell PATH into env.PATH", async () => {
		const shell = writeFakeShell(
			'PATH="/opt/homebrew/bin:/usr/bin"; eval "$2"',
		);
		const env: NodeJS.ProcessEnv = {
			SHELL: shell,
			PATH: "/usr/bin:/bin",
		};
		const result = await ensureLoginShellPath({ platform: "darwin", env });
		expect(result.status).toBe("applied");
		expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin:/bin");
	});

	it("leaves PATH untouched when resolution fails", async () => {
		const env: NodeJS.ProcessEnv = {
			SHELL: "/nonexistent/shell",
			PATH: "/usr/bin",
		};
		const result = await ensureLoginShellPath({ platform: "darwin", env });
		expect(result.status).toBe("failed");
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

	it("resolves against a real shell end to end", async () => {
		const env: NodeJS.ProcessEnv = { SHELL: "/bin/sh", PATH: "/bin" };
		const result = await ensureLoginShellPath({ platform: "linux", env });
		expect(result.status).toBe("applied");
		expect(env.PATH).toContain("/bin");
	});
});
