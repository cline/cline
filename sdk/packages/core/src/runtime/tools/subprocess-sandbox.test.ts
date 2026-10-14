import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildSubprocessSandboxCommand,
	CLINE_JS_RUNTIME_PATH_ENV,
	resolveSubprocessRuntimeExecutable,
	SubprocessSandbox,
} from "./subprocess-sandbox";

const lifecycleBootstrapScript = [
	"const generation = process.pid + ':' + Date.now() + ':' + Math.random();",
	"let held;",
	"process.on('message', (m) => {",
	"  if (!m || m.type !== 'call') return;",
	"  if (m.method === 'hold') { held = m; return; }",
	"  const respond = (request) => process.send({ type: 'response', id: request.id, ok: true, result: { pid: process.pid, generation } });",
	"  if (m.method === 'release') {",
	"    if (held) { respond(held); held = undefined; }",
	"    respond(m);",
	"    return;",
	"  }",
	"  respond(m);",
	"});",
].join("\n");

afterEach(() => {
	vi.useRealTimers();
});

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

describe("SubprocessSandbox idle lifecycle", () => {
	it("reclaims every child across multiple idle sandboxes", async () => {
		vi.useFakeTimers();
		const sandboxes = Array.from(
			{ length: 4 },
			(_, index) =>
				new SubprocessSandbox({
					name: `sandbox-idle-population-${index}`,
					bootstrapScript: lifecycleBootstrapScript,
					idleTimeoutMs: 1000,
				}),
		);

		try {
			const firstGeneration = await Promise.all(
				sandboxes.map((sandbox) =>
					sandbox.call<{ generation: string }>("pid", {}),
				),
			);

			await vi.advanceTimersByTimeAsync(1001);

			const secondGeneration = await Promise.all(
				sandboxes.map((sandbox) =>
					sandbox.call<{ generation: string }>("pid", {}),
				),
			);
			for (const [index, current] of secondGeneration.entries()) {
				expect(current.generation).not.toBe(firstGeneration[index]?.generation);
			}
		} finally {
			vi.useRealTimers();
			await Promise.all(sandboxes.map((sandbox) => sandbox.shutdown()));
		}
	}, 20_000);

	it("shuts down an idle child and transparently starts a new generation", async () => {
		vi.useFakeTimers();
		const sandbox = new SubprocessSandbox({
			name: "sandbox-idle-test",
			bootstrapScript: lifecycleBootstrapScript,
			idleTimeoutMs: 1000,
		});

		try {
			const first = await sandbox.call<{
				pid: number;
				generation: string;
			}>("pid", {});

			await vi.advanceTimersByTimeAsync(1001);

			const second = await sandbox.call<{ generation: string }>("pid", {});
			expect(second.generation).not.toBe(first.generation);
		} finally {
			vi.useRealTimers();
			await sandbox.shutdown();
		}
	}, 20_000);

	it("does not shut down while calls are pending", async () => {
		vi.useFakeTimers();
		const sandbox = new SubprocessSandbox({
			name: "sandbox-pending-idle-test",
			bootstrapScript: lifecycleBootstrapScript,
			idleTimeoutMs: 1000,
		});

		try {
			const initial = await sandbox.call<{ pid: number }>("pid", {});
			const heldCall = sandbox.call<{ pid: number }>("hold", {});

			await vi.advanceTimersByTimeAsync(5000);

			const release = await sandbox.call<{ pid: number }>("release", {});
			await expect(heldCall).resolves.toMatchObject({ pid: initial.pid });
			expect(release.pid).toBe(initial.pid);
		} finally {
			vi.useRealTimers();
			await sandbox.shutdown();
		}
	}, 20_000);
});
