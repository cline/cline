import { afterEach, describe, expect, it } from "vitest";
import { WorkerSandbox } from "./worker-sandbox";

// Echoes call args back, and reports ready only after a delay so calls made
// right after start() sit in the host's queue.
const delayedReadyBootstrap = [
	"const { parentPort } = require('node:worker_threads');",
	"setTimeout(() => {",
	"  parentPort.on('message', (m) => {",
	"    if (!m || m.type !== 'call') return;",
	"    parentPort.postMessage({ type: 'response', id: m.id, ok: true, result: m.args });",
	"  });",
	"  parentPort.postMessage({ type: 'ready' });",
	"}, 100);",
].join("\n");

const sandboxes: WorkerSandbox[] = [];

function createSandbox(): WorkerSandbox {
	const sandbox = new WorkerSandbox({
		bootstrapScript: delayedReadyBootstrap,
	});
	sandboxes.push(sandbox);
	return sandbox;
}

afterEach(async () => {
	await Promise.all(sandboxes.splice(0).map((sandbox) => sandbox.shutdown()));
});

describe("WorkerSandbox", () => {
	it("sends calls made before ready once the worker listens", async () => {
		const sandbox = createSandbox();
		await expect(
			Promise.all([
				sandbox.call("echo", { n: 1 }),
				sandbox.call("echo", { n: 2 }),
			]),
		).resolves.toEqual([{ n: 1 }, { n: 2 }]);
	});

	it("sends queued args as they were at call time", async () => {
		const sandbox = createSandbox();
		const args: Record<string, unknown> = { value: "original" };
		const result = sandbox.call("echo", args);
		args.value = "changed";
		// Uncloneable once queued: must not throw when the queue flushes.
		args.fn = () => 1;
		await expect(result).resolves.toEqual({ value: "original" });
	});

	it("rejects an uncloneable call before it is queued", async () => {
		const sandbox = createSandbox();
		await expect(sandbox.call("echo", { fn: () => 1 })).rejects.toThrow(
			/clone/i,
		);
		await expect(sandbox.call("echo", { ok: true })).resolves.toEqual({
			ok: true,
		});
	});

	it("does not send a queued call that timed out before ready", async () => {
		const sandbox = createSandbox();
		await expect(
			sandbox.call("echo", { late: true }, { timeoutMs: 20 }),
		).rejects.toThrow(/timed out/);
		// The timeout terminated that worker; a new call starts a fresh one.
		await expect(sandbox.call("echo", { n: 3 })).resolves.toEqual({ n: 3 });
	});

	it("runs the dispose method before an idle stop, and later calls get a fresh worker", async () => {
		const sandbox = new WorkerSandbox({
			bootstrapScript: [
				"const { parentPort, threadId } = require('node:worker_threads');",
				"parentPort.on('message', (m) => {",
				"  if (!m || m.type !== 'call') return;",
				"  if (m.method === 'dispose') parentPort.postMessage({ type: 'event', name: 'disposed', payload: threadId });",
				"  parentPort.postMessage({ type: 'response', id: m.id, ok: true, result: threadId });",
				"});",
				"parentPort.postMessage({ type: 'ready' });",
			].join("\n"),
			idleTimeoutMs: 100,
			disposeMethod: "dispose",
			disposeTimeoutMs: 1_000,
			onEvent: (event) => disposed.push(event.payload as number),
		});
		const disposed: number[] = [];
		sandboxes.push(sandbox);
		const first = await sandbox.call<number>("echo", {});
		await expect.poll(() => disposed).toEqual([first]);
		const second = await sandbox.call<number>("echo", {});
		expect(second).not.toBe(first);
		await sandbox.shutdown();
		expect(disposed).toEqual([first, second]);
	});

	it("does not report an exit during cleanup as a crash", async () => {
		const unexpected: Error[] = [];
		const sandbox = new WorkerSandbox({
			bootstrapScript: [
				"const { parentPort } = require('node:worker_threads');",
				"parentPort.on('message', (m) => {",
				"  if (!m || m.type !== 'call') return;",
				"  if (m.method === 'dispose') process.exit(3);",
				"  parentPort.postMessage({ type: 'response', id: m.id, ok: true, result: 'ok' });",
				"});",
				"parentPort.postMessage({ type: 'ready' });",
			].join("\n"),
			disposeMethod: "dispose",
			disposeTimeoutMs: 1_000,
			onUnexpectedExit: (error) => unexpected.push(error),
		});
		sandboxes.push(sandbox);
		await expect(sandbox.call("echo", {})).resolves.toBe("ok");
		await sandbox.shutdown();
		expect(unexpected).toEqual([]);
	});
});
