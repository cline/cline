import { describe, expect, it } from "vitest";
import {
	buildSubprocessSandboxCommand,
	CLINE_JS_RUNTIME_PATH_ENV,
	resolveSubprocessRuntimeExecutable,
	subprocessRuntimeNeedsBunBeBun,
} from "./subprocess-sandbox";

describe("SubprocessSandbox runtime resolution", () => {
	it("uses process execPath when it is a JavaScript runtime", () => {
		expect(
			resolveSubprocessRuntimeExecutable({
				execPath: "/usr/local/bin/bun",
				env: {},
			}),
		).toBe("/usr/local/bin/bun");
		expect(
			resolveSubprocessRuntimeExecutable({
				execPath: "/usr/local/bin/node",
				env: {},
			}),
		).toBe("/usr/local/bin/node");
	});

	it("does not reuse packaged CLI binaries as helper runtimes", () => {
		expect(
			resolveSubprocessRuntimeExecutable({
				execPath: "/usr/local/bin/cline",
				env: {},
			}),
		).toBe("node");
	});

	it("self-execs via BUN_BE_BUN only for the current compiled Bun binary", () => {
		// A foreign packaged binary (not this process) must never be treated
		// as a runtime, regardless of the host runtime.
		expect(subprocessRuntimeNeedsBunBeBun("/usr/local/bin/cline")).toBe(false);
		// Plain runtimes never need the flag.
		expect(subprocessRuntimeNeedsBunBeBun("/usr/local/bin/bun")).toBe(false);
		expect(subprocessRuntimeNeedsBunBeBun("/usr/local/bin/node")).toBe(false);
		// process.execPath in tests is a real bun/node binary, so even the
		// self path does not need the flag here; compiled-binary behavior is
		// covered by desktop-app integration testing.
		expect(subprocessRuntimeNeedsBunBeBun(process.execPath)).toBe(false);
	});

	it("allows an explicit helper runtime override", () => {
		expect(
			resolveSubprocessRuntimeExecutable({
				execPath: "/usr/local/bin/cline",
				env: { [CLINE_JS_RUNTIME_PATH_ENV]: "/opt/runtime/js" },
			}),
		).toBe("/opt/runtime/js");
	});

	it("uses known runtime env vars when execPath is not a runtime", () => {
		expect(
			resolveSubprocessRuntimeExecutable({
				execPath: "/usr/local/bin/cline",
				env: { BUN_EXEC_PATH: "/Users/me/.bun/bin/bun" },
			}),
		).toBe("/Users/me/.bun/bin/bun");
		expect(
			resolveSubprocessRuntimeExecutable({
				execPath: "/usr/local/bin/cline",
				env: { npm_node_execpath: "/opt/node/bin/node" },
			}),
		).toBe("/opt/node/bin/node");
	});

	it("builds plugin sandbox commands with the resolved runtime", () => {
		expect(
			buildSubprocessSandboxCommand(["-e", "console.log('ok')"], {
				execPath: "/usr/local/bin/cline",
				env: { CLINE_BUILD_ENV: "production" },
				name: "plugin-sandbox",
			}),
		).toEqual(["node", "-e", "console.log('ok')"]);
	});

	it("preserves development debugging flags for resolved runtimes", () => {
		expect(
			buildSubprocessSandboxCommand(["bootstrap.js"], {
				execPath: "/usr/local/bin/cline",
				env: { CLINE_BUILD_ENV: "development" },
				name: "plugin-sandbox",
			}),
		).toEqual([
			"node",
			"--inspect=127.0.0.1:0",
			"--enable-source-maps",
			"bootstrap.js",
		]);
	});
});
