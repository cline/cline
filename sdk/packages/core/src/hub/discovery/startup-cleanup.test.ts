import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { probeHubServer, withHubStartupLock } from ".";

it("cancels a lock waiter without removing the active owner's lock", async () => {
	const dir = await mkdtemp(join(tmpdir(), "hub-cleanup-"));
	const path = join(dir, "discovery.json");
	let release!: () => void;
	let acquired!: () => void;
	const entered = new Promise<void>((resolve) => {
		acquired = resolve;
	});
	const owner = withHubStartupLock(path, async () => {
		acquired();
		await new Promise<void>((resolve) => {
			release = resolve;
		});
	});
	await entered;
	await writeFile(
		join(`${path}.lock`, "owner.json"),
		JSON.stringify({ pid: process.pid, acquiredAt: new Date(0).toISOString() }),
	);
	try {
		const controller = new AbortController();
		const waiter = withHubStartupLock(
			path,
			async () => {
				throw new Error("Must not acquire");
			},
			controller.signal,
		);
		const rejected = expect(waiter).rejects.toThrow();
		await new Promise((resolve) => setTimeout(resolve, 50));
		controller.abort();
		await rejected;
		expect((await stat(`${path}.lock`)).isDirectory()).toBe(true);
	} finally {
		release();
		await owner;
		await rm(dir, { recursive: true, force: true });
	}
});

it("releases an owned lock when initialization fails and permits recovery", async () => {
	const dir = await mkdtemp(join(tmpdir(), "hub-cleanup-"));
	const path = join(dir, "discovery.json");
	try {
		await expect(
			withHubStartupLock(path, async () => {
				throw new Error("failed initialization");
			}),
		).rejects.toThrow("failed initialization");
		await expect(stat(`${path}.lock`)).rejects.toThrow();
		await expect(
			withHubStartupLock(path, async () => "recovered"),
		).resolves.toBe("recovered");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it.each([
	false,
	true,
])("bounds a stalled health probe (headers received: %s) and releases the startup lock", async (headers) => {
	const dir = await mkdtemp(join(tmpdir(), "hub-cleanup-"));
	const path = join(dir, "discovery.json");
	const server = createServer((_request, response) => {
		if (headers) {
			response.writeHead(200, { "Content-Type": "application/json" });
			response.write('{"protocolVersion":');
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Missing address");
	try {
		await expect(
			withHubStartupLock(path, () =>
				probeHubServer(`http://127.0.0.1:${address.port}`),
			),
		).resolves.toBeUndefined();
		await expect(
			withHubStartupLock(path, async () => "recovered"),
		).resolves.toBe("recovered");
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(dir, { recursive: true, force: true });
	}
}, 10_000);
