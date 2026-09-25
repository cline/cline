import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { probeHubServer, withHubStartupLock } from ".";

// Startup must also work on Node runtimes without a SQLite implementation.
vi.mock("./instance-lock", () => ({
	HubInstanceLock: {
		acquire: () => {
			throw new Error("SQLite unavailable");
		},
	},
	isHubLockHeldError: () => false,
}));

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
		expect(
			JSON.parse(await readFile(join(`${path}.lock`, "owner.json"), "utf8"))
				.pid,
		).toBe(process.pid);
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
		).rejects.toThrow("probe timed out");
		await expect(
			withHubStartupLock(path, async () => "recovered"),
		).resolves.toBe("recovered");
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(dir, { recursive: true, force: true });
	}
}, 10_000);

it("does not strand startup on an abandoned PID record reused by a live process", async () => {
	const dir = await mkdtemp(join(tmpdir(), "hub-reused-pid-"));
	const path = join(dir, "discovery.json");
	try {
		await mkdir(`${path}.lock`);
		await writeFile(
			join(`${path}.lock`, "owner.json"),
			JSON.stringify({
				pid: process.pid,
				acquiredAt: new Date(0).toISOString(),
			}),
		);
		await expect(
			withHubStartupLock(path, async () => "recovered"),
		).resolves.toBe("recovered");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
