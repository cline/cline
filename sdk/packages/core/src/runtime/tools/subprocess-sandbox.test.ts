import { describe, expect, it } from "vitest";
import {
	buildSubprocessSandboxCommand,
	CLINE_JS_RUNTIME_PATH_ENV,
	resolveSubprocessRuntimeExecutable,
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
				execPath: "/usr/local/bin/clite",
				env: {},
			}),
		).toBe("node");
	});

	it("allows an explicit helper runtime override", () => {
		expect(
			resolveSubprocessRuntimeExecutable({
				execPath: "/usr/local/bin/clite",
				env: { [CLINE_JS_RUNTIME_PATH_ENV]: "/opt/runtime/js" },
			}),
		).toBe("/opt/runtime/js");
	});

	it("uses known runtime env vars when execPath is not a runtime", () => {
		expect(
			resolveSubprocessRuntimeExecutable({
				execPath: "/usr/local/bin/clite",
				env: { BUN_EXEC_PATH: "/Users/me/.bun/bin/bun" },
			}),
		).toBe("/Users/me/.bun/bin/bun");
		expect(
			resolveSubprocessRuntimeExecutable({
				execPath: "/usr/local/bin/clite",
				env: { npm_node_execpath: "/opt/node/bin/node" },
			}),
		).toBe("/opt/node/bin/node");
	});

	it("builds plugin sandbox commands with the resolved runtime", () => {
		expect(
			buildSubprocessSandboxCommand(["-e", "console.log('ok')"], {
				execPath: "/usr/local/bin/clite",
				env: { CLINE_BUILD_ENV: "production" },
				name: "plugin-sandbox",
			}),
		).toEqual(["node", "-e", "console.log('ok')"]);
	});

	it("preserves development debugging flags for resolved runtimes", () => {
		expect(
			buildSubprocessSandboxCommand(["bootstrap.js"], {
				execPath: "/usr/local/bin/clite",
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
