import { describe, expect, it } from "vitest";
import {
	buildSubprocessSandboxCommand,
	CLINE_JS_RUNTIME_PATH_ENV,
	resolveSubprocessRuntimeExecutable,
	SubprocessSandbox,
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

describe("SubprocessSandbox call", () => {
	it("rejects non-serializable payloads without arming the timeout shutdown", async () => {
		const sandbox = new SubprocessSandbox({
			name: "sandbox-serialization-test",
			// Echo server; the "slow" method answers after a delay so a call can
			// be held in flight while the failed send's timeout window elapses.
			bootstrapScript: [
				"process.on('message', (m) => {",
				"  if (!m || m.type !== 'call') return;",
				"  const reply = () => process.send({ type: 'response', id: m.id, ok: true, result: m.args });",
				"  if (m.method === 'slow') { setTimeout(reply, 800); } else { reply(); }",
				"});",
			].join("\n"),
		});
		try {
			const cyclic: Record<string, unknown> = {};
			cyclic.self = cyclic;

			const slowCall = sandbox.call("slow", { ok: true }, { timeoutMs: 5000 });

			// send() throws synchronously for cyclic payloads. Before the fix the
			// pending timeout timer survived the rejection and fired ~250 ms
			// later, shutting the sandbox down and killing the in-flight slow
			// call above.
			await expect(
				sandbox.call("echo", cyclic, { timeoutMs: 250 }),
			).rejects.toThrow(/cyclic|circular/i);

			await expect(slowCall).resolves.toEqual({ ok: true });
		} finally {
			await sandbox.shutdown();
		}
	}, 20_000);
});
