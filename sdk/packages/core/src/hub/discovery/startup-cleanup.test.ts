import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { probeHubServer, withHubStartupLock } from ".";

const hooks = vi.hoisted(() => ({
	beforePublish: undefined as
		| undefined
		| ((from: string, to: string) => Promise<void>),
	beforeRemove: undefined as undefined | ((path: string) => Promise<void>),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		rename: async (...args: Parameters<typeof fs.rename>) => {
			await hooks.beforePublish?.(String(args[0]), String(args[1]));
			return fs.rename(...args);
		},
		rm: async (...args: Parameters<typeof fs.rm>) => {
			await hooks.beforeRemove?.(String(args[0]));
			return fs.rm(...args);
		},
	};
});
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
		expect((await readdir(`${path}.lock`))[0]).toMatch(
			new RegExp(`^${process.pid}-`),
		);
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

it.each([
	false,
	true,
])("recovers a reused PID (previous owner format: %s)", async (previousFormat) => {
	const dir = await mkdtemp(join(tmpdir(), "hub-reused-pid-"));
	const path = join(dir, "discovery.json");
	try {
		await mkdir(`${path}.lock`);
		await writeFile(
			join(
				`${path}.lock`,
				previousFormat
					? "owner.json"
					: `${process.pid}-0-${"a".repeat(32)}.owner`,
			),
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

it("recovers an empty unpublished directory without depending on SQLite", async () => {
	const dir = await mkdtemp(join(tmpdir(), "hub-empty-lock-"));
	const path = join(dir, "discovery.json");
	try {
		await mkdir(`${path}.lock`);
		await expect(withHubStartupLock(path, async () => "ready")).resolves.toBe(
			"ready",
		);
		expect(await readdir(dir)).toEqual([]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it.each([
	false,
	true,
])("a delayed reclaimer cannot delete the new owner (previous format: %s)", async (previousFormat) => {
	const dir = await mkdtemp(join(tmpdir(), "hub-reclaimer-"));
	const path = join(dir, "discovery.json");
	const staleName = previousFormat
		? "owner.json"
		: `${process.pid}-0-${"b".repeat(32)}.owner`;
	let resume!: () => void;
	let reached!: () => void;
	let release!: () => void;
	let entered!: () => void;
	const paused = new Promise<void>((r) => {
		reached = r;
	});
	const ownerEntered = new Promise<void>((r) => {
		entered = r;
	});
	let removes = 0;
	await mkdir(`${path}.lock`);
	await writeFile(
		join(`${path}.lock`, staleName),
		JSON.stringify({ pid: process.pid, acquiredAt: new Date(0).toISOString() }),
	);
	hooks.beforeRemove = async (p) => {
		if (p === join(`${path}.lock`, staleName) && ++removes === 1) {
			reached();
			await new Promise<void>((r) => {
				resume = r;
			});
		}
	};
	const controller = new AbortController();
	const delayed = withHubStartupLock(
		path,
		async () => {
			throw new Error("overlapping owner");
		},
		controller.signal,
	);
	const rejected = expect(delayed).rejects.toThrow();
	await paused;
	const owner = withHubStartupLock(path, async () => {
		entered();
		await new Promise<void>((r) => {
			release = r;
		});
	});
	try {
		await ownerEntered;
		const before = await readdir(`${path}.lock`);
		resume();
		await new Promise((r) => setTimeout(r, 50));
		controller.abort();
		await rejected;
		expect(await readdir(`${path}.lock`)).toEqual(before);
	} finally {
		hooks.beforeRemove = undefined;
		release();
		await owner;
		await rm(dir, { recursive: true, force: true });
	}
});

it("serializes separate processes reclaiming one abandoned lock", async () => {
	const { spawn } = await import("node:child_process");
	const dir = await mkdtemp(join(tmpdir(), "hub-process-lock-"));
	const path = join(dir, "discovery.json");
	const source = new URL("./index.ts", import.meta.url).pathname;
	try {
		await mkdir(`${path}.lock`);
		await writeFile(
			join(`${path}.lock`, `${process.pid}-0-${"c".repeat(32)}.owner`),
			"",
		);
		const script = `
   import { withHubStartupLock } from ${JSON.stringify(source)};
   import { open, rm } from "node:fs/promises";
   await withHubStartupLock(${JSON.stringify(path)}, async () => {
    const marker = ${JSON.stringify(join(dir, "exclusive"))};
    const handle = await open(marker, "wx");
    await new Promise(r => setTimeout(r, 50));
    await handle.close();
    await rm(marker);
   });
  `;
		await Promise.all(
			Array.from(
				{ length: 6 },
				() =>
					new Promise<void>((resolve, reject) => {
						const child = spawn("bun", ["-e", script], {
							stdio: ["ignore", "ignore", "pipe"],
						});
						let stderr = "";
						child.stderr.on("data", (data) => {
							stderr += data;
						});
						child.once("error", reject);
						child.once("exit", (code) =>
							code === 0
								? resolve()
								: reject(new Error(stderr || `child exited ${code}`)),
						);
					}),
			),
		);
		expect(await readdir(dir)).toEqual([]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it("never publishes incomplete ownership if preparing the lock fails", async () => {
	const dir = await mkdtemp(join(tmpdir(), "hub-publish-lock-"));
	const path = join(dir, "discovery.json");
	hooks.beforePublish = async (candidate, target) => {
		expect((await readdir(candidate))[0]).toMatch(/\.owner$/);
		await expect(readdir(target)).rejects.toMatchObject({ code: "ENOENT" });
		throw new Error("publication interrupted");
	};
	try {
		await expect(withHubStartupLock(path, async () => {})).rejects.toThrow(
			"publication interrupted",
		);
		expect(await readdir(dir)).toEqual([]);
		hooks.beforePublish = undefined;
		await expect(
			withHubStartupLock(path, async () => "recovered"),
		).resolves.toBe("recovered");
	} finally {
		hooks.beforePublish = undefined;
		await rm(dir, { recursive: true, force: true });
	}
});

it.each([
	false,
	true,
])("recovers a killed owner (previous format: %s)", async (previousFormat) => {
	const { spawn } = await import("node:child_process");
	const dir = await mkdtemp(join(tmpdir(), "hub-crashed-owner-"));
	const path = join(dir, "discovery.json");
	const source = new URL("./index.ts", import.meta.url).pathname;
	const child = spawn(
		"bun",
		[
			"-e",
			`
  import { withHubStartupLock } from ${JSON.stringify(source)};
  await withHubStartupLock(${JSON.stringify(path)}, async () => {
   process.stdout.write("locked");
   await new Promise(() => { setInterval(() => {}, 1000); });
  });
 `,
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	const exited = new Promise<void>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", () => resolve());
	});
	try {
		await new Promise<void>((resolve, reject) => {
			child.stdout.once("data", () => resolve());
			child.once("error", reject);
			child.once("exit", () =>
				reject(new Error("owner exited before acquiring")),
			);
		});
		child.kill("SIGKILL");
		await exited;
		if (previousFormat) {
			const [entry] = await readdir(`${path}.lock`);
			await rm(join(`${path}.lock`, entry));
			await writeFile(
				join(`${path}.lock`, "owner.json"),
				JSON.stringify({
					pid: child.pid,
					acquiredAt: new Date().toISOString(),
				}),
			);
		}

		await expect(
			withHubStartupLock(path, async () => "recovered"),
		).resolves.toBe("recovered");
		expect(await readdir(dir)).toEqual([]);
	} finally {
		child.kill("SIGKILL");
		await exited;
		await rm(dir, { recursive: true, force: true });
	}
});

it("surfaces publication permission errors without spinning on a missing lock", async () => {
	const dir = await mkdtemp(join(tmpdir(), "hub-permission-lock-"));
	const failure = Object.assign(new Error("permission denied"), {
		code: "EACCES",
	});
	hooks.beforePublish = async () => {
		throw failure;
	};
	try {
		await expect(
			withHubStartupLock(join(dir, "hub.json"), async () => {}),
		).rejects.toBe(failure);
		expect(await readdir(dir)).toEqual([]);
	} finally {
		hooks.beforePublish = undefined;
		await rm(dir, { recursive: true, force: true });
	}
});

it.each([
	JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }),
	'{"pid":',
])("does not displace a live or unidentifiable previous owner: %s", async (record) => {
	const dir = await mkdtemp(join(tmpdir(), "hub-previous-owner-"));
	const path = join(dir, "hub.json");
	const controller = new AbortController();
	const callback = vi.fn();
	try {
		await mkdir(`${path}.lock`);
		await writeFile(join(`${path}.lock`, "owner.json"), record);
		const pending = withHubStartupLock(path, callback, controller.signal);
		const rejected = expect(pending).rejects.toThrow();
		await new Promise((resolve) => setTimeout(resolve, 50));
		controller.abort();
		await rejected;
		expect(callback).not.toHaveBeenCalled();
		expect(await readdir(`${path}.lock`)).toEqual(["owner.json"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
