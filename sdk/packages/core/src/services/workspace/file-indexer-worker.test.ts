import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// The key FileIndexWorkerClient stamps into workerData so that only its own
// worker serves index requests. Kept in sync with file-indexer.ts.
const WORKER_FLAG = "clineFileIndexWorker";

type FakePort = EventEmitter & { postMessage: ReturnType<typeof vi.fn> };

function createParentPort(): FakePort {
	const port = new EventEmitter() as FakePort;
	port.postMessage = vi.fn();
	return port;
}

async function importIndexerInWorker(
	port: FakePort,
	workerData: unknown,
): Promise<void> {
	vi.resetModules();
	vi.doMock("node:worker_threads", async () => {
		const actual = await vi.importActual<typeof import("node:worker_threads")>(
			"node:worker_threads",
		);
		return { ...actual, isMainThread: false, parentPort: port, workerData };
	});
	await import("./file-indexer");
	vi.doUnmock("node:worker_threads");
}

async function waitForPostMessage(port: FakePort): Promise<void> {
	await vi.waitFor(() => {
		expect(port.postMessage).toHaveBeenCalled();
	});
}

afterEach(() => {
	vi.resetModules();
});

describe("file index worker server", () => {
	it("leaves the parentPort of a host application's own worker alone", async () => {
		const port = createParentPort();
		await importIndexerInWorker(port, undefined);
		expect(port.listenerCount("message")).toBe(0);
	});

	it("answers index requests in the worker spawned by FileIndexWorkerClient", async () => {
		const port = createParentPort();
		await importIndexerInWorker(port, { [WORKER_FLAG]: true });
		expect(port.listenerCount("message")).toBe(1);

		const cwd = await mkdtemp(path.join(os.tmpdir(), "core-index-worker-"));
		try {
			await mkdir(path.join(cwd, "src"), { recursive: true });
			await writeFile(path.join(cwd, "src", "a.ts"), "export {}\n", "utf8");
			port.emit("message", { type: "index", requestId: 1, cwd });
			await waitForPostMessage(port);
			const response = port.postMessage.mock.calls[0]![0] as {
				type: string;
				requestId: number;
				files?: string[];
				error?: string;
			};
			expect(response.type).toBe("indexResult");
			expect(response.requestId).toBe(1);
			expect(response.error).toBeUndefined();
			expect(response.files).toContain("src/a.ts");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("ignores foreign and null messages without replying or throwing", async () => {
		const port = createParentPort();
		await importIndexerInWorker(port, { [WORKER_FLAG]: true });
		expect(port.listenerCount("message")).toBe(1);
		expect(() => {
			port.emit("message", null);
			port.emit("message", "hello");
			port.emit("message", { type: "host-app-event" });
		}).not.toThrow();
		await new Promise((resolve) => setImmediate(resolve));
		expect(port.postMessage).not.toHaveBeenCalled();
	});
});
