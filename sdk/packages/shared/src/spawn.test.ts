import { describe, expect, it } from "vitest";
import {
	resolveNpxInvocation,
	resolveShellFreeInvocation,
	resolveWindowsExecutable,
} from "./spawn";

describe("resolveNpxInvocation", () => {
	it("keeps forwarded arguments out of a shell on non-Windows platforms", () => {
		expect(
			resolveNpxInvocation(
				["-y", "skills@latest", "add", "repo; touch /tmp/pwned"],
				{
					platform: "linux",
				},
			),
		).toEqual({
			command: "npx",
			args: ["-y", "skills@latest", "add", "repo; touch /tmp/pwned"],
		});
	});

	it("runs npm's npx CLI through node.exe on Windows", () => {
		const nodePath = "C:\\Program Files\\nodejs\\node.exe";
		const npxCliPath =
			"C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js";
		const existingFiles = new Set([nodePath, npxCliPath]);
		const injectedArg = "owner/repo & echo INJECTED";

		expect(
			resolveNpxInvocation(["-y", "skills@latest", "add", injectedArg], {
				platform: "win32",
				env: { Path: '"C:\\Program Files\\nodejs";C:\\Tools' },
				execPath: "C:\\Apps\\cline.exe",
				fileExists: (path) => existingFiles.has(path),
			}),
		).toEqual({
			command: nodePath,
			args: [npxCliPath, "-y", "skills@latest", "add", injectedArg],
		});
	});

	it("preserves an npm semver-range argument as a single argv element", () => {
		const nodePath = "C:\\Program Files\\nodejs\\node.exe";
		const npxCliPath =
			"C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js";
		const existingFiles = new Set([nodePath, npxCliPath]);

		const invocation = resolveNpxInvocation(["-y", "mongodb-mcp-server@<3"], {
			platform: "win32",
			env: { Path: "C:\\Program Files\\nodejs" },
			execPath: "C:\\Apps\\cline.exe",
			fileExists: (path) => existingFiles.has(path),
		});

		expect(invocation?.args).toContain("mongodb-mcp-server@<3");
	});

	it("uses a native npx.exe shim on Windows when one is available", () => {
		const npxPath = "C:\\Tools\\npx.exe";
		expect(
			resolveNpxInvocation(["--version"], {
				platform: "win32",
				env: { Path: "C:\\Tools" },
				execPath: "C:\\Apps\\cline.exe",
				fileExists: (path) => path === npxPath,
			}),
		).toEqual({ command: npxPath, args: ["--version"] });
	});

	it("fails safely when Windows only exposes an unsafe command shim", () => {
		expect(
			resolveNpxInvocation(["list"], {
				platform: "win32",
				env: { Path: "C:\\Tools" },
				execPath: "C:\\Apps\\cline.exe",
				fileExists: (path) => path === "C:\\Tools\\npx.cmd",
			}),
		).toBeUndefined();
	});
});

describe("resolveWindowsExecutable", () => {
	const options = {
		env: { Path: "C:\\Tools;C:\\Other" },
		execPath: "C:\\Apps\\cline.exe",
	};

	it("finds a bare command as a .exe on PATH", () => {
		expect(
			resolveWindowsExecutable("uv", {
				...options,
				fileExists: (path) => path === "C:\\Other\\uv.exe",
			}),
		).toBe("C:\\Other\\uv.exe");
	});

	it("returns undefined when only a .cmd shim exists", () => {
		expect(
			resolveWindowsExecutable("uv", {
				...options,
				fileExists: (path) => path === "C:\\Tools\\uv.cmd",
			}),
		).toBeUndefined();
	});

	it("honors PATH order", () => {
		expect(
			resolveWindowsExecutable("uv", {
				...options,
				fileExists: (path) =>
					path === "C:\\Tools\\uv.exe" || path === "C:\\Other\\uv.exe",
			}),
		).toBe("C:\\Tools\\uv.exe");
	});

	it("accepts an already-qualified absolute path", () => {
		expect(
			resolveWindowsExecutable("C:\\bin\\tool.exe", {
				...options,
				fileExists: (path) => path === "C:\\bin\\tool.exe",
			}),
		).toBe("C:\\bin\\tool.exe");
	});

	it("rejects an explicit .cmd/.bat path (still needs a shell)", () => {
		for (const shim of ["C:\\bin\\tool.cmd", "C:\\bin\\tool.bat"]) {
			expect(
				resolveWindowsExecutable(shim, {
					...options,
					fileExists: (path) => path === shim,
				}),
			).toBeUndefined();
		}
	});

	it("accepts an explicit extensionless executable path", () => {
		expect(
			resolveWindowsExecutable("C:\\bin\\tool", {
				...options,
				fileExists: (path) => path === "C:\\bin\\tool",
			}),
		).toBe("C:\\bin\\tool");
	});
});

describe("resolveShellFreeInvocation", () => {
	it("passes any command through unchanged on non-Windows", () => {
		expect(
			resolveShellFreeInvocation("uv", ["run", "ramp-mcp", "-s", "<scopes>"], {
				platform: "linux",
			}),
		).toEqual({
			command: "uv",
			args: ["run", "ramp-mcp", "-s", "<scopes>"],
		});
	});

	it("routes npx through npm's Node CLI on Windows", () => {
		const nodePath = "C:\\Program Files\\nodejs\\node.exe";
		const npxCliPath =
			"C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js";
		const existingFiles = new Set([nodePath, npxCliPath]);

		expect(
			resolveShellFreeInvocation("npx", ["-y", "mongodb-mcp-server@<3"], {
				platform: "win32",
				env: { Path: "C:\\Program Files\\nodejs" },
				execPath: "C:\\Apps\\cline.exe",
				fileExists: (path) => existingFiles.has(path),
			}),
		).toEqual({
			command: nodePath,
			args: [npxCliPath, "-y", "mongodb-mcp-server@<3"],
		});
	});

	it("resolves a non-npx command to a .exe and keeps args literal", () => {
		expect(
			resolveShellFreeInvocation("uv", ["run", "ramp-mcp", "-s", "<scopes>"], {
				platform: "win32",
				env: { Path: "C:\\Tools" },
				execPath: "C:\\Apps\\cline.exe",
				fileExists: (path) => path === "C:\\Tools\\uv.exe",
			}),
		).toEqual({
			command: "C:\\Tools\\uv.exe",
			args: ["run", "ramp-mcp", "-s", "<scopes>"],
		});
	});

	it("returns undefined when a non-npx command has only a non-npm .cmd shim", () => {
		expect(
			resolveShellFreeInvocation("uv", ["run"], {
				platform: "win32",
				env: { Path: "C:\\Tools" },
				execPath: "C:\\Apps\\cline.exe",
				// A .cmd that is not an npm-generated node shim: no rewrite possible.
				fileExists: (path) => path === "C:\\Tools\\uv.cmd",
				readTextFile: () => "@echo off\r\nuv-native %*\r\n",
			}),
		).toBeUndefined();
	});

	// Verbatim body of an npm-global `cline.cmd` (node.exe not beside the shim).
	const CLINE_CMD = [
		"@ECHO off",
		"GOTO start",
		":find_dp0",
		"SET dp0=%~dp0",
		"EXIT /b",
		":start",
		"SETLOCAL",
		"CALL :find_dp0",
		'IF EXIST "%dp0%\\node.exe" (',
		'  SET "_prog=%dp0%\\node.exe"',
		") ELSE (",
		'  SET "_prog=node"',
		"  SET PATHEXT=%PATHEXT:;.JS;=;%",
		")",
		'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\cline\\bin\\cline" %*',
	].join("\r\n");

	it("rewrites an npm-global cline.cmd shim to node + its bin script", () => {
		const nodePath = "C:\\Program Files\\nodejs\\node.exe";
		const shimPath = "C:\\Users\\me\\AppData\\Roaming\\npm\\cline.cmd";
		const scriptPath =
			"C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\cline\\bin\\cline";
		const existing = new Set([nodePath, shimPath, scriptPath]);

		expect(
			resolveShellFreeInvocation("cline", ["mcp", "install", "mongodb"], {
				platform: "win32",
				env: {
					Path: "C:\\Program Files\\nodejs;C:\\Users\\me\\AppData\\Roaming\\npm",
				},
				execPath: "C:\\Apps\\host.exe",
				fileExists: (path) => existing.has(path),
				readTextFile: () => CLINE_CMD,
			}),
		).toEqual({
			command: nodePath,
			args: [scriptPath, "mcp", "install", "mongodb"],
		});
	});

	// npm bin-linking shim for a package's CLI, node.exe beside the shim
	// (the `%~dp0`-relative layout, as under a Node install's node_modules/.bin).
	const TOOL_CMD = [
		"@ECHO off",
		"GOTO start",
		":find_dp0",
		"SET dp0=%~dp0",
		"EXIT /b",
		":start",
		"SETLOCAL",
		"CALL :find_dp0",
		'IF EXIST "%dp0%\\node.exe" (',
		'  SET "_prog=%dp0%\\node.exe"',
		") ELSE (",
		'  SET "_prog=node"',
		")",
		'"%_prog%"  "%dp0%\\node_modules\\some-tool\\cli.js" %*',
	].join("\r\n");

	it("rewrites a generic npm .cmd shim to node + its script", () => {
		const dir = "C:\\Program Files\\nodejs";
		const nodePath = `${dir}\\node.exe`;
		const shimPath = `${dir}\\some-tool.cmd`;
		const scriptPath = `${dir}\\node_modules\\some-tool\\cli.js`;
		const existing = new Set([nodePath, shimPath, scriptPath]);

		expect(
			resolveShellFreeInvocation("some-tool", ["run", "arg<1"], {
				platform: "win32",
				env: { Path: dir },
				execPath: "C:\\Apps\\host.exe",
				fileExists: (path) => existing.has(path),
				readTextFile: () => TOOL_CMD,
			}),
		).toEqual({
			command: nodePath,
			args: [scriptPath, "run", "arg<1"],
		});
	});

	it("returns undefined for an explicit non-npm .cmd path so callers keep a shell", () => {
		// An MCP config that names an explicit `.cmd` that is not an npm shim
		// must not be treated as shell-free; the caller falls back to a shell.
		expect(
			resolveShellFreeInvocation("C:\\tools\\server.cmd", ["--port", "1<2"], {
				platform: "win32",
				env: { Path: "C:\\tools" },
				execPath: "C:\\Apps\\host.exe",
				fileExists: (path) => path === "C:\\tools\\server.cmd",
				readTextFile: () => "@echo off\r\nserver-native %*\r\n",
			}),
		).toBeUndefined();
	});

	it("rewrites an explicit npm .cmd shim path to node + its script", () => {
		const dir = "C:\\Program Files\\nodejs";
		const nodePath = `${dir}\\node.exe`;
		const shimPath = `${dir}\\some-tool.cmd`;
		const scriptPath = `${dir}\\node_modules\\some-tool\\cli.js`;
		const existing = new Set([nodePath, shimPath, scriptPath]);

		expect(
			resolveShellFreeInvocation(shimPath, ["run"], {
				platform: "win32",
				env: { Path: dir },
				execPath: "C:\\Apps\\host.exe",
				fileExists: (path) => existing.has(path),
				readTextFile: () => TOOL_CMD,
			}),
		).toEqual({
			command: nodePath,
			args: [scriptPath, "run"],
		});
	});
});
