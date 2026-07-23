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

	it("returns undefined when a non-npx command has only a .cmd shim", () => {
		expect(
			resolveShellFreeInvocation("uv", ["run"], {
				platform: "win32",
				env: { Path: "C:\\Tools" },
				execPath: "C:\\Apps\\cline.exe",
				fileExists: (path) => path === "C:\\Tools\\uv.cmd",
			}),
		).toBeUndefined();
	});
});
